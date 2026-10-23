import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { xrayRelayLink, xrayRelayTemplate, mergeXrayRelayTemplate, xrayRelayPolicy } from '../src/services/xrayRelayConfig.js';
import { connectionLinks } from '../src/services/netlifyConfig.js';
import { buildXrayConfig, parseXrayStats } from '../src/services/xrayConfig.js';
import { renderUserPortal } from '../src/services/userPortal.js';

const user = { id: randomUUID(), xray_uuid: randomUUID(), username: 'sample', enabled: true };
const policy = { enabled: true, hostname: 'ir.example.com', port: 14452, outboundTag: 'tunnel-1' };
const origin = 'https://vpn.example.com';
test('Iran Xray keeps TLS identity on origin, quota identity on account and uses a separate statistics inlet', () => {
  const link = new URL(xrayRelayLink(user, origin, policy));
  assert.equal(link.hostname, policy.hostname); assert.equal(link.port, '14452');
  assert.equal(link.username, user.xray_uuid); assert.equal(link.searchParams.get('sni'), 'vpn.example.com');
  assert.equal(link.searchParams.get('host'), 'vpn.example.com'); assert.equal(link.searchParams.get('path'), '/zvpn-iran/');
  const cfg = buildXrayConfig([user, { ...user, enabled: false }, { ...user, expires_at: '2000-01-01' }], true, true);
  assert.equal(cfg.inbounds[3].settings.clients.length, 1);
  assert.equal(cfg.inbounds[3].settings.clients[0].id, user.xray_uuid);
  assert.equal(cfg.inbounds[3].settings.clients[0].email, `zvpn-iran-${user.id}`);
  assert.equal(buildXrayConfig([user], true, false).inbounds[3].settings.clients.length, 0);
  assert.equal(buildXrayConfig([user], false, true).inbounds[3].settings.clients.length, 0);
  const stats = parseXrayStats({ stat: [{ name: `user>>>zvpn-iran-${user.id}>>>traffic>>>downlink`, value: '1200' }] });
  assert.equal(stats.get(user.id + ':iran').transport, 'iran'); assert.equal(stats.get(user.id + ':iran').downlink, 1200n);
});
test('subscriptions and portal follow the Iran switch without changing primary IKE downloads', async () => {
  const settings = { xrayRelay: policy, netlify: { enabled: true, hostname: 'relay.example.com' } };
  assert.equal(connectionLinks(user, origin, settings).length, 3);
  assert.equal(connectionLinks(user, origin, { ...settings, xrayRelay: { ...policy, enabled: false } }).length, 2);
  assert.equal(connectionLinks(user, origin, { ...settings, xray: { enabled: false } }).length, 0);
  const links = { landing: origin + '/d/private', android: origin + '/d/private/android', ios: origin + '/d/private/ios' };
  const html = await renderUserPortal(user, links, settings, { vpn: { serverAddress: 'vpn.example.com' }, baseUrl: origin });
  assert.ok(html.includes('id="iran-xray-config"')); assert.ok(html.includes('/iran-xray'));
  assert.equal((html.match(/id="subscription-url"/g) || []).length, 1);
  const hidden = await renderUserPortal(user, links, { xrayRelay: { ...policy, enabled: false } }, { vpn: { serverAddress: 'vpn.example.com' }, baseUrl: origin });
  assert.ok(!hidden.includes('id="iran-xray-config"')); assert.ok(hidden.includes('/d/private/ios'));
});
test('Advanced builder adopts only the known TCP test entry and retains IKE, API and unrelated clients', () => {
  const fragment = xrayRelayTemplate(policy, origin);
  const template = { inbounds: [{ ...fragment.inbounds[0], tag: 'zvpn-xray-relay-test' }, { tag: 'ike', port: 14450, protocol: 'tunnel' }],
    outbounds: [{ tag: 'tunnel-1' }], routing: { rules: [{ inboundTag: ['api'], outboundTag: 'api' }, { inboundTag: ['zvpn-xray-relay-test'], outboundTag: 'tunnel-1' }] } };
  const merged = mergeXrayRelayTemplate(template, fragment);
  assert.deepEqual(mergeXrayRelayTemplate(merged, fragment), merged);
  assert.equal(merged.inbounds.length, 2); assert.deepEqual(merged.inbounds[0], template.inbounds[1]);
  assert.equal(merged.routing.rules[0].outboundTag, 'api');
  assert.equal(merged.inbounds[1].settings.rewriteAddress, 'vpn.example.com');
  assert.equal(merged.inbounds[1].settings.allowedNetwork, 'tcp');
  assert.throws(() => mergeXrayRelayTemplate({ ...template, outbounds: [] }, fragment));
  assert.throws(() => xrayRelayPolicy({ ...policy, hostname: 'ir.example.com\ninclude /root/*' }));
  assert.throws(() => xrayRelayLink(user, origin, { ...policy, hostname: 'vpn.example.com' }));
  assert.throws(() => xrayRelayTemplate(policy, 'https://127.0.0.1'));
});
