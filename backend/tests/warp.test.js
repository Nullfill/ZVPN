import test from 'node:test';
import assert from 'node:assert/strict';
process.env.DATABASE_URL ||= 'postgres://localhost/zvpn_test';
process.env.JWT_SECRET ||= 'test-jwt-secret-test-jwt-secret-test-jwt-secret';
process.env.MASTER_KEY ||= 'test-master-key-test-master-key-test-master-key';
const { validateSettingsPatch } = await import('../src/services/settings.js');
import { WARP_DEFAULTS, GEMINI_DOMAINS, ANTIGRAVITY_DOMAINS } from '../src/services/warpDefaults.js';

test('WARP settings accept explicit domains and user scope but reject executable/routing input', () => {
  assert.equal(validateSettingsPatch('warp', WARP_DEFAULTS).success, true);
  for (const patch of [{ domains: ['https://google.com/'] }, { domains: [] }, { domains: ['*.google.com'] },
    { scope: 'any' }, { enabled: 'true' }, { userIds: ['root'] }, { command: 'reboot' }, { failureMode: 'shell' }]) {
    assert.equal(validateSettingsPatch('warp', patch).success, false, JSON.stringify(patch));
  }
  assert.deepEqual(validateSettingsPatch('warp', { domains: ['Gemini.Google.Com'] }).data.domains, ['gemini.google.com']);
});

test('Gemini preset routes the Google verification page and CAPTCHA along with sign-in', () => {
  for (const domain of ['gemini.google.com', 'accounts.google.com', 'www.google.com', 'recaptcha.net', 'gstatic.com']) {
    assert.ok(GEMINI_DOMAINS.includes(domain), domain);
  }
  // Keep the broad Google parent domain out: selecting Gemini should not
  // automatically move every Google product to WARP.
  assert.equal(GEMINI_DOMAINS.includes('google.com'), false);
});


test('Antigravity preset covers desktop API and sign-in without changing Gemini defaults', () => {
  for (const domain of ['daily-cloudcode-pa.googleapis.com', 'cloudcode-pa.googleapis.com',
    'generativelanguage.googleapis.com', 'antigravity.google', 'accounts.google.com']) {
    assert.ok(ANTIGRAVITY_DOMAINS.includes(domain), domain);
  }
  assert.equal(validateSettingsPatch('warp', { domains: ANTIGRAVITY_DOMAINS }).success, true);
  assert.equal(GEMINI_DOMAINS.includes('antigravity.google'), false);
});
