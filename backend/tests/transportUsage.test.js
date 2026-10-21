import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { recordXrayCounters } from '../src/services/sharedUsage.js';
import { buildXrayConfig, parseXrayStats } from '../src/services/xrayConfig.js';

test('relay inlet retains account identity but has an independent statistics identity', () => {
  const user = { id: randomUUID(), xray_uuid: randomUUID(), enabled: true };
  const cfg = buildXrayConfig([user]);
  assert.equal(cfg.inbounds[1].settings.clients[0].id, cfg.inbounds[2].settings.clients[0].id);
  assert.notEqual(cfg.inbounds[1].settings.clients[0].email, cfg.inbounds[2].settings.clients[0].email);
  assert.equal(cfg.inbounds[2].listen, '127.0.0.1');
  const counters = parseXrayStats({ stat: [
    { name: `user>>>zvpn-${user.id}>>>traffic>>>downlink`, value: '100' },
    { name: `user>>>zvpn-netlify-${user.id}>>>traffic>>>downlink`, value: '200' },
  ] });
  assert.equal(counters.size, 2);
  assert.equal(counters.get(user.id).downlink, 100n);
  assert.equal(counters.get(user.id + ':netlify').downlink, 200n);
  assert.equal(counters.get(user.id + ':netlify').userId, user.id);
});

test('PostgreSQL: transport counters share quota, retain legacy usage and remain idempotent after restart',
  { skip: !process.env.TEST_DATABASE_URL }, async () => {
    const db = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
    await db.connect();
    const schema = 'transport_' + randomUUID().replaceAll('-', '');
    try {
      await db.query(`CREATE SCHEMA ${schema}`); await db.query(`SET search_path TO ${schema}, public`);
      await db.query(await fs.readFile(new URL('../../ops/schema.sql', import.meta.url), 'utf8'));
      const folder = new URL('../../ops/migrations/', import.meta.url);
      for (const name of (await fs.readdir(folder)).filter(n => n.endsWith('.sql') && !n.startsWith('012')).sort())
        await db.query(await fs.readFile(new URL(name, folder), 'utf8'));
      const user = (await db.query("INSERT INTO vpn_users(username,secret_enc,usage_total,xray_usage_bytes,download_token) VALUES('old-user','fixture',1500,1000,'transport-fixture-token') RETURNING *")).rows[0];
      const migration = await fs.readFile(new URL('012_transport_usage.sql', folder), 'utf8');
      await db.query(migration);
      const record = async (transport, down, epoch = 'boot-a') => {
        await db.query('BEGIN');
        try { await recordXrayCounters(db, user.id, { uplink: 0n, downlink: BigInt(down), ...(transport ? { transport } : {}) }, epoch, '2026-10-21', '2026-10-21T00:00:00Z'); await db.query('COMMIT'); }
        catch (error) { await db.query('ROLLBACK'); throw error; }
      };
      await record(null, 100); await record('netlify', 200);
      await record(null, 100); await record('netlify', 200);
      await record('netlify', 10, 'boot-b');
      await db.query(migration);
      const row = (await db.query('SELECT * FROM vpn_users WHERE id=$1', [user.id])).rows[0];
      assert.equal(row.usage_total, '1810'); assert.equal(row.xray_usage_bytes, '1310');
      assert.equal(row.netlify_usage_bytes, '210'); assert.equal(row.xray_legacy_usage_bytes, '1000');
      assert.equal(Number(row.usage_total) - Number(row.xray_usage_bytes), 500);
      assert.equal((await db.query('SELECT bytes FROM usage_daily WHERE user_id=$1', [user.id])).rows[0].bytes, '310');
      assert.equal((await db.query('SELECT count(*) FROM user_activity_daily WHERE user_id=$1', [user.id])).rows[0].count, '1');
    } finally { await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await db.end(); }
  });
