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

  const maxConnections = parseInt(process.env.DB_POOL_MAX || '10', 10);
  const idleTimeoutMs = parseInt(process.env.DB_POOL_IDLE_TIMEOUT || '30000', 10);
  const connectionTimeoutMs = parseInt(process.env.DB_POOL_CONNECTION_TIMEOUT || '5000', 10);

  const p = new Pool({
    connectionString: connStr,
    max: maxConnections,
    idleTimeoutMillis: idleTimeoutMs,
    connectionTimeoutMillis: connectionTimeoutMs,
  });

  p.on('error', (err) => {
    console.error('[DB] Unexpected pool error:', err.message);
  });

  return p;
}

function getPool(): Pool {
  if (!_pool) {
    _pool = createPool();
  }
  return _pool;
}

const pool = getPool();
export default pool;
