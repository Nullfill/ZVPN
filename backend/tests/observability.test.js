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
