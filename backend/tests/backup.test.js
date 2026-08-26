import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL ||= 'postgres://localhost/zvpn_test';
process.env.JWT_SECRET ||= 'test-jwt-secret-test-jwt-secret-test-jwt-secret';
process.env.MASTER_KEY ||= 'test-master-key-test-master-key-test-master-key';

const { validateSettingsPatch } = await import('../src/services/settings.js');
const { encryptSecret, decryptSecret } = await import('../src/crypto.js');

test('telegram settings patch schema validation accepts valid config and rejects invalid types', () => {
  const valid = validateSettingsPatch('telegram', {
    enabled: true,
    botToken: '123456789:ABCDEF_ghijk-lmnopqrstuvwxyz12345',
    chatId: '-1001234567890',
    intervalHours: 6,
    includeAdmins: true,
  });
  assert.equal(valid.success, true);
  assert.equal(valid.data.enabled, true);
  assert.equal(valid.data.intervalHours, 6);

  const invalid = validateSettingsPatch('telegram', {
    intervalHours: 500, // exceeds max 168
  });
  assert.equal(invalid.success, false);
});

test('secret_plain is re-encrypted on import and decrypts correctly', () => {
  const originalPassword = 'MySecretVPNPassword#2026';
  const originalEncrypted = encryptSecret(originalPassword);

  // Simulating backup export
  const exportedUser = {
    username: 'user1',
    secret_enc: originalEncrypted,
    secret_plain: decryptSecret(originalEncrypted),
  };
  assert.equal(exportedUser.secret_plain, originalPassword);

  // Simulating restore on a server with new encryption
  const restoredEncrypted = encryptSecret(exportedUser.secret_plain);
  const finalDecrypted = decryptSecret(restoredEncrypted);
  assert.equal(finalDecrypted, originalPassword);
});
