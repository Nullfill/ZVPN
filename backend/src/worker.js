import { db, many, one, tx } from './db.js';
import { config } from './config.js';
import { rawSas, parseSas, disconnectIkeId } from './vpn.js';
import { getMaxDevicesPolicy } from './services/settings.js';
import { queueSyncSecrets } from './services/syncQueue.js';
import { SessionReconciler } from './services/sessionReconciler.js';
import { recordEvent } from './services/observability.js';

let running = false;
let lastSessions = [];
const sessionReconciler = new SessionReconciler({
  graceMs: config.sessionGraceMs,
  retryMs: config.sessionTerminateRetryMs,
  terminate: disconnectIkeId,
  loadState: async (username) => {
    const row = await one('SELECT over_limit_since FROM session_reconcile_state WHERE username=$1', [username]);
    return row ? { overLimitSince: row.over_limit_since } : null;
  },
  saveState: async (username, state) => {
    await db.query(`INSERT INTO session_reconcile_state(username, over_limit_since, last_seen_at, updated_at)
      VALUES($1,$2,now(),now()) ON CONFLICT(username) DO UPDATE SET over_limit_since=EXCLUDED.over_limit_since,
      last_seen_at=now(), updated_at=now()`, [username, state.overLimitSince]);
  },
  deleteState: async (username) => { await db.query('DELETE FROM session_reconcile_state WHERE username=$1', [username]); },
});

function localDate() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function hourTs() {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  return d.toISOString();
}

async function activateOnFirstConnect(user) {
  if (user.first_connected_at) return;
  let expiresAt = user.expires_at;
  if (user.duration_days && !expiresAt) {
    expiresAt = new Date(Date.now() + Number(user.duration_days) * 86400000).toISOString();
  }
  await db.query(
    `UPDATE vpn_users SET first_connected_at=now(), activation_status='activated',
     expires_at=COALESCE(expires_at, $2::timestamptz), updated_at=now()
     WHERE id=$1 AND first_connected_at IS NULL`,
    [user.id, expiresAt]
  );
}

async function recordSession(session) {
  const user = await one('SELECT * FROM vpn_users WHERE username=$1', [session.remoteId]);
  if (!user) return;
  if (!user.first_connected_at && user.activation_status === 'not_activated') await activateOnFirstConnect(user);
  const today = localDate();
  const hour = hourTs();
  await tx(async (client) => {
    const snap = await client.query('SELECT last_bytes, last_bytes_in, last_bytes_out FROM sa_snapshots WHERE ike_id=$1 FOR UPDATE', [session.ikeId]);
    const prev = snap.rows[0];
    const prevTotal = prev?.last_bytes;
    const prevIn = Number(prev?.last_bytes_in || 0);
    const prevOut = Number(prev?.last_bytes_out || 0);
    const deltaTotal = prevTotal == null
      ? (session.established <= Math.ceil(config.pollMs / 1000) * 2 ? session.bytesTotal : 0)
      : (session.bytesTotal >= Number(prevTotal) ? session.bytesTotal - Number(prevTotal) : session.bytesTotal);
    const deltaIn = session.bytesIn >= prevIn ? session.bytesIn - prevIn : session.bytesIn;
    const deltaOut = session.bytesOut >= prevOut ? session.bytesOut - prevOut : session.bytesOut;
    await client.query(
      `INSERT INTO sa_snapshots(ike_id,user_id,last_bytes,last_bytes_in,last_bytes_out,last_seen_at)
       VALUES($1,$2,$3,$4,$5,now()) ON CONFLICT(ike_id) DO UPDATE SET last_bytes=EXCLUDED.last_bytes,
       last_bytes_in=EXCLUDED.last_bytes_in, last_bytes_out=EXCLUDED.last_bytes_out, last_seen_at=now()`,
      [session.ikeId, user.id, session.bytesTotal, session.bytesIn, session.bytesOut]
    );
    if (deltaTotal > 0) {
      await client.query('UPDATE vpn_users SET usage_total=usage_total+$1, download_bytes=download_bytes+$2, upload_bytes=upload_bytes+$3, updated_at=now() WHERE id=$4', [deltaTotal, deltaIn, deltaOut, user.id]);
      await client.query(`INSERT INTO usage_daily(user_id,usage_date,bytes) VALUES($1,$2,$3) ON CONFLICT(user_id,usage_date) DO UPDATE SET bytes=usage_daily.bytes+EXCLUDED.bytes`, [user.id, today, deltaTotal]);
      await client.query(`INSERT INTO usage_hourly(user_id,hour_ts,bytes) VALUES($1,$2,$3) ON CONFLICT(user_id,hour_ts) DO UPDATE SET bytes=usage_hourly.bytes+EXCLUDED.bytes`, [user.id, hour, deltaTotal]);
    }
    await client.query(`UPDATE vpn_users SET last_seen_at=now(), last_public_ip=$1::inet, last_virtual_ip=CASE WHEN $2='' THEN last_virtual_ip ELSE $2::inet END WHERE id=$3`, [session.remoteHost || null, session.virtualIp || '', user.id]);
  });
}

