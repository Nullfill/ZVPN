import 'dotenv/config';
import bcrypt from 'bcryptjs';
import pg from 'pg';

const [username, password] = process.argv.slice(2);
if (!username || !password) {
  console.error('Usage: node scripts/create-admin.js <username> <password>');
  process.exit(1);
}
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const hash = await bcrypt.hash(password, 12);
await pool.query(`INSERT INTO admins(username,password_hash) VALUES($1,$2)
  ON CONFLICT (username) DO UPDATE SET password_hash=EXCLUDED.password_hash`, [username, hash]);
console.log('Admin account ready:', username);
await pool.end();
