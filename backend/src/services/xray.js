import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { many, tx } from '../db.js';
import { config } from '../config.js';
import { getSetting } from './settings.js';
import { buildXrayConfig, parseXrayStats } from './xrayConfig.js';

import { recordXrayCounters } from './sharedUsage.js';

const exec = promisify(execFile);
export const XRAY_RUNTIME_CONFIG = '/opt/zvpn-panel/runtime/xray.json';
let installed = false;
let usageTail = Promise.resolve();
let lastUsageAt = null;
let usageFailed = false;

export async function getXrayStatus() {
  const settings = await getSetting('xray');
  const available = await xrayAvailable();
  let service = available ? 'unknown' : 'not_installed';
  let version = null;
  if (available) {
    const results = await Promise.allSettled([
      exec('systemctl', ['show', 'xray', '--property=ActiveState', '--value'], { timeout: 3000 }),
      exec('/usr/local/bin/xray', ['version'], { timeout: 3000 }),
    ]);
    const state = results[0];
    service = state.status === 'fulfilled' ? state.value.stdout.trim() || 'unknown' : 'unknown';
    const release = results[1];
    if (release.status === 'fulfilled') version = /^Xray\s+(\S+)/.exec(release.value.stdout)?.[1] || null;
  }
  return { installed: available, enabled: settings.enabled !== false, service, version,
    lastUsageAt: lastUsageAt ? new Date(lastUsageAt).toISOString() : null,
    meteringHealthy: service === 'active' && !usageFailed && lastUsageAt !== null && Date.now() - lastUsageAt < 45000 };
}

async function helper(action) {
  const { stdout } = await exec('sudo', [config.helper, action], { timeout: 45000, maxBuffer: 8 * 1024 * 1024 });
  return stdout;
}

export async function xrayAvailable() {
  try { await fs.access('/usr/local/bin/xray'); installed = true; return true; } catch { return false; }
}

export function collectXrayUsage() {
  const job = usageTail.then(readXrayUsage).catch((error) => { usageFailed = true; throw error; });
  usageTail = job.catch(() => {});
  return job;
}

export async function stopXray() { return helper('stop-xray'); }

async function readXrayUsage() {
  if (!installed && !await xrayAvailable()) return;
  const before = (await helper('xray-epoch')).trim();
  if (before === 'stopped') return;
  const { stdout } = await exec('/usr/local/bin/xray', ['api', 'statsquery', '--server=127.0.0.1:10086', '-pattern', 'user>>>'],
    { timeout: 10000, maxBuffer: 8 * 1024 * 1024 });
  const counters = parseXrayStats(JSON.parse(stdout));
  const after = (await helper('xray-epoch')).trim();
  if (after !== before) throw new Error('XRAY_RESTART_DURING_STATS');
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone,
    year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const hour = new Date(); hour.setMinutes(0, 0, 0);
  for (const [id, counter] of [...counters].sort(([a], [b]) => a.localeCompare(b))) {
    await tx(async (client) => {
      await recordXrayCounters(client, id, counter, before, today, hour.toISOString());
    });
  }
  lastUsageAt = Date.now();
  usageFailed = false;
}

export async function syncXray() {
  const settings = await getSetting('xray');
  if (!await xrayAvailable()) {
    if (settings.enabled !== false) throw new Error('XRAY_NOT_INSTALLED_RUN_UPGRADE');
    return;
  }
  const users = await many('SELECT * FROM vpn_users ORDER BY id');
  const json = JSON.stringify(buildXrayConfig(users, settings.enabled !== false), null, 2) + '\n';
  // Root owns the applied config; this comparison is against the readable runtime copy.
  const desired = await fs.readFile(XRAY_RUNTIME_CONFIG, 'utf8').catch(() => '');
  if (desired === json && (await helper('xray-epoch')).trim() !== 'stopped') return;
  // Drain counters before managed restarts. If statistics fail, stop rather than
  // serve unmetered traffic or keep revoked users connected.
  try { await collectXrayUsage(); } catch (error) {
    await helper('stop-xray');
    throw error;
  }
  const temp = `${XRAY_RUNTIME_CONFIG}.${process.pid}.tmp`;
  await fs.writeFile(temp, json, { mode: 0o600 });
  await fs.rename(temp, XRAY_RUNTIME_CONFIG);
  try { await helper('sync-xray'); } catch (error) {
    await helper('stop-xray').catch(() => {});
    await fs.rm(XRAY_RUNTIME_CONFIG, { force: true });
    throw error;
  }
}
