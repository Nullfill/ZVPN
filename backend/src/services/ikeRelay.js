import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { config } from '../config.js';
import { getSetting, updateSettings } from './settings.js';
import { relayPolicy, relayTemplate } from './ikeRelayConfig.js';
import { lookup } from 'node:dns/promises';

const exec = promisify(execFile);
const runtime = path.dirname(config.vpnSecretsFile);
let tail = Promise.resolve(), applied = null, appliedAt = 0;
function serialize(fn) {
  const job = tail.then(fn);
  tail = job.catch(() => {});
  return job;
}
async function provision(policy) {
  const file = path.join(runtime, 'ike-relay.json');
  const temporary = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(policy), { mode: 0o600 });
  await fs.chmod(temporary, 0o600);
  await fs.rename(temporary, file);
  try {
    await exec('sudo', [config.helper, 'sync-ike-relay'], { timeout: 45000, maxBuffer: 1024 * 1024 });
  } catch (error) {
    // Do not expose command arguments, filesystem dumps or stderr with secrets.
    const failure = new Error('IKE_RELAY_APPLY_FAILED');
    failure.cause = error;
    throw failure;
  }
  applied = JSON.stringify(policy);
  appliedAt = Date.now();
}
export function syncIkeRelay() {
  return serialize(async () => {
    const policy = relayPolicy(await getSetting('ikeRelay'));
    if (JSON.stringify(policy) !== applied || Date.now() - appliedAt > 6 * 3600000) await provision(policy);
  });
}
export function applyIkeRelay(patch) {
  return serialize(async () => {
    const before = relayPolicy(await getSetting('ikeRelay'));
    const after = relayPolicy({ ...before, ...patch });
    if (after.enabled) {
      const vpn = await getSetting('vpn');
      if (after.hostname === vpn.serverAddress) throw new Error('RELAY_ORIGIN_MUST_DIFFER');
      await lookup(after.hostname, { family: 4 });
    }
    await provision(after);
    try { return await updateSettings('ikeRelay', after); }
    catch (error) { await provision(before).catch(() => {}); throw error; }
  });
}
export async function getIkeRelayStatus() {
  const policy = relayPolicy(await getSetting('ikeRelay'));
  let status = null;
  try { status = JSON.parse(await fs.readFile(path.join(runtime, 'ike-relay-status.json'), 'utf8')); } catch { /* not provisioned */ }
  const ready = Boolean(policy.enabled && status?.enabled && status?.ready && status.hostname === policy.hostname && status.port === policy.port);
  return { ...policy, ready, certificate: status?.certificate || null, error: status?.error || null };
}
export async function getIkeRelayTemplate() {
  const policy = await getSetting('ikeRelay');
  if (!policy.hostname) throw new Error('RELAY_HOSTNAME_REQUIRED');
  const vpn = await getSetting('vpn');
  // Keep a DNS origin, so migrations only require updating its existing A record.
  const origin = vpn.serverAddress || new URL(config.publicBaseUrl).hostname;
  if (origin === policy.hostname) throw new Error('RELAY_ORIGIN_MUST_DIFFER');
  return { fragment: relayTemplate(policy, origin), origin };
}
