import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';
import { config } from './config.js';
import { db, many, one, closeDatabase } from './db.js';
import {
  verifyAdmin, signAdmin, requireAdmin, requireRole, authCookieOptions,
  revokeAdminSession, revokeAllAdminSessions,
} from './auth.js';
import { randomPassword } from './crypto.js';
import { androidProfile, iosProfile, windowsProfile, windowsLauncher, downloadPageHtml, jsonProfile } from './profiles.js';
import { audit } from './audit.js';
import { getLiveSessions, startWorker, disconnectUser } from './worker.js';
import { disconnectIkeId } from './vpn.js';
import { runMigrations } from './migrate.js';
import { syncSecretsNow, syncStatus } from './services/syncQueue.js';
import { listUsers, getUserById, provisionUser, updateUser, extendUser, addTraffic, deleteUser, regenerateToken, revokeToken, getUserStats, downloadLinks, bulkUsers, resetActivation, resetUserPassword } from './services/users.js';
import { getSettings, updateSettings, validateSettingsPatch } from './services/settings.js';
import { mountV211Routes } from './routes/v211.js';
import { apiError, errorHandler, notFoundHandler } from './utils/errors.js';
import { bytes } from './utils/format.js';
import { asyncHandler } from './middleware/asyncHandler.js';
import { requestContext } from './middleware/requestContext.js';

const execFileAsync = promisify(execFile);
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', config.trustProxy);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
app.use(requestContext);

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
});
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 180,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
});

const operatorOnly = requireRole('operator');
const adminOnly = requireRole('admin');

function clientIp(req) { return req.ip || null; }

app.use('/api', apiLimiter);

app.get('/api/health', (_req, res) => res.json({ ok: true, name: config.panelName, version: config.version }));

app.post('/api/auth/login', loginLimiter, asyncHandler(async (req, res) => {
  const p = z.object({
    username: z.string().trim().min(1).max(64),
    password: z.string().min(1).max(256),
  }).strict().safeParse(req.body);
  if (!p.success) return apiError(res, 400, 'INVALID_INPUT');
  const admin = await verifyAdmin(p.data.username, p.data.password);
  if (!admin) {
    await audit(null, 'admin.login_failed', 'admin', null, { username: p.data.username }, clientIp(req));
    return apiError(res, 401, 'INVALID_CREDENTIALS');
  }
  const token = await signAdmin(admin, { ip: clientIp(req), userAgent: req.get('user-agent') });
  res.cookie('zvpn_token', token, authCookieOptions());
  await audit(admin.id, 'admin.login', null, null, {}, clientIp(req));
  res.json({ user: { id: admin.id, username: admin.username, role: admin.role || 'admin' } });
}));

app.post('/api/auth/logout', requireAdmin, asyncHandler(async (req, res) => {
  await revokeAdminSession(req.authSession?.id);
  res.clearCookie('zvpn_token', { path: '/' });
  await audit(req.admin.id, 'admin.logout', null, null, {}, clientIp(req));
  res.json({ ok: true });
}));

app.get('/api/me', requireAdmin, asyncHandler(async (req, res) => {
  const s = await getSettings();
  res.json({ user: req.admin, panelName: s.general?.panelName || config.panelName });
}));

