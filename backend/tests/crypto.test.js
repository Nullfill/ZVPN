import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL ||= 'postgres://localhost/zvpn_test';
process.env.JWT_SECRET ||= 'test-jwt-secret-test-jwt-secret-test-jwt-secret';
process.env.MASTER_KEY ||= 'test-master-key-test-master-key-test-master-key';

const { encryptSecret, decryptSecret, randomPassword, randomToken } = await import('../src/crypto.js');

test('encryptSecret and decryptSecret roundtrip correctly', () => {
  const secret = 'MySuperSecretP@ssw0rd!123';
  const encrypted = encryptSecret(secret);
  assert.notEqual(encrypted, secret);
  assert.match(encrypted, /^[A-Za-z0-9_-]+$/);

  const decrypted = decryptSecret(encrypted);
  assert.equal(decrypted, secret);
});

test('randomPassword generates valid password of requested length', () => {
  const pass1 = randomPassword(16);
  const pass2 = randomPassword(16);
  assert.equal(pass1.length, 16);
  assert.notEqual(pass1, pass2);
});

test('randomToken generates unique base64url tokens', () => {
  const t1 = randomToken();
  const t2 = randomToken();
  assert.equal(t1.length, 43);
  assert.notEqual(t1, t2);
});
