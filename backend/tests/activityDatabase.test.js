import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import pg from 'pg';
import {randomUUID} from 'node:crypto';
import {recordDailyActivity,dailyActivitySummary} from '../src/services/dailyActivity.js';

test('PostgreSQL: unique activity across protocols/days/deletion and accurate exhaustion transitions',
 {skip:!process.env.TEST_DATABASE_URL}, async()=>{
 const client=new pg.Client({connectionString:process.env.TEST_DATABASE_URL});await client.connect();
 const schema='zvpn_activity_test_'+randomUUID().replaceAll('-','');
 try {
  await client.query(`CREATE SCHEMA ${schema}`);await client.query(`SET search_path TO ${schema},public`);
  await client.query(await fs.readFile(new URL('../../ops/schema.sql',import.meta.url),'utf8'));
  const migrations=(await fs.readdir(new URL('../../ops/migrations/',import.meta.url))).filter(n=>n.endsWith('.sql')).sort();
  for(const name of migrations.filter(n=>!n.startsWith('009')))await client.query(await fs.readFile(new URL('../../ops/migrations/'+name,import.meta.url),'utf8'));
  const {rows:[legacy]}=await client.query(`INSERT INTO vpn_users(username,secret_enc,total_limit_bytes,usage_total,download_token) VALUES('legacy-exhausted','fixture',100,110,'legacy-fixture-token') RETURNING id`);
  const sql=await fs.readFile(new URL('../../ops/migrations/009_activity_and_account_lifecycle.sql',import.meta.url),'utf8');await client.query(sql);
  assert.equal((await client.query('SELECT traffic_exhausted_at FROM vpn_users WHERE id=$1',[legacy.id])).rows[0].traffic_exhausted_at,null);
  await client.query('UPDATE vpn_users SET usage_total=120 WHERE id=$1',[legacy.id]);
  assert.equal((await client.query('SELECT traffic_exhausted_at FROM vpn_users WHERE id=$1',[legacy.id])).rows[0].traffic_exhausted_at,null);
  const {rows:[user]}=await client.query(`INSERT INTO vpn_users(username,secret_enc,total_limit_bytes,download_token) VALUES('new-usage','fixture',100,'new-fixture-token') RETURNING id`);
  await client.query('UPDATE vpn_users SET usage_total=100 WHERE id=$1',[user.id]);
  const first=(await client.query('SELECT traffic_exhausted_at FROM vpn_users WHERE id=$1',[user.id])).rows[0].traffic_exhausted_at;
  assert.ok(first);await client.query('UPDATE vpn_users SET usage_total=101 WHERE id=$1',[user.id]);
  assert.equal((await client.query('SELECT traffic_exhausted_at FROM vpn_users WHERE id=$1',[user.id])).rows[0].traffic_exhausted_at.toISOString(),first.toISOString());
  await client.query('UPDATE vpn_users SET total_limit_bytes=200 WHERE id=$1',[user.id]);
  assert.equal((await client.query('SELECT traffic_exhausted_at FROM vpn_users WHERE id=$1',[user.id])).rows[0].traffic_exhausted_at,null);
  const timezone='Asia/Tehran';const today=(await dailyActivitySummary(client,timezone)).date;
  await recordDailyActivity(client,user.id,today);await recordDailyActivity(client,user.id,today);
  await recordDailyActivity(client,legacy.id,'2000-01-01');assert.equal((await dailyActivitySummary(client,timezone)).uniqueUsers,1);
  await recordDailyActivity(client,legacy.id,today);assert.equal((await dailyActivitySummary(client,timezone)).uniqueUsers,2);
  await client.query('DELETE FROM vpn_users WHERE id=$1',[user.id]);assert.equal((await dailyActivitySummary(client,timezone)).uniqueUsers,2);
  // Local midnight is evaluated in the configured zone, not the server's zone.
  await client.query("UPDATE vpn_users SET last_seen_at=now() WHERE id=$1",[legacy.id]);
  assert.equal((await dailyActivitySummary(client,timezone)).uniqueUsers,2);
 } finally {await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await client.end();}
});
