import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './db.js';

const migrationsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../ops/migrations');

export async function runMigrations() {
  await db.query(`CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  let files;
  try { files = (await fs.readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort(); } catch { return; }
  for (const file of files) {
    const version = file.replace(/\.sql$/, '');
    const applied = await db.query('SELECT 1 FROM schema_migrations WHERE version=$1', [version]);
    if (applied.rowCount) continue;
    const sql = await fs.readFile(path.join(migrationsDir, file), 'utf8');
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations(version) VALUES($1)', [version]);
      await client.query('COMMIT');
      console.log(`[migrate] applied ${version}`);
    } catch (e) {
      await client.query('ROLLBACK');
      throw new Error(`Migration ${version} failed: ${e.message}`);
    } finally {
      client.release();
    }
  }
}
