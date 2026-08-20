import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const required = ['DATABASE_URL', 'JWT_SECRET', 'MASTER_KEY'];
for (const key of required) {
  if (!process.env[key]) throw new Error(`Missing environment variable: ${key}`);
}

function numberFromEnv(name, fallback, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`Invalid environment variable: ${name}`);
  }
  return value;
}

if (process.env.NODE_ENV === 'production') {
  for (const key of ['JWT_SECRET', 'MASTER_KEY']) {
    if (Buffer.byteLength(process.env[key], 'utf8') < 32) {
      throw new Error(`${key} must contain at least 32 bytes in production`);
    }
  }
}

function readAppVersion() {
  if (process.env.APP_VERSION) return process.env.APP_VERSION;
  try {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
    return fs.readFileSync(path.join(root, 'VERSION'), 'utf8').trim();
  } catch {
    return '2.2.0';
  }
}

function durationEnv(name, fallback, minimum) {
  const value = Number(process.env[name] ?? fallback);
  return Number.isFinite(value) && value >= minimum ? value : fallback;
}

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: numberFromEnv('PORT', 3300, { min: 1, max: 65535 }),
  version: readAppVersion(),
  dbUrl: process.env.DATABASE_URL,
  jwtSecret: process.env.JWT_SECRET,
  masterKey: process.env.MASTER_KEY,
  panelName: process.env.PANEL_NAME || 'ZVPN Panel',
  publicBaseUrl: (process.env.PUBLIC_BASE_URL || 'http://127.0.0.1:3300').replace(/\/$/, ''),
  vpnServer: process.env.VPN_SERVER || '127.0.0.1',
  vpnRemoteId: process.env.VPN_REMOTE_ID || process.env.VPN_SERVER || '127.0.0.1',
  vpnCaCert: process.env.VPN_CA_CERT || '/etc/ipsec.d/cacerts/ikev2-ca-cert.pem',
  vpnSecretsFile: process.env.VPN_SECRETS_FILE || '/opt/zvpn-panel/runtime/ipsec-users.secrets',
  helper: process.env.VPN_HELPER || '/usr/local/sbin/zvpn-helper',
  timezone: process.env.APP_TIMEZONE || 'Asia/Tehran',
  secureCookies: process.env.SECURE_COOKIES !== 'false',
  trustProxy: numberFromEnv('TRUST_PROXY_HOPS', 1, { min: 0, max: 10 }),
  authSessionHours: numberFromEnv('AUTH_SESSION_HOURS', 12, { min: 1, max: 168 }),
  dbPoolMax: numberFromEnv('DB_POOL_MAX', 10, { min: 2, max: 100 }),
  dbIdleTimeoutMs: numberFromEnv('DB_IDLE_TIMEOUT_MS', 30000, { min: 1000, max: 600000 }),
  dbConnectTimeoutMs: numberFromEnv('DB_CONNECT_TIMEOUT_MS', 5000, { min: 1000, max: 60000 }),
  dbStatementTimeoutMs: numberFromEnv('DB_STATEMENT_TIMEOUT_MS', 30000, { min: 1000, max: 300000 }),
  pollMs: Math.max(5000, Number(process.env.QUOTA_POLL_MS || 15000)),
  // Duplicate IKE_SA observations are expected briefly while a client
  // reconnects/reauthenticates (make-before-break).  Do not enforce the
  // device limit until this grace window has elapsed.
  sessionGraceMs: durationEnv('SESSION_GRACE_MS', 45000, 5000),
  // A successful terminate is not retried while the SA is still reported by
  // swanctl.  Failed commands may be retried after this interval.
  sessionTerminateRetryMs: durationEnv('SESSION_TERMINATE_RETRY_MS', 30000, 5000),
  downloadDays: Math.max(1, Number(process.env.DOWNLOAD_TOKEN_DAYS || 30)),
};
