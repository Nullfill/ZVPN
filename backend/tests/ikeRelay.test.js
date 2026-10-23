import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { relayPolicy, relayTemplate, mergeRelayTemplate } from '../src/services/ikeRelayConfig.js';
import { parseSas } from '../src/services/saParser.js';
import { recordIkeSession } from '../src/services/ikeUsage.js';
import { sanitizeUser } from '../src/utils/format.js';
import { renderUserPortal } from '../src/services/userPortal.js';

test('Iran relay accepts only a DNS identity, non-privileged port and an explicit existing outbound tag', () => {
  const policy = relayPolicy({ enabled: true, hostname: 'ir.example.com', port: 14450, outboundTag: 'tunnel-1' });
  const template = relayTemplate(policy, 'vpn.example.com');
  assert.equal(template.inbounds[0].settings.rewriteAddress, 'vpn.example.com');
  assert.equal(template.inbounds[0].settings.rewritePort, 4500);
  assert.equal(template.routing.rules[0].outboundTag, 'tunnel-1');
  for (const patch of [{ hostname: 'https://ir.example.com' }, { hostname: 'bad\nconn injected' },
    { port: 4500.1 }, { port: 500 }, { outboundTag: 'direct;id' }, { enabled: true }]) {
    assert.throws(() => relayPolicy(patch));
  }
});

test('template merge retains the control API and all existing clients, is idempotent and rejects conflicts', () => {
  const input = { inbounds: [{ tag: 'api', port: 62789 }, { tag: 'customer', port: 443, settings: { clients: [{ id: 'keep' }] } }],
    outbounds: [{ tag: 'tunnel-1' }], routing: { rules: [{ inboundTag: ['api'], outboundTag: 'api' }, { ip: ['geoip:private'], outboundTag: 'block' }] } };
  const fragment = relayTemplate({ hostname: 'ir.example.com', outboundTag: 'tunnel-1' }, 'vpn.example.com');
  const result = mergeRelayTemplate(input, fragment);
  assert.deepEqual(result.inbounds.slice(0, 2), input.inbounds);
  assert.deepEqual(result.routing.rules[0], input.routing.rules[0]);
  assert.equal(result.routing.rules[1].outboundTag, 'tunnel-1');
  assert.deepEqual(mergeRelayTemplate(result, fragment), result);
  assert.equal(input.inbounds.length, 2);
  assert.throws(() => mergeRelayTemplate({ ...input, outbounds: [] }, fragment), /OUTBOUND_NOT_FOUND/);
  assert.throws(() => mergeRelayTemplate({ ...input, inbounds: [...input.inbounds, { port: 14450 }] }, fragment), /PORT_IN_USE/);
});

test('relay identity, not a shared proxy IP, determines the usage category', () => {
  for (const connection of ['zvpn-ike-relay', 'ikev2-ir-test']) {
    const session = parseSas(`list-sa event {${connection} {uniqueid=44 remote-eap-id=alice remote-id=10.0.0.2 remote-host=203.0.113.9 established=2 child-sas {child {bytes-in=100 bytes-out=50}}}}`)[0];
    assert.equal(session.transport, 'ike-relay'); assert.equal(session.remoteId, 'alice');
  }
  assert.equal(parseSas('list-sa event {ikev2-vpn {uniqueid=45 remote-id=alice remote-host=203.0.113.9}}')[0].transport, undefined);
  const u = sanitizeUser({ usage_total: 1000, xray_usage_bytes: 300, ike_relay_usage_bytes: 200 });
  assert.equal(u.ikeUsageBytes, 500); assert.equal(u.ikeRelayUsageBytes, 200);
});

test('portal exposes the Android relay only when both enabled and provisioned', async () => {
  const user = { username: 'alice', enabled: true }, links = { landing: 'https://vpn.example.com/d/secret', android: '/android', ios: '/ios' };
  const opts = { vpn: { serverAddress: 'vpn.example.com' }, baseUrl: 'https://vpn.example.com', panelName: 'Example' };
  for (const state of [{ enabled: false, ready: true }, { enabled: true, ready: false }]) {
    const page = await renderUserPortal(user, links, { ikeRelay: state }, opts);
    assert.ok(!page.includes('/iran.sswan'));
  }
  const page = await renderUserPortal(user, links, { ikeRelay: { enabled: true, ready: true } }, opts);
  assert.ok(page.includes('/d/secret/iran.sswan'));
  assert.ok(page.includes('strongSwan'));
});

test('PostgreSQL: relay and direct IKE share exactly one balance; re-poll and upgrade never double-charge',
  { skip: !process.env.TEST_DATABASE_URL }, async () => {
    const db = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL }); await db.connect();
    const schema = 'ike_relay_' + randomUUID().replaceAll('-', '');
    try {
      await db.query(`CREATE SCHEMA ${schema}`); await db.query(`SET search_path TO ${schema},public`);
      await db.query(await fs.readFile(new URL('../../ops/schema.sql', import.meta.url), 'utf8'));
      const folder = new URL('../../ops/migrations/', import.meta.url);
      for (const name of (await fs.readdir(folder)).filter(v => v.endsWith('.sql')).sort()) await db.query(await fs.readFile(new URL(name, folder), 'utf8'));
      const user = (await db.query("INSERT INTO vpn_users(username,secret_enc,download_token) VALUES('alice','fixture','ike-relay-fixture-token') RETURNING *")).rows[0];
      const record = async (ikeId, bytesTotal, transport) => {
        await db.query('BEGIN');
        try {
          await recordIkeSession(db, user, { ikeId, remoteId: 'alice', remoteHost: '203.0.113.9', virtualIp: '10.20.0.2', bytesTotal, bytesIn: bytesTotal, bytesOut: 0, established: 1, transport }, '2026-10-23', '2026-10-23T00:00:00Z', 3000);
          await db.query('COMMIT');
        } catch (e) { await db.query('ROLLBACK'); throw e; }
      };
      await record('1', 100, undefined); await record('2', 200, 'ike-relay'); await record('2', 200, 'ike-relay'); await record('2', 250, 'ike-relay');
      await db.query(await fs.readFile(new URL('013_ike_relay.sql', folder), 'utf8'));
      const row = (await db.query('SELECT usage_total,ike_relay_usage_bytes FROM vpn_users WHERE id=$1', [user.id])).rows[0];
      assert.equal(row.usage_total, '350'); assert.equal(row.ike_relay_usage_bytes, '250');
      const day = (await db.query('SELECT bytes,ike_relay_bytes FROM usage_daily WHERE user_id=$1', [user.id])).rows[0];
      assert.deepEqual(day, { bytes: '350', ike_relay_bytes: '250' });
    } finally { await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await db.end(); }
  });
