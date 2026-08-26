import { one, many, db } from '../db.js';
import { config } from '../config.js';
import { encryptSecret, randomPassword, randomToken } from '../crypto.js';
import { syncSecretsNow, queueSyncSecrets } from './syncQueue.js';
import { bytes, sanitizeUser, tokenExpiry } from '../utils/format.js';
import { getLiveSessions, disconnectUser } from '../worker.js';

export function getBaseUrl(req = null) {
  if (req) {
    const proto = req.get('x-forwarded-proto') || req.protocol || 'http';
    const host = req.get('x-forwarded-host') || req.get('host');
    if (host && !host.includes('127.0.0.1') && !host.includes('localhost')) {
      return `${proto}://${host}`;
    }
  }
  if (config.publicBaseUrl && !config.publicBaseUrl.includes('127.0.0.1') && !config.publicBaseUrl.includes('localhost')) {
    return config.publicBaseUrl;
  }
  if (config.vpnServer && config.vpnServer !== '127.0.0.1' && config.vpnServer !== 'localhost') {
    return `http://${config.vpnServer}`;
  }
  return config.publicBaseUrl;
}

function links(token, req = null) {
  const base = `${getBaseUrl(req)}/d/${token}`;
  return { landing: base, android: `${base}/android`, ios: `${base}/ios`, windows: `${base}/windows`, windowsLauncher: `${base}/windows-launcher` };
}

export async function listUsers() {
  const rows = await many(`SELECT u.*, COALESCE(d.bytes,0)::bigint AS today_bytes FROM vpn_users u
    LEFT JOIN usage_daily d ON d.user_id=u.id AND d.usage_date=(now() AT TIME ZONE $1)::date ORDER BY u.created_at DESC`, [config.timezone]);
  return rows.map((u) => sanitizeUser(u, getLiveSessions()));
}

export async function getUserById(id) {
  const u = await one(`SELECT u.*, COALESCE(d.bytes,0)::bigint AS today_bytes FROM vpn_users u
    LEFT JOIN usage_daily d ON d.user_id=u.id AND d.usage_date=(now() AT TIME ZONE $1)::date WHERE u.id=$2`, [config.timezone, id]);
  return u ? sanitizeUser(u, getLiveSessions()) : null;
}

