import test from 'node:test';
import assert from 'node:assert/strict';
import { renderUserPortal } from '../src/services/userPortal.js';

const user = { id: '11111111-1111-4111-8111-111111111111', xray_uuid: '22222222-2222-4222-8222-222222222222', username: 'sample', enabled: true,
  usage_total: 3 * 1024 ** 3, total_limit_bytes: 10 * 1024 ** 3, expires_at: '2030-01-05T00:00:00Z' };
const links = { landing: 'https://vpn.example.com/d/private-token', android: 'https://vpn.example.com/d/private-token/android', ios: 'https://vpn.example.com/d/private-token/ios' };
const options = { vpn: { serverAddress: 'vpn.example.com' }, baseUrl: 'https://vpn.example.com', panelName: 'Example', now: Date.parse('2030-01-01T00:00:00Z') };
const settings = { netlify: { enabled: true, hostname: 'relay.example.com' } };

test('downloads precede the single combined subscription, with explicit user-initiated app imports', async () => {
  const html = await renderUserPortal(user, links, settings, options);
  assert.ok(html.indexOf('id="downloads"') < html.indexOf('id="subscription"'));
  assert.equal((html.match(/id="subscription-url"/g) || []).length, 1);
  assert.equal((html.match(/alt="QR لینک اشتراک"/g) || []).length, 1);
  assert.ok(html.includes('href="happ://add/https://vpn.example.com/d/private-token/subscription"'));
  assert.ok(html.includes('Profile Downloaded'));
  assert.ok(html.includes('<details class="card" id="alternative-connection">'));
  const main = html.slice(html.indexOf('id="downloads"'), html.indexOf('id="subscription"'));
  assert.ok(!main.includes('Happ'));
  assert.ok(!main.includes('Netlify'));
  assert.ok(main.includes('strongSwan'));
  assert.ok(html.includes('id="netlify-config"'));
  assert.ok(html.includes('id="xray-config"'));
  assert.ok(!html.includes('window.location'));
  assert.ok(!html.includes('fonts.googleapis.com'));
  assert.ok(html.includes('name="referrer" content="no-referrer"'));
});

test('native profiles remain usable with Xray disabled; Netlify controls follow the setting', async () => {
  const native = await renderUserPortal(user, links, { xray: { enabled: false } }, options);
  assert.ok(!native.includes('data-app-import'));
  assert.ok(!native.includes('id="subscription"'));
  assert.ok(native.includes('href="' + links.ios + '"'));
  assert.ok(native.includes('href="' + links.android + '"'));
  assert.ok(native.includes('اتصال اصلی با IKEv2'));
  assert.ok(native.includes('اتصال داخلی آیفون'));
  assert.ok(native.includes('اتصال اندروید با strongSwan'));
  const direct = await renderUserPortal(user, links, {}, options);
  assert.ok(direct.includes('id="subscription-url"'));
  assert.ok(!direct.includes('id="netlify-config"'));
});

test('user-controlled text is escaped and exhausted accounts never show an active status', async () => {
  const html = await renderUserPortal({ ...user, username: '<script>alert(1)</script>', usage_total: 20 * 1024 ** 3 },
    links, { ...settings, download: { pageTitle: '<img src=x onerror=alert(1)>', supportText: '</footer><script>alert(2)</script>' } }, options);
  assert.ok(!html.includes('<script>alert('));
  assert.ok(!html.includes('<img src=x'));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(html.includes('نیاز به تمدید'));
  assert.ok(!html.includes('>اشتراک فعال</span>'));
  assert.ok(html.includes('0 B'));
});
