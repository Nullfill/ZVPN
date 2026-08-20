import { db, many, one } from '../db.js';
import { logger, requestId, scrubMetadata } from '../logger.js';

export async function recordEvent({
  level = 'info', event, action = null, status = 'success', adminId = null, userId = null,
  metadata = {}, source = 'zvpn-panel',
} = {}) {
  if (!event) throw new Error('EVENT_NAME_REQUIRED');
  const fields = { adminId, userId, action, status, metadata, source };
  const write = Object.hasOwn(logger, level) ? logger[level] : logger.info;
  write(event, fields);
  try {
    await db.query(
      `INSERT INTO system_events(level, event, action, status, admin_id, user_id, request_id, source, metadata)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
      [level, event, action, status, adminId, userId, requestId(), source, JSON.stringify(scrubMetadata(metadata))],
    );
  } catch (error) {
    logger.error('observability.persist_failed', { action: 'record_event', status: 'failed', metadata: { event }, error });
  }
}

export async function listEvents({ page = 1, pageSize = 50, q = '', level = '', action = '', status = '' } = {}) {
  const safePage = Math.max(1, Number(page) || 1);
  const safeSize = Math.min(100, Math.max(1, Number(pageSize) || 50));
  const values = [];
  const where = [];
  const add = (value) => { values.push(value); return `$${values.length}`; };
  if (q.trim()) {
    const p = add(`%${q.trim().slice(0, 120)}%`);
    where.push(`(event ILIKE ${p} OR action ILIKE ${p} OR metadata::text ILIKE ${p})`);
  }
  if (/^(error|warn|info|debug)$/.test(level)) where.push(`level = ${add(level)}`);
  if (action.trim()) where.push(`action = ${add(action.trim().slice(0, 120))}`);
  if (status.trim()) where.push(`status = ${add(status.trim().slice(0, 64))}`);
  const predicate = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const count = await one(`SELECT count(*)::int AS total FROM system_events ${predicate}`, values);
  const limit = add(safeSize);
  const offset = add((safePage - 1) * safeSize);
  const rows = await many(
    `SELECT e.id, e.created_at, e.level, e.event, e.action, e.status, e.admin_id, e.user_id,
            e.request_id, e.source, e.metadata, a.username AS admin_username, u.username AS vpn_username
       FROM system_events e
       LEFT JOIN admins a ON a.id=e.admin_id
       LEFT JOIN vpn_users u ON u.id=e.user_id
       ${predicate}
      ORDER BY e.created_at DESC, e.id DESC
      LIMIT ${limit} OFFSET ${offset}`,
    values,
  );
  return { rows, page: safePage, pageSize: safeSize, total: count?.total || 0 };
}

export async function getEventStats() {
  const stats = await many(`
    SELECT level, count(*)::int AS count
    FROM system_events
    GROUP BY level
  `);
  return stats.reduce((acc, row) => ({ ...acc, [row.level]: Number(row.count) }), { error: 0, warn: 0, info: 0, debug: 0 });
}
