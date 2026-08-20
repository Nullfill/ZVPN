import crypto from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const configuredLevel = String(process.env.LOG_LEVEL || 'info').toLowerCase();
const threshold = Object.hasOwn(LEVELS, configuredLevel) ? LEVELS[configuredLevel] : LEVELS.info;
const context = new AsyncLocalStorage();

const SENSITIVE_KEY = /(pass(word)?|secret|token|master[_-]?key|private[_-]?key|authorization|cookie)/i;

function scrub(value, depth = 0) {
  if (depth > 5) return '[truncated]';
  if (value == null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return value.length > 2000 ? `${value.slice(0, 2000)}…` : value;
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => scrub(item, depth + 1));
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).slice(0, 100).map(([key, item]) => [
      key,
      SENSITIVE_KEY.test(key) ? '[redacted]' : scrub(item, depth + 1),
    ]));
  }
  return String(value);
}

export function scrubMetadata(value) {
  return scrub(value);
}

function errorObject(error) {
  if (!error) return undefined;
  return {
    name: error.name,
    message: error.message,
    code: error.code,
    stack: process.env.NODE_ENV === 'production' ? undefined : error.stack,
  };
}

export function requestId() {
  return context.getStore()?.requestId || null;
}

export function runWithRequestContext(requestIdValue, fn) {
  return context.run({ requestId: requestIdValue }, fn);
}

export function requestContextMiddleware(req, res, next) {
  const incoming = String(req.get('x-request-id') || '').trim();
  const id = incoming && /^[A-Za-z0-9._:-]{1,128}$/.test(incoming) ? incoming : crypto.randomUUID();
  req.requestId = id;
  res.setHeader('x-request-id', id);
  runWithRequestContext(id, next);
}

export function writeLog(level, event, fields = {}) {
  const normalized = String(level || 'info').toLowerCase();
  if (!Object.hasOwn(LEVELS, normalized) || LEVELS[normalized] > threshold) return;
  const payload = {
    timestamp: new Date().toISOString(),
    level: normalized,
    event: String(event || 'application.event'),
    requestId: fields.requestId || requestId() || undefined,
    adminId: fields.adminId || undefined,
    userId: fields.userId || undefined,
    action: fields.action || undefined,
    status: fields.status || undefined,
    source: fields.source || 'zvpn-panel',
    metadata: scrub(fields.metadata || {}),
    error: errorObject(fields.error),
  };
  const line = JSON.stringify(Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined)));
  (normalized === 'error' ? console.error : normalized === 'warn' ? console.warn : console.log)(line);
}

export const logger = {
  error: (event, fields) => writeLog('error', event, fields),
  warn: (event, fields) => writeLog('warn', event, fields),
  info: (event, fields) => writeLog('info', event, fields),
  debug: (event, fields) => writeLog('debug', event, fields),
};

export function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

export function errorToLogFields(error) {
  return { error };
}
