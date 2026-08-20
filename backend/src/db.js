import pg from 'pg';
import { config } from './config.js';

const { Pool } = pg;
export const db = new Pool({
  connectionString: config.dbUrl,
  max: config.dbPoolMax,
  idleTimeoutMillis: config.dbIdleTimeoutMs,
  connectionTimeoutMillis: config.dbConnectTimeoutMs,
  statement_timeout: config.dbStatementTimeoutMs,
  application_name: `zvpn-panel-${config.version}`,
});

db.on('error', (err) => console.error('[db] idle client error', err));

export async function one(text, params = []) {
  const r = await db.query(text, params);
  return r.rows[0] || null;
}

export async function many(text, params = []) {
  const r = await db.query(text, params);
  return r.rows;
}

export async function tx(fn) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function closeDatabase() {
  await db.end();
}