app.get('/api/dashboard', requireAdmin, asyncHandler(async (req, res) => {
  const [totals, today, month] = await Promise.all([
    one(`SELECT count(*)::int AS users, count(*) FILTER(WHERE enabled AND NOT quota_blocked AND (expires_at IS NULL OR expires_at>now()))::int AS active,
      count(*) FILTER(WHERE expires_at IS NOT NULL AND expires_at<=now())::int AS expired,
      COALESCE(sum(usage_total),0)::bigint AS bytes FROM vpn_users`),
    one(`SELECT COALESCE(sum(bytes),0)::bigint AS bytes FROM usage_daily WHERE usage_date=(now() AT TIME ZONE $1)::date`, [config.timezone]),
    one(`SELECT COALESCE(sum(bytes),0)::bigint AS bytes FROM usage_daily WHERE usage_date >= date_trunc('month', now() AT TIME ZONE $1)::date`, [config.timezone]),
  ]);
  let disk = null, strongswan = 'unknown';
  try {
    const { stdout } = await execFileAsync('df', ['-B1', '--output=size,used,avail,pcent', '/']);
    const line = stdout.trim().split('\n').pop().trim().split(/\s+/);
    disk = { size: Number(line[0]), used: Number(line[1]), avail: Number(line[2]), percent: line[3] };
  } catch {}
  try { await execFileAsync('systemctl', ['is-active', 'strongswan-starter']); strongswan = 'active'; } catch { strongswan = 'inactive'; }
  const sessions = getLiveSessions();
  res.json({
    totals: { ...totals, bytes: Number(totals.bytes), todayBytes: Number(today.bytes), monthBytes: Number(month.bytes), online: sessions.length },
    system: { load: os.loadavg()[0], memoryUsed: os.totalmem() - os.freemem(), memoryTotal: os.totalmem(), uptime: os.uptime(), disk, strongswan, cpuCount: os.cpus().length },
    recent: await many('SELECT username, last_seen_at, usage_total, created_at FROM vpn_users ORDER BY created_at DESC LIMIT 5'),
    sessions, sync: syncStatus(),
  });
}));

const bytesInput = z.union([
  z.number().finite().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  z.string().regex(/^\d+$/).transform(Number).pipe(z.number().finite().int().nonnegative().max(Number.MAX_SAFE_INTEGER)),
]).nullable();

const userSchema = z.object({
  username: z.string().regex(/^[A-Za-z0-9_.@-]{3,64}$/),
  password: z.preprocess((v) => (typeof v === 'string' && !v.trim()) || v == null ? undefined : v, z.string().min(8).max(128).optional()),
  expiresAt: z.string().datetime().nullable().optional(),
  durationDays: z.coerce.number().int().min(1).max(3650).nullable().optional(),
  dailyLimitBytes: bytesInput.optional(),
  totalLimitBytes: bytesInput.optional(),
  unlimitedTraffic: z.boolean().optional(),
  maxDevices: z.coerce.number().int().min(1).max(10).default(1),
  note: z.string().max(500).optional().nullable(),
}).strict();

