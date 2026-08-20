import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { config } from './config.js';
import { many, db } from './db.js';
import { decryptSecret } from './crypto.js';
export { parseSas } from './services/saParser.js';

const execFileAsync = promisify(execFile);

function escapeEapSecret(s) {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]/g, '');
}

export async function syncSecrets() {
  const users = await many(`
    SELECT id, username, secret_enc FROM vpn_users
    WHERE enabled=true AND provisioning_status IN ('active','provisioning','failed')
      AND (expires_at IS NULL OR expires_at > now() OR activation_status = 'not_activated')
      AND quota_blocked=false ORDER BY username`);
  const lines = ['# Managed by ZVPN Panel.', ...users.map((u) => `${u.username} : EAP "${escapeEapSecret(decryptSecret(u.secret_enc))}"`), ''];
  // A unique file in the destination directory keeps rename atomic while
  // allowing callers to be serialized independently by the sync queue.
  const tmp = path.join(
    path.dirname(config.vpnSecretsFile),
    `.${path.basename(config.vpnSecretsFile)}.${process.pid}.${Date.now()}.tmp`,
  );
  try {
    await fs.writeFile(tmp, lines.join('\n'), { mode: 0o600, flag: 'wx' });
    await fs.rename(tmp, config.vpnSecretsFile);
  } finally {
    await fs.rm(tmp, { force: true }).catch(() => {});
  }
  await helper(['sync-secrets']);
  await helper(['normalize-conn']);
  await db.query(`UPDATE vpn_users SET provisioning_status='active', provisioning_error=NULL WHERE provisioning_status IN ('provisioning', 'failed')`);
}

async function helper(args) {
  const { stdout } = await execFileAsync('sudo', [config.helper, ...args], { timeout: 10000, maxBuffer: 4 * 1024 * 1024 });
  return stdout || '';
}

export async function rawSas() {
  try { return await helper(['list-sas']); } catch (e) { console.error('[vpn]', e.message); return ''; }
}

export async function disconnectIkeId(id) {
  if (!/^\d+$/.test(String(id))) throw new Error('Invalid IKE id');
  return helper(['terminate', String(id)]);
}
