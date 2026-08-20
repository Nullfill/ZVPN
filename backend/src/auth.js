import { createHash, randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { config } from './config.js';
import { db, one } from './db.js';
import { apiError } from './utils/errors.js';

const TOKEN_ISSUER = 'zvpn-panel';
const TOKEN_AUDIENCE = 'zvpn-admin';
const ROLE_RANK = Object.freeze({ viewer: 0, operator: 1, admin: 2, owner: 3 });
// Keep missing-user authentication close to the cost of a real bcrypt check.
const DUMMY_PASSWORD_HASH = '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxH7/3MZfM0pM5Qn1f4rYqv2E6u';

function sessionHash(jti) {
  return createHash('sha256').update(jti).digest('hex');
}

export function authCookieOptions() {
  return {
    httpOnly: true,
    secure: config.secureCookies,
    sameSite: 'strict',
    maxAge: config.authSessionHours * 3600 * 1000,
    path: '/',
  };
}

export async function signAdmin(admin, { ip = null, userAgent = null } = {}) {
  const jti = randomUUID();
  const expiresAt = new Date(Date.now() + config.authSessionHours * 3600 * 1000);
  const role = Object.hasOwn(ROLE_RANK, admin.role) ? admin.role : 'admin';
  const token = jwt.sign(
    { sub: admin.id, username: admin.username, role },
    config.jwtSecret,
    {
      algorithm: 'HS256', issuer: TOKEN_ISSUER, audience: TOKEN_AUDIENCE,
      jwtid: jti, expiresIn: `${config.authSessionHours}h`,
    },
  );

  await db.query(
    `INSERT INTO admin_sessions(admin_id, token_hash, expires_at, ip, user_agent)
     VALUES($1,$2,$3,$4::inet,$5)`,
    [admin.id, sessionHash(jti), expiresAt, ip, userAgent ? String(userAgent).slice(0, 500) : null],
  );
  if (Math.random() < 0.02) {
    db.query('DELETE FROM admin_sessions WHERE expires_at < now() - interval \'7 days\'').catch(() => {});
  }
  return token;
}

export async function requireAdmin(req, res, next) {
  try {
    const token = req.cookies?.zvpn_token;
    if (!token) return apiError(res, 401, 'UNAUTHORIZED');
    const payload = jwt.verify(token, config.jwtSecret, {
      algorithms: ['HS256'], issuer: TOKEN_ISSUER, audience: TOKEN_AUDIENCE,
    });
    if (typeof payload !== 'object' || !payload.sub || !payload.jti) {
      return apiError(res, 401, 'UNAUTHORIZED');
    }

    const session = await one(
      `SELECT s.id AS session_id, s.admin_id, a.username, a.role
         FROM admin_sessions s
         JOIN admins a ON a.id=s.admin_id
        WHERE s.token_hash=$1 AND s.admin_id=$2 AND s.revoked_at IS NULL
          AND s.expires_at > now()`,
      [sessionHash(payload.jti), payload.sub],
    );
    if (!session) return apiError(res, 401, 'UNAUTHORIZED');

    req.admin = { id: session.admin_id, username: session.username, role: session.role || 'admin' };
    req.authSession = { id: session.session_id };
    db.query(
      `UPDATE admin_sessions SET last_seen_at=now()
        WHERE id=$1 AND last_seen_at < now() - interval '5 minutes'`,
      [session.session_id],
    ).catch(() => {});
    return next();
  } catch {
    return apiError(res, 401, 'UNAUTHORIZED');
  }
}

export function hasMinimumRole(role, minimumRole) {
  return Object.hasOwn(ROLE_RANK, role)
    && Object.hasOwn(ROLE_RANK, minimumRole)
    && ROLE_RANK[role] >= ROLE_RANK[minimumRole];
}

export function requireRole(minimumRole) {
  if (!Object.hasOwn(ROLE_RANK, minimumRole)) throw new Error(`Unknown role: ${minimumRole}`);
  return function roleMiddleware(req, res, next) {
    if (!req.admin || !hasMinimumRole(req.admin.role, minimumRole)) {
      return apiError(res, 403, 'FORBIDDEN');
    }
    return next();
  };
}

export async function revokeAdminSession(sessionId) {
  if (!sessionId) return false;
  const result = await db.query(
    'UPDATE admin_sessions SET revoked_at=COALESCE(revoked_at, now()) WHERE id=$1 RETURNING id',
    [sessionId],
  );
  return result.rowCount > 0;
}

export async function revokeAllAdminSessions(adminId) {
  const result = await db.query(
    'UPDATE admin_sessions SET revoked_at=COALESCE(revoked_at, now()) WHERE admin_id=$1 AND revoked_at IS NULL',
    [adminId],
  );
  return result.rowCount;
}

export async function verifyAdmin(username, password) {
  const admin = await one(
    'SELECT id, username, password_hash, role FROM admins WHERE lower(username)=lower($1)',
    [username],
  );
  const ok = await bcrypt.compare(password, admin?.password_hash || DUMMY_PASSWORD_HASH);
  return admin && ok ? admin : null;
}
