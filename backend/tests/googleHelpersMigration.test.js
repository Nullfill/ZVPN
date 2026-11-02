import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import pg from 'pg';
import { GEMINI_DOMAINS, GOOGLE_COMPANION_DOMAINS } from '../src/services/warpDefaults.js';

test('Google helper migration preserves custom settings and exclusions and is idempotent',
  { skip: !process.env.TEST_DATABASE_URL }, async () => {
    const client = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
    await client.connect();
    try {
      await client.query('BEGIN');
      // This session-local table shadows the real table; no live settings are touched.
      await client.query('CREATE TEMP TABLE panel_settings(id int, key text, value jsonb, updated_at timestamptz) ON COMMIT DROP');
      const oldDomains = GEMINI_DOMAINS.filter(d => !GOOGLE_COMPANION_DOMAINS.includes(d));
      const base = { enabled: true, provider: 'psiphon', scope: 'selected', userIds: ['keep'],
        domains: oldDomains, excludedDomains: [] };
      const cases = [base, { ...base, domains: [...oldDomains, 'example.com'] },
        { ...base, excludedDomains: ['clients6.google.com'] },
        { ...base, excludedDomains: ['google.com'] }, { ...base, domains: GEMINI_DOMAINS }];
      for (const [id, value] of cases.entries()) {
        await client.query('INSERT INTO panel_settings(id,key,value) VALUES($1,$2,$3)', [id, 'warp', value]);
      }
      const sql = await fs.readFile(new URL('../../ops/migrations/016_google_companion_domains.sql', import.meta.url), 'utf8');
      await client.query(sql);
      const rows = (await client.query('SELECT value FROM panel_settings ORDER BY id')).rows.map(r => r.value);
      assert.deepEqual(rows[0], { ...base, domains: [...oldDomains, ...GOOGLE_COMPANION_DOMAINS] });
      assert.deepEqual(rows[1], cases[1]);
      assert.deepEqual(rows[2], { ...cases[2], domains: [...oldDomains, ...GOOGLE_COMPANION_DOMAINS.filter(d => d !== 'clients6.google.com')] });
      assert.deepEqual(rows[3], cases[3]);
      assert.deepEqual(rows[4], cases[4]);
      await client.query(sql);
      assert.deepEqual((await client.query('SELECT value FROM panel_settings ORDER BY id')).rows.map(r => r.value), rows);
    } finally {
      await client.query('ROLLBACK').catch(() => {});
      await client.end();
    }
  });
