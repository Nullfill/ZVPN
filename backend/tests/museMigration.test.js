import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import pg from 'pg';
test('Muse migration preserves opt-in, custom domains, scope, exclusions and repeatability',
  {skip:!process.env.TEST_DATABASE_URL},async()=>{
    const c=new pg.Client({connectionString:process.env.TEST_DATABASE_URL});await c.connect();
    try{
      await c.query('BEGIN');
      await c.query('CREATE TEMP TABLE panel_settings(id int,key text,value jsonb,updated_at timestamptz) ON COMMIT DROP');
      const base={provider:'firefox',enabled:true,scope:'selected',userIds:['preserve'],domains:['muse.ai','example.com'],excludedDomains:[]};
      const cases=[base,{...base,domains:['gemini.google.com']},{...base,excludedDomains:['meta.com','facebook.com']},
        {...base,domains:[...base.domains,'auth.meta.com','www.facebook.com','static.xx.fbcdn.net']}];
      for(const [id,v] of cases.entries())await c.query('INSERT INTO panel_settings(id,key,value) VALUES($1,$2,$3)',[id,'warp',v]);
      const sql=await fs.readFile(new URL('../../ops/migrations/017_muse_auth_domains.sql',import.meta.url),'utf8');await c.query(sql);
      const rows=(await c.query('SELECT value FROM panel_settings ORDER BY id')).rows.map(r=>r.value);
      assert.deepEqual(rows[0],{...base,domains:[...base.domains,'auth.meta.com','www.facebook.com','static.xx.fbcdn.net']});
      assert.deepEqual(rows[1],cases[1]);
      assert.deepEqual(rows[2],{...cases[2],domains:[...base.domains,'static.xx.fbcdn.net']});
      assert.deepEqual(rows[3],cases[3]);
      await c.query(sql);assert.deepEqual((await c.query('SELECT value FROM panel_settings ORDER BY id')).rows.map(r=>r.value),rows);
    }finally{await c.query('ROLLBACK').catch(()=>{});await c.end();}
  });
