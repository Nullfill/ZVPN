import { db } from './db.js';
import { recordEvent } from './services/observability.js';

export async function audit(adminId, action, targetType = null, targetId = null, meta = {}, ip = null) {
  try {
    await db.query(
      'INSERT INTO audit_logs(admin_id, action, target_type, target_id, meta, ip) VALUES($1,$2,$3,$4,$5::jsonb,$6::inet)',
      [adminId || null, action, targetType, targetId, JSON.stringify(meta), ip || null]
    );
  } catch (e) {
    console.error('[audit]', e.message);
  }

  // Also record in structured system_events for observability
  recordEvent({
    level: action.includes('failed') || action.includes('error') ? 'warn' : 'info',
    event: action,
    action: action,
    status: action.includes('failed') ? 'failed' : 'success',
    adminId: adminId || null,
    metadata: { ...meta, targetType, targetId, ip },
  }).catch(() => {});
}
