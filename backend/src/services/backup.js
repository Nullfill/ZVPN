import { db, many, one, tx } from '../db.js';
import { createHash } from 'node:crypto';
import { config } from '../config.js';
import { getSettings, validateSettingsPatch } from './settings.js';
import { queueSyncSecrets } from './syncQueue.js';
import { invalidateVpnConfigCache } from './vpnConfig.js';

const EXPORT_VERSION = 2;

function digestPayload(payload) {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

export async function exportPanelBackup({ includeAdmins = false } = {}) {
  const [settings, users, admins, usageDaily, usageHourly] = await Promise.all([
    getSettings(),
    many('SELECT * FROM vpn_users ORDER BY username'),
    includeAdmins
      ? many('SELECT id, username, password_hash, role, created_at FROM admins ORDER BY username')
      : Promise.resolve([]),
    many('SELECT * FROM usage_daily ORDER BY user_id, usage_date'),
    many('SELECT * FROM usage_hourly ORDER BY user_id, hour_ts'),
  ]);

  const payload = {
    format: 'zvpn-panel-backup',
    formatVersion: EXPORT_VERSION,
    panelVersion: config.version,
    exportedAt: new Date().toISOString(),
    envHints: {
      panelName: config.panelName,
      publicBaseUrl: config.publicBaseUrl,
      vpnServer: config.vpnServer,
      vpnRemoteId: config.vpnRemoteId,
      timezone: config.timezone,
      note: 'برای بازیابی کامل، MASTER_KEY در .env سرور جدید باید با سرور قبلی یکسان باشد.',
    },
    settings,
    // Password hashes are excluded unless an operator explicitly requests a
    // full administrator backup. VPN encrypted secrets remain available for
    // restore and are protected by the deployment MASTER_KEY.
    admins,
    users,
    usageDaily,
    usageHourly,
    counts: {
      users: users.length,
      admins: admins.length,
    },
  };
  return { ...payload, integrity: { algorithm: 'sha256', digest: digestPayload(payload) } };
}

export async function importPanelBackup(data, { mode = 'merge' } = {}) {
  if (!data || data.format !== 'zvpn-panel-backup' || ![1, 2].includes(data.formatVersion ?? 1)) {
    throw new Error('INVALID_BACKUP_FORMAT');
  }
  if (!Array.isArray(data.users)) throw new Error('INVALID_BACKUP_USERS');
  if (data.users.length > 100000) throw new Error('INVALID_BACKUP_USERS');
  if (data.integrity?.algorithm === 'sha256') {
    const { integrity, ...payload } = data;
    if (integrity.digest !== digestPayload(payload)) throw new Error('INVALID_BACKUP_INTEGRITY');
  }

  const validUsername = /^[A-Za-z0-9_.@-]{3,64}$/;
  const seenUsers = new Set();
  for (const user of data.users) {
    if (!user || typeof user !== 'object' || !validUsername.test(String(user.username || ''))
      || seenUsers.has(user.username) || typeof user.secret_enc !== 'string'
      || user.secret_enc.length > 512 || typeof user.download_token !== 'string'
      || user.download_token.length > 512 || !Number.isInteger(Number(user.max_devices ?? 1))
      || Number(user.max_devices ?? 1) < 1 || Number(user.max_devices ?? 1) > 10) {
      throw new Error('INVALID_BACKUP_USERS');
    }
    seenUsers.add(user.username);
  }
  if (data.settings && typeof data.settings === 'object') {
    for (const [key, value] of Object.entries(data.settings)) {
      if (['general', 'vpn', 'appearance', 'download'].includes(key)) {
        const parsed = validateSettingsPatch(key, value);
        if (!parsed.success) throw new Error('INVALID_BACKUP_SETTINGS');
      }
    }
  }

  const result = { imported: { users: 0, admins: 0, settings: false }, skipped: { users: 0 } };

  await tx(async (client) => {
    if (data.settings && mode !== 'users-only') {
      for (const [key, value] of Object.entries(data.settings)) {
        if (!value || typeof value !== 'object' || !['general', 'vpn', 'appearance', 'download'].includes(key)) continue;
        await client.query(
          `INSERT INTO panel_settings(key, value, updated_at) VALUES($1, $2::jsonb, now())
           ON CONFLICT(key) DO UPDATE SET value=$2::jsonb, updated_at=now()`,
          [key, JSON.stringify(value)]
        );
      }
      result.imported.settings = true;
      invalidateVpnConfigCache();
    }

    if (Array.isArray(data.admins) && mode === 'full') {
      for (const a of data.admins) {
        if (!validUsername.test(String(a.username || '')) || !/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(a.password_hash || '')) continue;
        const role = ['viewer', 'operator', 'admin', 'owner'].includes(a.role) ? a.role : 'admin';
        await client.query(
          `INSERT INTO admins(id, username, password_hash, role, created_at)
           VALUES(COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4, COALESCE($5::timestamptz, now()))
           ON CONFLICT(username) DO UPDATE SET password_hash=EXCLUDED.password_hash, role=EXCLUDED.role`,
          [a.id || null, a.username, a.password_hash, role, a.created_at || null]
        );
        result.imported.admins++;
      }
    }

    for (const u of data.users) {
      if (!u.username || !u.secret_enc || !u.download_token) {
        result.skipped.users++;
        continue;
      }
      const existing = await client.query('SELECT id FROM vpn_users WHERE username=$1', [u.username]);
      if (existing.rowCount && mode === 'merge') {
        await client.query(
          `UPDATE vpn_users SET
            secret_enc=$2, enabled=$3, quota_blocked=$4, quota_reason=$5,
            expires_at=$6, duration_days=$7, first_connected_at=$8, activation_status=$9,
            provisioning_status=$10, daily_limit_bytes=$11, total_limit_bytes=$12,
            unlimited_traffic=$13, max_devices=$14, usage_total=$15, upload_bytes=$16,
            download_bytes=$17, last_seen_at=$18, last_public_ip=$19, last_virtual_ip=$20,
            download_token=$21, download_token_expires_at=$22, download_token_revoked=$23,
            note=$24, updated_at=now()
           WHERE username=$1`,
          [
            u.username, u.secret_enc, u.enabled ?? true, u.quota_blocked ?? false, u.quota_reason,
            u.expires_at, u.duration_days, u.first_connected_at, u.activation_status || 'activated',
            u.provisioning_status || 'active', u.daily_limit_bytes, u.total_limit_bytes,
            u.unlimited_traffic ?? false, u.max_devices ?? 1, u.usage_total ?? 0,
            u.upload_bytes ?? 0, u.download_bytes ?? 0, u.last_seen_at, u.last_public_ip,
            u.last_virtual_ip, u.download_token, u.download_token_expires_at,
            u.download_token_revoked ?? false, u.note,
          ]
        );
      } else if (!existing.rowCount) {
        await client.query(
          `INSERT INTO vpn_users(
            id, username, secret_enc, enabled, quota_blocked, quota_reason, expires_at,
            duration_days, first_connected_at, activation_status, provisioning_status,
            daily_limit_bytes, total_limit_bytes, unlimited_traffic, max_devices,
            usage_total, upload_bytes, download_bytes, last_seen_at, last_public_ip,
            last_virtual_ip, download_token, download_token_expires_at, download_token_revoked,
            note, created_at, updated_at
          ) VALUES(
            COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
            $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25,
            COALESCE($26::timestamptz, now()), now()
          )`,
          [
            u.id, u.username, u.secret_enc, u.enabled ?? true, u.quota_blocked ?? false,
            u.quota_reason, u.expires_at, u.duration_days, u.first_connected_at,
            u.activation_status || 'activated', u.provisioning_status || 'active',
            u.daily_limit_bytes, u.total_limit_bytes, u.unlimited_traffic ?? false,
            u.max_devices ?? 1, u.usage_total ?? 0, u.upload_bytes ?? 0, u.download_bytes ?? 0,
            u.last_seen_at, u.last_public_ip, u.last_virtual_ip, u.download_token,
            u.download_token_expires_at, u.download_token_revoked ?? false, u.note, u.created_at,
          ]
        );
        result.imported.users++;
      } else {
        result.skipped.users++;
      }
    }

    if (Array.isArray(data.usageDaily)) {
      for (const row of data.usageDaily) {
        await client.query(
          `INSERT INTO usage_daily(user_id, usage_date, bytes) VALUES($1,$2,$3)
           ON CONFLICT(user_id, usage_date) DO UPDATE SET bytes=EXCLUDED.bytes`,
          [row.user_id, row.usage_date, row.bytes ?? 0]
        );
      }
    }

    if (Array.isArray(data.usageHourly)) {
      for (const row of data.usageHourly) {
        await client.query(
          `INSERT INTO usage_hourly(user_id, hour_ts, bytes) VALUES($1,$2,$3)
           ON CONFLICT(user_id, hour_ts) DO UPDATE SET bytes=EXCLUDED.bytes`,
          [row.user_id, row.hour_ts, row.bytes ?? 0]
        );
      }
    }
  });

  queueSyncSecrets();
  return result;
}
