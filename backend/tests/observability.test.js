import test from 'node:test';
import assert from 'node:assert/strict';

const { scrubMetadata, runWithRequestContext, requestId } = await import('../src/logger.js');

test('scrubMetadata redacts sensitive keys recursively', () => {
  const sensitiveObj = {
    username: 'alice',
    password: 'SuperSecretPassword',
    token: 'jwt.token.here',
    master_key: '0123456789abcdef',
    details: {
      cookie: 'session=123',
      nestedSecret: 'secret-key-xyz',
      safeField: 'normal value',
    },
  };

  const scrubbed = scrubMetadata(sensitiveObj);
  assert.equal(scrubbed.username, 'alice');
  assert.equal(scrubbed.password, '[redacted]');
  assert.equal(scrubbed.token, '[redacted]');
  assert.equal(scrubbed.master_key, '[redacted]');
  assert.equal(scrubbed.details.cookie, '[redacted]');
  assert.equal(scrubbed.details.nestedSecret, '[redacted]');
  assert.equal(scrubbed.details.safeField, 'normal value');
});

test('runWithRequestContext propagates requestId correctly within AsyncLocalStorage store', async () => {
  const customId = 'req-trace-uuid-12345';
  let insideId = null;

  await runWithRequestContext(customId, async () => {
    insideId = requestId();
  });

  assert.equal(insideId, customId);
});

test('errors default to a failed outcome while expected quota warnings remain successful actions', async (t) => {
  process.env.DATABASE_URL ||= 'postgres://localhost/zvpn_test';
  process.env.JWT_SECRET ||= 'test-jwt-secret-test-jwt-secret-test-jwt-secret';
  process.env.MASTER_KEY ||= 'test-master-key-test-master-key-test-master-key';
  const { db } = await import('../src/db.js');
  const { logger } = await import('../src/logger.js');
  const { recordEvent } = await import('../src/services/observability.js');
  const rows = [];
  t.mock.method(db, 'query', async (_sql, values) => { rows.push(values); return { rows: [] }; });
  for (const level of ['error', 'warn', 'info']) t.mock.method(logger, level, () => {});
  await recordEvent({ level: 'error', event: 'test.failure' });
  await recordEvent({ level: 'warn', event: 'vpn.quota_blocked' });
  await recordEvent({ level: 'warn', event: 'admin.login_failed', status: 'failed' });
  assert.deepEqual(rows.map(row => [row[0], row[3]]), [['error', 'failed'], ['warn', 'success'], ['warn', 'failed']]);
});