async function enforceQuotas(sessions) {
  const today = localDate();
  const users = await many(`SELECT u.*, COALESCE(d.bytes,0) AS today_bytes FROM vpn_users u LEFT JOIN usage_daily d ON d.user_id=u.id AND d.usage_date=$1`, [today]);
  const policy = await getMaxDevicesPolicy();
  let changed = false;
  const eligibleSessions = [];
  const deviceLimits = new Map();
  for (const u of users) {
    let reason = null;
    if (u.expires_at && new Date(u.expires_at) <= new Date()) reason = 'expired';
    if (!reason && !u.unlimited_traffic && u.daily_limit_bytes && Number(u.today_bytes) >= Number(u.daily_limit_bytes)) reason = 'daily_quota';
    if (!reason && !u.unlimited_traffic && u.total_limit_bytes && Number(u.usage_total) >= Number(u.total_limit_bytes)) reason = 'total_quota';
    const shouldBlock = Boolean(reason);
    if (shouldBlock !== u.quota_blocked || (reason && reason !== u.quota_reason)) {
      await db.query('UPDATE vpn_users SET quota_blocked=$1, quota_reason=$2, updated_at=now() WHERE id=$3', [shouldBlock, reason, u.id]);
      changed = true;
      if (shouldBlock) {
        recordEvent({
          level: 'warn',
          event: 'vpn.quota_blocked',
          action: 'vpn.quota_block',
          userId: u.id,
          metadata: { username: u.username, reason, usageTotal: u.usage_total, todayBytes: u.today_bytes },
        }).catch(() => {});
      }
    }
    const mine = sessions.filter((s) => s.remoteId === u.username);
    if ((!u.enabled || shouldBlock) && mine.length) {
      // Account/limit enforcement is intentionally immediate.  Awaiting the
      // command prevents overlapping terminate calls on consecutive ticks.
      for (const s of mine) {
        try {
          await disconnectIkeId(s.ikeId);
          recordEvent({
            level: 'info',
            event: 'vpn.session_terminated',
            action: 'vpn.session.disconnect_blocked',
            userId: u.id,
            metadata: { username: u.username, ikeId: s.ikeId, reason: reason || 'disabled' },
          }).catch(() => {});
        } catch (error) {
          console.error('[worker] terminate blocked session failed', u.username, s.ikeId, error.message);
        }
      }
    } else if (u.enabled && !shouldBlock) {
      eligibleSessions.push(...mine);
      deviceLimits.set(u.username, Number(u.max_devices || 1));
    }
  }
  const actions = await sessionReconciler.reconcile(eligibleSessions, deviceLimits, policy);
  for (const action of actions) {
    if (action.type === 'terminate_error') {
      console.error('[worker] duplicate session terminate failed', action.username, action.ikeId, action.error?.message || action.error);
      recordEvent({
        level: 'error',
        event: 'vpn.session.duplicate_terminate_error',
        action: 'vpn.duplicate_terminate',
        metadata: { username: action.username, ikeId: action.ikeId, error: action.error?.message || String(action.error) },
      }).catch(() => {});
    } else if (action.type === 'terminate') {
      console.info('[worker] duplicate session terminated', action.username, action.ikeId, action.policy);
      recordEvent({
        level: 'info',
        event: 'vpn.session.duplicate_terminated',
        action: 'vpn.duplicate_terminate',
        metadata: { username: action.username, ikeId: action.ikeId, policy: action.policy },
      }).catch(() => {});
    }
  }
  if (changed) queueSyncSecrets();
  await db.query("DELETE FROM sa_snapshots WHERE last_seen_at < now() - interval '10 minutes'");
}

async function tick() {
  if (running) return;
  running = true;
  try {
    const sessions = parseSas(await rawSas());
    lastSessions = sessions;
    for (const s of sessions) await recordSession(s);
    await enforceQuotas(sessions);
  } catch (e) {
    console.error('[worker]', e);
  } finally {
    running = false;
  }
}

export function getLiveSessions() { return lastSessions; }

export async function disconnectUser(username) {
  const mine = lastSessions.filter((s) => s.remoteId === username);
  await Promise.all(mine.map((s) => disconnectIkeId(s.ikeId).catch(() => null)));
  return mine.length;
}

export function startWorker() {
  tick();
  setInterval(tick, config.pollMs).unref();
}
