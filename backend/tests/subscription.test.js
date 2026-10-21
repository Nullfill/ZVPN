import test from 'node:test';
import assert from 'node:assert/strict';
import { subscriptionInfo, subscriptionLinks } from '../src/services/subscription.js';

const user = { id: '11111111-1111-4111-8111-111111111111', xray_uuid: '22222222-2222-4222-8222-222222222222',
  username: 'test', usage_total: String(3 * 1024 ** 3), total_limit_bytes: String(10 * 1024 ** 3), upload_bytes: '1234', expires_at: '2030-01-04T00:00:00Z' };
const now = Date.parse('2030-01-01T00:00:00Z');

test('one subscription has the two real accounts and a final local-only information entry', () => {
  const links = subscriptionLinks(user, 'https://vpn.example.com', { netlify: { enabled: true, hostname: 'relay.example.com' } }, now);
  assert.equal(links.length, 3);
  assert.equal(new URL(links[0]).username, user.xray_uuid);
  assert.equal(new URL(links[1]).username, user.xray_uuid);
  const info = new URL(links[2]);
  assert.equal(info.hostname, '127.0.0.1');
  assert.equal(info.port, '9');
  assert.ok(decodeURIComponent(info.hash).includes('7.00 GB'));
  assert.ok(decodeURIComponent(info.hash).includes('3 روز'));
  assert.ok(!links[2].includes(user.xray_uuid));
});

test('metadata uses the shared usage total, including IKE, and retains exact byte counters', () => {
  const info = subscriptionInfo({ ...user, usage_total: '9007199254740993', total_limit_bytes: '9007199254740999' }, now);
  assert.ok(info.userinfo.includes('download=9007199254739759; total=9007199254740999;'));
  assert.ok(info.userinfo.startsWith('upload=1234;'));
  assert.ok(subscriptionInfo({ ...user, usage_total: '0' }, now).userinfo.startsWith('upload=0; download=0;'));
});

test('expired, exhausted, unlimited and not-yet-activated accounts have truthful labels', () => {
  assert.ok(subscriptionInfo(user, Date.parse('2030-02-01')).label.includes('اعتبار تمام شده'));
  assert.ok(subscriptionInfo({ ...user, usage_total: String(12 * 1024 ** 3) }, now).label.includes('0.00 GB'));
  const unlimited = subscriptionInfo({ ...user, unlimited_traffic: true, expires_at: null }, now);
  assert.ok(unlimited.label.includes('حجم نامحدود'));
  assert.ok(unlimited.userinfo.endsWith('total=0; expire=0'));
  assert.ok(subscriptionInfo({ ...user, expires_at: null, duration_days: 30 }, now).label.includes('30 روز پس از اولین اتصال'));
  assert.equal(subscriptionLinks(user, 'https://vpn.example.com', { xray: { enabled: false } }).length, 0);
  assert.equal(subscriptionLinks(user, 'https://vpn.example.com', {}).length, 2);
});
