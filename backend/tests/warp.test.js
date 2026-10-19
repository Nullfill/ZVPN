import test from 'node:test';
import assert from 'node:assert/strict';
process.env.DATABASE_URL ||= 'postgres://localhost/zvpn_test';
process.env.JWT_SECRET ||= 'test-jwt-secret-test-jwt-secret-test-jwt-secret';
process.env.MASTER_KEY ||= 'test-master-key-test-master-key-test-master-key';
const { validateSettingsPatch } = await import('../src/services/settings.js');
import { WARP_DEFAULTS } from '../src/services/warpDefaults.js';

test('WARP settings accept explicit domains and user scope but reject executable/routing input', () => {
  assert.equal(validateSettingsPatch('warp', WARP_DEFAULTS).success, true);
  for (const patch of [{ domains: ['https://google.com/'] }, { domains: [] }, { domains: ['*.google.com'] },
    { scope: 'any' }, { enabled: 'true' }, { userIds: ['root'] }, { command: 'reboot' }, { failureMode: 'shell' }]) {
    assert.equal(validateSettingsPatch('warp', patch).success, false, JSON.stringify(patch));
  }
  assert.deepEqual(validateSettingsPatch('warp', { domains: ['Gemini.Google.Com'] }).data.domains, ['gemini.google.com']);
});
