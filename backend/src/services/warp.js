import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { config } from '../config.js';
import { getSetting } from './settings.js';
const exec = promisify(execFile);
const runtime = '/opt/zvpn-panel/runtime/warp.json';

export async function prepareWarpPolicy(users) {
  const settings = await getSetting('warp');
  const installed = await fs.access('/usr/local/libexec/zvpn/warp-router.py').then(() => true, () => false);
  if (!installed) {
    if (settings.enabled) throw new Error('WARP_NOT_INSTALLED_RUN_INSTALL_WARP');
    return false;
  }
  const selected = new Set(settings.userIds);
  const policy = { ...settings, users: users.filter(u => settings.scope === 'all' || selected.has(u.id))
    .map(u => ({ id: u.id, username: u.username })) };
  delete policy.userIds;
  const json = JSON.stringify(policy, null, 2) + '\n';
  if (await fs.readFile(runtime, 'utf8').catch(() => '') === json) return false;
  const temp = runtime + '.tmp';
  await fs.writeFile(temp, json, { mode: 0o600 });
  await fs.rename(temp, runtime);
  try { await exec('sudo', [config.helper, 'sync-warp'], { timeout: 20000 }); }
  catch (error) { await fs.rm(runtime, { force: true }); throw error; }
  return true;
}

export async function getWarpStatus() {
  const installed = await fs.access('/usr/bin/warp-cli').then(() => true, () => false);
  const status = await exec('sudo', [config.helper, 'warp-status'], { timeout: 5000 })
    .then(result => JSON.parse(result.stdout)).catch(() => null);
  return { installed, ...(status || { state: 'not_ready', totalBytes: 0, todayBytes: 0 }),
    stale: !status?.updatedAt || Date.now() - Date.parse(status.updatedAt) > 20000 };
}

export async function reconnectWarp() {
  await exec('sudo', [config.helper, 'warp-reconnect'], { timeout: 15000 });
}

let rotationPending = false;
export async function rotateWarpIp() {
  if (rotationPending) return { outcome: 'busy' };
  rotationPending = true;
  try {
    const { stdout } = await exec('sudo', [config.helper, 'warp-rotate-ip'], { timeout: 70000 });
    return JSON.parse(stdout);
  } finally { rotationPending = false; }
}
