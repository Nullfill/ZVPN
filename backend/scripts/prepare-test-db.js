import pg from 'pg';

// Initialize shared extensions before parallel test processes create/drop
// their private schemas. Never connect to the application's DATABASE_URL.
if (process.env.TEST_DATABASE_URL) {
  const client = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
  await client.connect();
  try { await client.query('CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public'); }
  finally { await client.end(); }
}
