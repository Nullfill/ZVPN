import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { GEMINI_DOMAINS } from '../src/services/warpDefaults.js';

test('PostgreSQL: upgrade the original Gemini preset without changing custom lists or switch state',
  { skip: !process.env.TEST_DATABASE_URL }, async () => {
    const client = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
    await client.connect();
    const schema = 'zvpn_warp_routes_test_' + randomUUID().replaceAll('-', '');
    try {
      await client.query(`CREATE SCHEMA ${schema}`);
      await client.query(`SET search_path TO ${schema}`);
      await client.query('CREATE TABLE panel_settings(key text PRIMARY KEY,value jsonb,updated_at timestamptz DEFAULT now())');
      const sql = await fs.readFile(new URL('../../ops/migrations/010_warp_google_challenge.sql', import.meta.url), 'utf8');
      const legacy = GEMINI_DOMAINS.filter(d => !['www.google.com', 'recaptcha.net'].includes(d));
      for (const [domains, excludedDomains, expected] of [
        [legacy, [], GEMINI_DOMAINS],
        [['gemini.google.com'], [], ['gemini.google.com']],
        [legacy, ['www.google.com'], legacy],
        [GEMINI_DOMAINS, [], GEMINI_DOMAINS],
      ]) {
        const settings = { enabled: false, scope: 'selected', userIds: [randomUUID()], domains, excludedDomains };
        await client.query(`INSERT INTO panel_settings(key,value) VALUES('warp',$1)
          ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`, [JSON.stringify(settings)]);
        await client.query(sql); await client.query(sql);
        const result = (await client.query("SELECT value FROM panel_settings WHERE key='warp'")).rows[0].value;
        assert.deepEqual(result, { ...settings, domains: expected });
      }
    } finally {
      await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await client.end();
    }
  });