const userPatchSchema = z.object({
  enabled: z.boolean().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  durationDays: z.coerce.number().int().min(1).max(3650).nullable().optional(),
  dailyLimitBytes: bytesInput.optional(),
  totalLimitBytes: bytesInput.optional(),
  unlimitedTraffic: z.boolean().optional(),
  maxDevices: z.coerce.number().int().min(1).max(10).optional(),
  note: z.string().max(500).nullable().optional(),
  resetUsage: z.boolean().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, { message: 'At least one field is required' });

function requireUserId(req, res, next) {
  if (!z.string().uuid().safeParse(req.params.id).success) return apiError(res, 400, 'INVALID_INPUT');
  return next();
}

app.get('/api/users', requireAdmin, asyncHandler(async (req, res) => {
  let users = await listUsers();
  const search = String(req.query.search || '').trim().toLowerCase();
  const status = String(req.query.status || '');
  if (search) users = users.filter((u) => u.username.toLowerCase().includes(search));
  if (status === 'online') users = users.filter((u) => u.online > 0);
  else if (status === 'active') users = users.filter((u) => u.status === 'active');
  else if (status === 'disabled') users = users.filter((u) => u.status === 'disabled');
  else if (status === 'expired') users = users.filter((u) => u.status === 'expired');
  else if (status === 'not_activated') users = users.filter((u) => u.status === 'not_activated');
  res.json({ users });
}));

app.post('/api/users/bulk', requireAdmin, operatorOnly, asyncHandler(async (req, res) => {
  const p = z.object({
    ids: z.array(z.string().uuid()).min(1).max(500),
    action: z.enum(['enable', 'disable', 'delete']),
  }).strict().safeParse(req.body);
  if (!p.success) return apiError(res, 400, 'INVALID_INPUT');
  const count = await bulkUsers(p.data.ids, p.data.action);
  await audit(req.admin.id, 'user.bulk', 'user', null, p.data, clientIp(req));
  res.json({ ok: true, count });
}));

app.get('/api/users/:id', requireAdmin, requireUserId, asyncHandler(async (req, res) => {
  const user = await getUserById(req.params.id);
  if (!user) return apiError(res, 404, 'NOT_FOUND');
  res.json({ user, stats: await getUserStats(req.params.id), links: user.downloadToken ? downloadLinks(user.downloadToken) : null });
}));

app.post('/api/users', requireAdmin, operatorOnly, asyncHandler(async (req, res) => {
  const p = userSchema.safeParse(req.body);
  if (!p.success) return apiError(res, 400, 'INVALID_INPUT', p.error.flatten());
  try {
    const result = await provisionUser(p.data);
    await audit(req.admin.id, 'user.create', 'user', result.user.id, { username: result.user.username }, clientIp(req));
    res.status(201).json(result);
  } catch (e) {
    if (e.code === '23505') return apiError(res, 409, 'USERNAME_EXISTS');
    throw e;
  }
}));

app.patch('/api/users/:id', requireAdmin, operatorOnly, requireUserId, asyncHandler(async (req, res) => {
  const p = userPatchSchema.safeParse(req.body);
  if (!p.success) return apiError(res, 400, 'INVALID_INPUT');
  const user = await updateUser(req.params.id, p.data);
  if (!user) return apiError(res, 404, 'NOT_FOUND');
  await audit(req.admin.id, 'user.update', 'user', user.id, p.data, clientIp(req));
  res.json({ ok: true, user });
}));

app.post('/api/users/:id/extend', requireAdmin, operatorOnly, requireUserId, asyncHandler(async (req, res) => {
  const parsed = z.object({ days: z.coerce.number().int().min(1).max(3650) }).strict().safeParse(req.body);
  if (!parsed.success) return apiError(res, 400, 'INVALID_INPUT', parsed.error.flatten());
  const days = parsed.data.days;
  const user = await extendUser(req.params.id, days);
  if (!user) return apiError(res, 404, 'NOT_FOUND');
  res.json({ user });
}));

app.post('/api/users/:id/add-traffic', requireAdmin, operatorOnly, requireUserId, asyncHandler(async (req, res) => {
  const parsed = z.object({ gigabytes: z.coerce.number().finite().positive().max(1_000_000) }).strict().safeParse(req.body);
  if (!parsed.success) return apiError(res, 400, 'INVALID_INPUT', parsed.error.flatten());
  const gb = parsed.data.gigabytes;
  const user = await addTraffic(req.params.id, Math.round(gb * 1024 ** 3));
  if (!user) return apiError(res, 404, 'NOT_FOUND');
  res.json({ user });
}));

app.post('/api/users/:id/reset-password', requireAdmin, operatorOnly, requireUserId, asyncHandler(async (req, res) => {
  const parsed = z.object({ password: z.string().min(8).max(128).optional() }).strict().safeParse(req.body);
  if (!parsed.success) return apiError(res, 400, 'INVALID_INPUT', parsed.error.flatten());
  const result = await resetUserPassword(req.params.id, parsed.data.password || randomPassword());
  if (!result) return apiError(res, 404, 'NOT_FOUND');
  await audit(req.admin.id, 'user.password_reset', 'user', req.params.id, { syncOk: result.syncOk }, clientIp(req));
  res.json(result);
}));

app.post('/api/users/:id/regenerate-link', requireAdmin, operatorOnly, requireUserId, asyncHandler(async (req, res) => {
  const l = await regenerateToken(req.params.id);
  if (!l) return apiError(res, 404, 'NOT_FOUND');
  res.json({ links: l });
}));

app.post('/api/users/:id/revoke-link', requireAdmin, operatorOnly, requireUserId, asyncHandler(async (req, res) => {
  if (!await revokeToken(req.params.id)) return apiError(res, 404, 'NOT_FOUND');
  res.json({ ok: true });
}));

app.post('/api/users/:id/disconnect', requireAdmin, operatorOnly, requireUserId, asyncHandler(async (req, res) => {
  const u = await one('SELECT username FROM vpn_users WHERE id=$1', [req.params.id]);
  if (!u) return apiError(res, 404, 'NOT_FOUND');
  res.json({ ok: true, disconnected: await disconnectUser(u.username) });
}));

app.post('/api/users/:id/reset-activation', requireAdmin, operatorOnly, requireUserId, asyncHandler(async (req, res) => {
  const user = await resetActivation(req.params.id);
  if (!user) return apiError(res, 404, 'NOT_FOUND');
  await audit(req.admin.id, 'user.reset_activation', 'user', user.id, {}, clientIp(req));
  res.json({ user });
}));

app.delete('/api/users/:id', requireAdmin, operatorOnly, requireUserId, asyncHandler(async (req, res) => {
  const u = await one('SELECT username FROM vpn_users WHERE id=$1', [req.params.id]);
  if (!u) return apiError(res, 404, 'NOT_FOUND');
  await deleteUser(req.params.id);
  await audit(req.admin.id, 'user.delete', 'user', req.params.id, { username: u.username }, clientIp(req));
  res.json({ ok: true });
}));

app.get('/api/sessions', requireAdmin, (_req, res) => res.json({ sessions: getLiveSessions() }));
app.delete('/api/sessions/:ikeId', requireAdmin, operatorOnly, asyncHandler(async (req, res) => {
  const ikeId = req.params.ikeId;
  await disconnectIkeId(ikeId);
  await audit(req.admin.id, 'vpn.session.disconnect', 'session', ikeId, { ikeId }, clientIp(req));
  res.json({ ok: true, disconnected: ikeId });
}));
app.post('/api/sessions/disconnect-all', requireAdmin, adminOnly, asyncHandler(async (req, res) => {
  const s = getLiveSessions();
  await Promise.all(s.map((x) => disconnectIkeId(x.ikeId).catch(() => null)));
  await audit(req.admin.id, 'vpn.session.disconnect_all', 'session', null, { count: s.length }, clientIp(req));
  res.json({ ok: true, disconnected: s.length });
}));

app.get('/api/audit', requireAdmin, asyncHandler(async (_req, res) => {
  res.json({ logs: await many(`SELECT a.*, ad.username AS admin_username FROM audit_logs a LEFT JOIN admins ad ON ad.id=a.admin_id ORDER BY a.created_at DESC LIMIT 200`) });
}));

app.get('/api/settings', requireAdmin, asyncHandler(async (_req, res) => res.json({ settings: await getSettings() })));
app.patch('/api/settings/:section', requireAdmin, adminOnly, asyncHandler(async (req, res) => {
  const section = req.params.section;
  const parsed = validateSettingsPatch(section, req.body);
  if (!parsed.success) return apiError(res, 400, 'INVALID_INPUT', parsed.error?.flatten?.());
  if (section === 'vpn' && (Object.hasOwn(req.body, 'serverAddress') || Object.hasOwn(req.body, 'remoteId'))) {
    return apiError(res, 400, 'ENDPOINT_USE_WIZARD');
  }
  const updated = await updateSettings(section, parsed.data);
  await audit(req.admin.id, 'settings.update', 'settings', section, parsed.data, clientIp(req));
  res.json({ settings: updated });
}));

app.post('/api/admin/password', requireAdmin, asyncHandler(async (req, res) => {
  const p = z.object({ current: z.string().min(1).max(256), next: z.string().min(12).max(128) }).strict()
    .refine((value) => value.current !== value.next, { path: ['next'], message: 'New password must be different' })
    .safeParse(req.body);
  if (!p.success) return apiError(res, 400, 'INVALID_INPUT');
  const admin = await one('SELECT * FROM admins WHERE id=$1', [req.admin.id]);
  if (!admin) return apiError(res, 401, 'UNAUTHORIZED');
  if (!await bcrypt.compare(p.data.current, admin.password_hash)) return apiError(res, 403, 'BAD_PASSWORD');
  await db.query('UPDATE admins SET password_hash=$1 WHERE id=$2', [await bcrypt.hash(p.data.next, 12), admin.id]);
  await revokeAllAdminSessions(admin.id);
  res.clearCookie('zvpn_token', { path: '/' });
  await audit(admin.id, 'admin.password_change', 'admin', admin.id, {}, clientIp(req));
  res.json({ ok: true, reauthenticate: true });
}));

mountV211Routes(app, { requireAdmin, requireRole, audit, clientIp, asyncHandler });

async function tokenUser(token) {
  return one(`SELECT * FROM vpn_users WHERE download_token=$1 AND download_token_revoked=false AND (download_token_expires_at IS NULL OR download_token_expires_at>now())`, [token]);
}

app.get('/d/:token', asyncHandler(async (req, res) => {
  const u = await tokenUser(req.params.token);
  if (!u) return res.status(404).send('Invalid link');
  const s = await getSettings();
  const today = await one(
    'SELECT COALESCE(bytes,0)::bigint AS bytes FROM usage_daily WHERE user_id=$1 AND usage_date=(now() AT TIME ZONE $2)::date',
    [u.id, config.timezone],
  );
  u.today_bytes = today?.bytes || 0;
  const html = await downloadPageHtml(u, downloadLinks(req.params.token), s);
  res.type('html').send(html);
}));

app.get('/d/:token/json', asyncHandler(async (req, res) => {
  const u = await tokenUser(req.params.token);
  if (!u) return res.status(404).json({ error: 'Invalid or expired link' });
  const today = await one(
    'SELECT COALESCE(bytes,0)::bigint AS bytes FROM usage_daily WHERE user_id=$1 AND usage_date=(now() AT TIME ZONE $2)::date',
    [u.id, config.timezone],
  );
  u.today_bytes = today?.bytes || 0;
  res.json(await jsonProfile(u));
}));

app.get('/d/:token/android', asyncHandler(async (req, res) => { const u = await tokenUser(req.params.token); if (!u) return res.status(404).send('Expired'); res.set({ 'Content-Type': 'application/vnd.strongswan.profile', 'Content-Disposition': `attachment; filename="${u.username}.sswan"` }); res.send(await androidProfile(u)); }));
app.get('/d/:token/ios', asyncHandler(async (req, res) => { const u = await tokenUser(req.params.token); if (!u) return res.status(404).send('Expired'); res.set({ 'Content-Type': 'application/x-apple-aspen-config', 'Content-Disposition': `attachment; filename="${u.username}.mobileconfig"` }); res.send(await iosProfile(u)); }));
app.get('/d/:token/windows', asyncHandler(async (req, res) => { const u = await tokenUser(req.params.token); if (!u) return res.status(404).send('Expired'); res.set({ 'Content-Disposition': `attachment; filename="${u.username}-windows-setup.ps1"` }); res.send(await windowsProfile(u)); }));
app.get('/d/:token/windows-launcher', asyncHandler(async (req, res) => { const u = await tokenUser(req.params.token); if (!u) return res.status(404).send('Expired'); res.set({ 'Content-Disposition': `attachment; filename="${u.username}-windows-install.cmd"` }); res.send(windowsLauncher(req.params.token)); }));

app.get('/download/windows-client.exe', (req, res) => {
  const exePath = path.resolve('clients/windows/dist/ZVPN-Windows-Client.exe');
  res.download(exePath, 'ZVPN-Windows-Client.exe', (err) => {
    if (err && !res.headersSent) res.status(404).send('Windows Client binary not packaged on server');
  });
});

app.get('/download/strongswan-win64.tar.gz', (req, res) => {
  const possiblePaths = [
    '/opt/zvpn-panel/backend/public/strongswan-win64.tar.gz',
    '/tmp/strongswan-win64.tar.gz',
    path.resolve('public/strongswan-win64.tar.gz'),
  ];
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) return res.download(p, 'strongswan-win64.tar.gz');
  }
  res.status(404).send('Not Found');
});

app.use(notFoundHandler);
app.use(errorHandler);

await runMigrations();
await syncSecretsNow().catch((e) => console.error('[startup sync]', e.message));
startWorker();

const server = app.listen(config.port, '127.0.0.1', () => console.log(`${config.panelName} v${config.version} on 127.0.0.1:${config.port}`));
let shuttingDown = false;
function shutdown(sig, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[shutdown] ${sig}`);
  const forceTimer = setTimeout(() => process.exit(exitCode || 1), 10000);
  forceTimer.unref();
  server.close(async () => {
    try {
      await closeDatabase();
      process.exit(exitCode);
    } catch (error) {
      console.error('[shutdown.db]', error);
      process.exit(1);
    }
  });
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (error) => {
  console.error('[unhandledRejection]', error);
  shutdown('unhandledRejection', 1);
});
process.on('uncaughtException', (error) => {
  console.error('[uncaughtException]', error);
  shutdown('uncaughtException', 1);
});
