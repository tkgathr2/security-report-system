import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

let _pool: Pool | null = null;

export function createPool(connectionString?: string): Pool {
  const connStr = connectionString || process.env.DATABASE_URL;
  if (!connStr) {
    throw new Error('[DB] DATABASE_URL is not set. Check .env or Railway Variables.');
  }
  const dbHost = connStr.match(/@([^:/]+)/)?.[1] ?? 'unknown';
  console.log(`[DB] Connecting to host: ${dbHost}`);
  return new Pool({ connectionString: connStr });
}

function getPool(): Pool {
  if (!_pool) {
    _pool = createPool();
  }
  return _pool;
}

const pool = getPool();
export default pool;
