import { z } from 'zod';
import { exportPanelBackup, importPanelBackup } from '../services/backup.js';
import { getVpnProfileConfig } from '../services/vpnConfig.js';
import { listEvents, getEventStats } from '../services/observability.js';
import {
  getEndpointStatus, validateEndpointChange, applyEndpointChange, listEndpointHistory, EndpointError,
} from '../services/vpnEndpointManager.js';
import { apiError, endpointError } from '../utils/errors.js';

/** Mount v2.1 routes on existing Express app */
export function mountV211Routes(app, ctx) {
  const { requireAdmin, requireRole, audit, clientIp, asyncHandler } = ctx;
  const adminOnly = requireRole('admin');

  app.get('/api/observability/events', requireAdmin, asyncHandler(async (req, res) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 50));
    const q = String(req.query.q || '');
    const level = String(req.query.level || '');
    const action = String(req.query.action || '');
    const status = String(req.query.status || '');
    const result = await listEvents({ page, pageSize, q, level, action, status });
    res.json(result);
  }));

  app.get('/api/observability/stats', requireAdmin, asyncHandler(async (_req, res) => {
    const stats = await getEventStats();
    res.json({ stats });
  }));

  app.get('/api/vpn-config', requireAdmin, asyncHandler(async (_req, res) => {
    res.json({ config: await getVpnProfileConfig() });
  }));

  app.get('/api/vpn-endpoint/status', requireAdmin, asyncHandler(async (_req, res) => {
    try {
      res.json(await getEndpointStatus());
    } catch (e) {
      console.error('[vpn-endpoint.status]', e);
      apiError(res, 500, 'INTERNAL_ERROR');
    }
  }));

  app.post('/api/vpn-endpoint/validate', requireAdmin, adminOnly, asyncHandler(async (req, res) => {
    const p = z.object({ endpoint: z.string().trim().min(1).max(253) }).strict().safeParse(req.body);
    if (!p.success) return apiError(res, 400, 'INVALID_INPUT');
    try {
      res.json(await validateEndpointChange(p.data.endpoint));
    } catch (e) {
      if (e instanceof EndpointError) return endpointError(res, e);
      console.error('[vpn-endpoint.validate]', e);
      apiError(res, 500, 'INTERNAL_ERROR');
    }
  }));

  app.post('/api/vpn-endpoint/apply', requireAdmin, adminOnly, asyncHandler(async (req, res) => {
    const p = z.object({
      endpoint: z.string().trim().min(1).max(253),
      confirmNewCert: z.boolean().default(false),
    }).strict().safeParse(req.body);
    if (!p.success) return apiError(res, 400, 'INVALID_INPUT');
    try {
      const result = await applyEndpointChange({
        endpoint: p.data.endpoint,
        confirmNewCert: p.data.confirmNewCert,
        adminId: req.admin.id,
      });
      await audit(req.admin.id, 'vpn.endpoint.apply', 'system', null, {
        endpoint: p.data.endpoint,
        confirmNewCert: p.data.confirmNewCert,
      }, clientIp(req));
      res.json(result);
    } catch (e) {
      if (e instanceof EndpointError) return endpointError(res, e);
      console.error('[vpn-endpoint.apply]', e);
      apiError(res, 500, 'INTERNAL_ERROR');
    }
  }));

  app.get('/api/vpn-endpoint/history', requireAdmin, asyncHandler(async (_req, res) => {
    res.json({ history: await listEndpointHistory() });
  }));

  app.get('/api/backup/export', requireAdmin, adminOnly, asyncHandler(async (req, res) => {
    try {
      const includeAdmins = String(req.query.includeAdmins || '').toLowerCase() === 'true';
      const data = await exportPanelBackup({ includeAdmins });
      await audit(req.admin.id, 'backup.export', 'system', null, { users: data.counts.users }, clientIp(req));
      const filename = `zvpn-backup-${new Date().toISOString().slice(0, 10)}.json`;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(JSON.stringify(data, null, 2));
    } catch (e) {
      console.error('[backup.export]', e);
      apiError(res, 500, 'INTERNAL_ERROR');
    }
  }));

  app.post('/api/backup/import', requireAdmin, adminOnly, asyncHandler(async (req, res) => {
    const schema = z.object({
      backup: z.record(z.unknown()),
      mode: z.enum(['merge', 'full', 'users-only']).default('merge'),
      confirm: z.literal(true),
    }).strict();
    const p = schema.safeParse(req.body);
    if (!p.success) return apiError(res, 400, 'INVALID_INPUT');
    try {
      const result = await importPanelBackup(p.data.backup, { mode: p.data.mode });
      await audit(req.admin.id, 'backup.import', 'system', null, result, clientIp(req));
      res.json({ ok: true, result, message: 'بازیابی با موفقیت انجام شد. لینک‌های دانلود کاربران همان token قبلی را دارند؛ فقط آدرس VPN از تنظیمات جدید اعمال می‌شود.' });
    } catch (e) {
      if (e.message === 'INVALID_BACKUP_FORMAT') return apiError(res, 400, 'INVALID_INPUT');
      console.error('[backup.import]', e);
      apiError(res, 500, 'INTERNAL_ERROR');
    }
  }));
}
