import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { recordXrayCounters } from '../src/services/sharedUsage.js';

test('PostgreSQL: upgrade existing users, shared quota, idempotent collection and core restart',
  {skip: !process.env.TEST_DATABASE_URL}, async () => {
    const client = new pg.Client({connectionString:process.env.TEST_DATABASE_URL});await client.connect();
    const schema=`zvpn_xray_test_${randomUUID().replaceAll('-','')}`;
    try {
      await client.query(`CREATE SCHEMA ${schema}`);await client.query(`SET search_path TO ${schema}, public`);
      await client.query(await fs.readFile(new URL('../../ops/schema.sql',import.meta.url),'utf8'));
      const migrations=await fs.readdir(new URL('../../ops/migrations/',import.meta.url));
      for (const name of migrations.filter(n=>n.endsWith('.sql')&&!n.startsWith('008')&&!n.startsWith('012')).sort()) {
        await client.query(await fs.readFile(new URL(`../../ops/migrations/${name}`,import.meta.url),'utf8'));
      }
      const {rows:[old]}=await client.query(`INSERT INTO vpn_users(username,secret_enc,duration_days,activation_status,
        usage_total,upload_bytes,download_bytes,total_limit_bytes,download_token) VALUES('existing-user','test-encrypted',30,'not_activated',300,100,200,500,'test-token') RETURNING *`);
      await client.query(await fs.readFile(new URL('../../ops/migrations/008_xray_shared_usage.sql',import.meta.url),'utf8'));
      await client.query(await fs.readFile(new URL('../../ops/migrations/012_transport_usage.sql',import.meta.url),'utf8'));
      const upgraded=(await client.query('SELECT * FROM vpn_users WHERE id=$1',[old.id])).rows[0];
      assert.match(upgraded.xray_uuid,/^[0-9a-f-]{36}$/);assert.equal(upgraded.usage_total,'300');assert.equal(upgraded.duration_days,30);
      const record=async(up,down,epoch='boot-a')=>{
        await client.query('BEGIN');
        try {await recordXrayCounters(client,old.id,{uplink:BigInt(up),downlink:BigInt(down)},epoch,'2026-10-11','2026-10-11T00:00:00Z');await client.query('COMMIT');}
        catch(e){await client.query('ROLLBACK');throw e;}
        return (await client.query('SELECT * FROM vpn_users WHERE id=$1',[old.id])).rows[0];
      };
      let row=await record(50,100);assert.equal(row.usage_total,'450');assert.equal(row.xray_usage_bytes,'150');
      const expiry=row.expires_at.toISOString();assert.ok(row.first_connected_at);
      row=await record(50,100);assert.equal(row.usage_total,'450');assert.equal(row.expires_at.toISOString(),expiry);
      row=await record(60,130);assert.equal(row.usage_total,'490');
      row=await record(5,5,'boot-b');assert.equal(row.usage_total,'500');assert.equal(row.total_limit_bytes,'500');
      assert.equal(row.xray_uuid,upgraded.xray_uuid);assert.equal(row.expires_at.toISOString(),expiry);
      assert.equal((await client.query('SELECT bytes FROM usage_daily WHERE user_id=$1',[old.id])).rows[0].bytes,'200');
      await assert.rejects(record(1,1,'boot-b'),/REGRESSED/);
      assert.equal((await client.query('SELECT usage_total FROM vpn_users WHERE id=$1',[old.id])).rows[0].usage_total,'500');
      await client.query(await fs.readFile(new URL('../../ops/migrations/008_xray_shared_usage.sql',import.meta.url),'utf8'));
      assert.equal((await client.query('SELECT xray_uuid FROM vpn_users WHERE id=$1',[old.id])).rows[0].xray_uuid,upgraded.xray_uuid);
    } finally {await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await client.end();}
  });