export async function provisionUser(data, req = null) {
  const password = data.password || randomPassword();
  const token = randomToken();
  const activationStatus = data.durationDays && !data.expiresAt ? 'not_activated' : 'activated';
  const row = await one(`INSERT INTO vpn_users(username,secret_enc,expires_at,duration_days,activation_status,provisioning_status,
    daily_limit_bytes,total_limit_bytes,unlimited_traffic,max_devices,note,download_token,download_token_expires_at)
    VALUES($1,$2,$3,$4,$5,'provisioning',$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [data.username, encryptSecret(password), data.expiresAt || null, data.durationDays || null, activationStatus,
      bytes(data.dailyLimitBytes), bytes(data.totalLimitBytes), Boolean(data.unlimitedTraffic), data.maxDevices || 1,
      data.note || null, token, tokenExpiry(config.downloadDays)]);
  try {
    await syncSecretsNow();
    await db.query(`UPDATE vpn_users SET provisioning_status='active', provisioning_error=NULL WHERE id=$1`, [row.id]);
  } catch (e) {
    await db.query(`UPDATE vpn_users SET provisioning_status='failed', provisioning_error=$2 WHERE id=$1`, [row.id, e.message.slice(0, 500)]);
  }
  const full = await getUserById(row.id);
  return { user: full, generatedPassword: password, links: links(token, req), syncOk: full?.provisioningStatus === 'active' };
}

export async function updateUser(id, data) {
  const u = await one('SELECT * FROM vpn_users WHERE id=$1', [id]);
  if (!u) return null;
  await db.query(`UPDATE vpn_users SET enabled=COALESCE($1,enabled),
    expires_at=CASE WHEN $2::boolean THEN $3::timestamptz ELSE expires_at END,
    duration_days=CASE WHEN $4::boolean THEN $5::integer ELSE duration_days END,
    daily_limit_bytes=CASE WHEN $6::boolean THEN $7::bigint ELSE daily_limit_bytes END,
    total_limit_bytes=CASE WHEN $8::boolean THEN $9::bigint ELSE total_limit_bytes END,
    unlimited_traffic=CASE WHEN $10::boolean THEN $11::boolean ELSE unlimited_traffic END,
    max_devices=COALESCE($12,max_devices), note=CASE WHEN $13::boolean THEN $14 ELSE note END,
    quota_blocked=CASE WHEN $15 THEN false ELSE quota_blocked END, quota_reason=CASE WHEN $15 THEN NULL ELSE quota_reason END, updated_at=now() WHERE id=$16`,
    [data.enabled ?? null, Object.hasOwn(data, 'expiresAt'), data.expiresAt || null, Object.hasOwn(data, 'durationDays'), data.durationDays ?? null,
      Object.hasOwn(data, 'dailyLimitBytes'), bytes(data.dailyLimitBytes), Object.hasOwn(data, 'totalLimitBytes'), bytes(data.totalLimitBytes),
      Object.hasOwn(data, 'unlimitedTraffic'), Boolean(data.unlimitedTraffic), data.maxDevices ?? null, Object.hasOwn(data, 'note'), data.note ?? null,
      Boolean(data.resetUsage), id]);
  if (data.resetUsage) {
    await db.query('UPDATE vpn_users SET usage_total=0, upload_bytes=0, download_bytes=0 WHERE id=$1', [id]);
    await db.query('DELETE FROM usage_daily WHERE user_id=$1', [id]);
  }
  queueSyncSecrets();
  if (data.enabled === false) disconnectUser(u.username).catch(() => {});
  return getUserById(id);
}

export async function extendUser(id, days) {
  const u = await one('SELECT expires_at FROM vpn_users WHERE id=$1', [id]);
  if (!u) return null;
  const base = u.expires_at && new Date(u.expires_at) > new Date() ? new Date(u.expires_at) : new Date();
  await db.query(`UPDATE vpn_users SET expires_at=$2, activation_status='activated', quota_blocked=false, quota_reason=NULL, updated_at=now() WHERE id=$1`, [id, new Date(base.getTime() + days * 86400000).toISOString()]);
  queueSyncSecrets();
  return getUserById(id);
}

export async function addTraffic(id, addBytes) {
  const u = await one('SELECT total_limit_bytes FROM vpn_users WHERE id=$1', [id]);
  if (!u) return null;
  await db.query('UPDATE vpn_users SET total_limit_bytes=$2, quota_blocked=false, quota_reason=NULL, updated_at=now() WHERE id=$1', [id, (Number(u.total_limit_bytes) || 0) + addBytes]);
  queueSyncSecrets();
  return getUserById(id);
}

export async function deleteUser(id) {
  const u = await one('SELECT username FROM vpn_users WHERE id=$1', [id]);
  if (!u) return false;
  await disconnectUser(u.username);
  await db.query('DELETE FROM vpn_users WHERE id=$1', [id]);
  queueSyncSecrets();
  return true;
}

export async function regenerateToken(id, req = null) {
  const token = randomToken();
  const r = await db.query('UPDATE vpn_users SET download_token=$1, download_token_expires_at=$2, download_token_revoked=false, updated_at=now() WHERE id=$3 RETURNING download_token', [token, tokenExpiry(config.downloadDays), id]);
  return r.rowCount ? links(token, req) : null;
}

export async function revokeToken(id) {
  return Boolean((await db.query('UPDATE vpn_users SET download_token_revoked=true, updated_at=now() WHERE id=$1 RETURNING id', [id])).rowCount);
}

/**
 * Rotate an EAP secret and download token as one DB mutation, then reconcile
 * the generated secrets with strongSwan before disconnecting the old SA.
 * A sync failure is reported to the caller and queued for retry; it is never
 * silently reported as a successful password change.
 */
export async function resetUserPassword(id, password = randomPassword(), req = null) {
  const u = await one('SELECT id, username FROM vpn_users WHERE id=$1', [id]);
  if (!u) return null;
  const token = randomToken();
  await db.query(
    `UPDATE vpn_users SET secret_enc=$1, download_token=$2,
       download_token_expires_at=$3, download_token_revoked=false, updated_at=now()
     WHERE id=$4`,
    [encryptSecret(password), token, tokenExpiry(config.downloadDays), id],
  );

  let syncOk = true;
  try {
    await syncSecretsNow();
  } catch {
    syncOk = false;
    queueSyncSecrets();
  }
  if (syncOk) await disconnectUser(u.username);
  return { password, links: links(token, req), syncOk };
}

export async function getUserStats(id) {
  return {
    hourly: await many('SELECT hour_ts, bytes FROM usage_hourly WHERE user_id=$1 AND hour_ts > now() - interval \'24 hours\' ORDER BY hour_ts', [id]),
    daily: await many('SELECT usage_date, bytes FROM usage_daily WHERE user_id=$1 AND usage_date > (now() AT TIME ZONE $2)::date - 30 ORDER BY usage_date', [id, config.timezone]),
    sessions: await many('SELECT * FROM connection_history WHERE user_id=$1 ORDER BY connected_at DESC LIMIT 50', [id]),
  };
}

export async function bulkUsers(ids, action) {
  let count = 0;
  for (const id of ids) {
    if (action === 'enable') {
      if (await updateUser(id, { enabled: true })) count++;
    } else if (action === 'disable') {
      if (await updateUser(id, { enabled: false })) count++;
    } else if (action === 'delete') {
      if (await deleteUser(id)) count++;
    }
  }
  return count;
}

export async function resetActivation(id) {
  const r = await db.query(
    `UPDATE vpn_users SET first_connected_at=NULL, activation_status='not_activated', expires_at=NULL, updated_at=now()
     WHERE id=$1 AND duration_days IS NOT NULL RETURNING id`,
    [id],
  );
  if (!r.rowCount) return null;
  queueSyncSecrets();
  return getUserById(id);
}

export { links as downloadLinks };
