import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

if (!process.env.DATABASE_URL) {
  console.error('[DB] DATABASE_URL is not set. Check .env or Railway Variables.');
  process.exit(1);
}

const dbHost = process.env.DATABASE_URL.match(/@([^:/]+)/)?.[1] ?? 'unknown';
console.log(`[DB] Connecting to host: ${dbHost}`);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export default pool;
