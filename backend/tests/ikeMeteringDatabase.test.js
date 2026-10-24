import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { recordIkeSession } from '../src/services/ikeUsage.js';
import { resetUsage } from '../src/services/usageReset.js';

test('PostgreSQL: IKE directions, restart baseline, rekey and replay preserve one balance',
  { skip: !process.env.TEST_DATABASE_URL }, async () => {
    const db = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
    await db.connect();
    const schema = 'ike_meter_' + randomUUID().replaceAll('-', '');
    try {
      await db.query(`CREATE SCHEMA ${schema}`);
      await db.query(`SET search_path TO ${schema},public`);
      await db.query(await fs.readFile(new URL('../../ops/schema.sql', import.meta.url), 'utf8'));
      const folder = new URL('../../ops/migrations/', import.meta.url);
      for (const f of (await fs.readdir(folder)).filter(f => f.endsWith('.sql')).sort())
        await db.query(await fs.readFile(new URL(f, folder), 'utf8'));
      const user = (await db.query("INSERT INTO vpn_users(username,secret_enc,download_token) VALUES('meter-user','fixture','meter-token') RETURNING *")).rows[0];
      const record = async (children, established = 300, identity = 'a:b') => {
        const bytesIn = children.reduce((s, c) => s + c.bytesIn, 0);
        const bytesOut = children.reduce((s, c) => s + c.bytesOut, 0);
        await db.query('BEGIN');
        try {
          await recordIkeSession(db, user, { ikeId: '1', remoteHost: '203.0.113.1', virtualIp: '10.20.0.2',
            children, identity, bytesIn, bytesOut, bytesTotal: bytesIn + bytesOut, established }, '2026-10-24', '2026-10-24T00:00:00Z', 15000);
          await db.query('COMMIT');
        } catch (e) { await db.query('ROLLBACK'); throw e; }
      };
      await record([{ key: 'old', bytesIn: 1000, bytesOut: 2000 }]); // Existing SA: baseline, not a fresh charge.
      assert.equal((await db.query('SELECT usage_total FROM vpn_users WHERE id=$1', [user.id])).rows[0].usage_total, '0');
      const a = { key: 'old', bytesIn: 1100, bytesOut: 2300 };
      const b = { key: 'new', bytesIn: 10, bytesOut: 20 };
      await record([a]); await record([a]); await record([a, b]); await record([b]); await record([a, b]);
      let row = (await db.query('SELECT usage_total,upload_bytes,download_bytes FROM vpn_users WHERE id=$1', [user.id])).rows[0];
      assert.deepEqual(row, { usage_total: '430', upload_bytes: '110', download_bytes: '320' });
      await record([{ key: 'restart', bytesIn: 5, bytesOut: 15 }], 1, 'c:d');
      row = (await db.query('SELECT usage_total,upload_bytes,download_bytes FROM vpn_users WHERE id=$1', [user.id])).rows[0];
      assert.deepEqual(row, { usage_total: '450', upload_bytes: '115', download_bytes: '335' });
      assert.equal((await db.query('SELECT bytes FROM usage_daily WHERE user_id=$1', [user.id])).rows[0].bytes, '450');
      assert.equal((await db.query('SELECT bytes FROM usage_hourly WHERE user_id=$1', [user.id])).rows[0].bytes, '450');
      await db.query('BEGIN'); await resetUsage(db, user.id); await db.query('ROLLBACK');
      assert.equal((await db.query('SELECT usage_total FROM vpn_users WHERE id=$1', [user.id])).rows[0].usage_total, '450');
      await db.query('BEGIN'); await resetUsage(db, user.id); await db.query('COMMIT');
      await record([{ key: 'restart', bytesIn: 5, bytesOut: 15 }], 1, 'c:d');
      assert.equal((await db.query('SELECT usage_total FROM vpn_users WHERE id=$1', [user.id])).rows[0].usage_total, '0');
      assert.equal((await db.query('SELECT count(*) FROM usage_daily WHERE user_id=$1', [user.id])).rows[0].count, '0');
      assert.equal((await db.query('SELECT count(*) FROM usage_hourly WHERE user_id=$1', [user.id])).rows[0].count, '0');
      await record([{ key: 'restart', bytesIn: 15, bytesOut: 35 }], 2, 'c:d');
      assert.equal((await db.query('SELECT usage_total FROM vpn_users WHERE id=$1', [user.id])).rows[0].usage_total, '30');
    } finally { await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await db.end(); }
  });
