import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { connectionLinks, netlifyLink, RELAY_EXTRA } from '../src/services/netlifyConfig.js';
import { makeRelayLink } from '../../deploy/netlify/make-link.mjs';
import { xrayLink, buildXrayConfig } from '../src/services/xrayConfig.js';

process.env.DATABASE_URL ||= 'postgres://localhost/zvpn_test';
process.env.JWT_SECRET ||= 'test-jwt-secret-test-jwt-secret-test-jwt-secret';
process.env.MASTER_KEY ||= 'test-master-key-test-master-key-test-master-key';
const { validateSettingsPatch } = await import('../src/services/settings.js');
const user = { id: randomUUID(), xray_uuid: randomUUID(), username: 'existing', enabled: true };
const origin = 'https://vpn.example.com';
const policy = { enabled: true, hostname: 'relay.example.com' };

test('relay and direct share the original account, expiry enforcement and quota identity', () => {
  const direct = xrayLink(user, origin);
  const relay = new URL(netlifyLink(user, origin, policy));
  assert.equal(relay.username, user.xray_uuid);
  assert.equal(relay.hostname, policy.hostname);
  const reference = new URL(makeRelayLink(direct, policy.hostname, { allowCustomDomain: true }));
  assert.equal(relay.search, reference.search);
  assert.deepEqual(JSON.parse(relay.searchParams.get('extra')), RELAY_EXTRA);
  assert.equal(relay.searchParams.get('security'), 'tls');
  assert.equal(buildXrayConfig([{ ...user, enabled: false }]).inbounds[1].settings.clients.length, 0);
  assert.equal(buildXrayConfig([{ ...user, expires_at: '2000-01-01' }]).inbounds[1].settings.clients.length, 0);
});

test('subscriptions include both connections only when enabled', () => {
  assert.equal(connectionLinks(user, origin, { netlify: policy }).length, 2);
  assert.equal(connectionLinks(user, origin, { netlify: { ...policy, enabled: false } }).length, 1);
  assert.deepEqual(connectionLinks(user, origin, { xray: { enabled: false }, netlify: policy }), []);
  assert.equal(netlifyLink(user, origin, { enabled: false }), null);
});

test('relay settings reject origin loops, malformed hosts, URLs, missing and cleared hosts', () => {
  for (const hostname of ['https://relay.example.com', '127.0.0.1', 'relay.example.com/path', 'relay.example.com:443', '']) {
    assert.equal(validateSettingsPatch('netlify', { enabled: true, hostname }).success, false);
    assert.throws(() => netlifyLink(user, origin, { enabled: true, hostname }));
  }
  assert.throws(() => netlifyLink(user, origin, { enabled: true, hostname: 'vpn.example.com' }));
  assert.equal(validateSettingsPatch('netlify', { enabled: true }).success, false);
  assert.equal(validateSettingsPatch('netlify', { hostname: '' }).success, false);
  assert.equal(validateSettingsPatch('netlify', { enabled: false }).success, true);
  assert.equal(validateSettingsPatch('netlify', policy).success, true);
});

test('PostgreSQL: fresh install creates defaults; repeated upgrade preserves the configured relay',
  { skip: !process.env.TEST_DATABASE_URL }, async () => {
    const client = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
    await client.connect();
    const schema = 'netlify_test_' + randomUUID().replaceAll('-', '');
    try {
      await client.query(`CREATE SCHEMA ${schema}`);
      await client.query(`SET search_path TO ${schema}`);
      await client.query('CREATE TABLE panel_settings(key text PRIMARY KEY,value jsonb)');
      const sql = await fs.readFile(new URL('../../ops/migrations/011_netlify_relay.sql', import.meta.url), 'utf8');
      await client.query(sql);
      assert.deepEqual((await client.query("SELECT value FROM panel_settings WHERE key='netlify'")).rows[0].value, { enabled: false, hostname: '' });
      await client.query("UPDATE panel_settings SET value=$1 WHERE key='netlify'", [JSON.stringify(policy)]);
      await client.query(sql); await client.query(sql);
      assert.deepEqual((await client.query("SELECT value FROM panel_settings WHERE key='netlify'")).rows[0].value, policy);
    } finally { await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await client.end(); }
  });
