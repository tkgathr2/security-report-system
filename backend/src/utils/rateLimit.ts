import pool from '../db/pool';

const MAX_ATTEMPTS = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000;

let tableReady = false;

async function ensureTable(): Promise<void> {
  if (tableReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS rate_limits (
      key TEXT PRIMARY KEY,
      count INTEGER NOT NULL DEFAULT 0,
      locked_until BIGINT NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  tableReady = true;
}

export async function checkRateLimitDb(key: string): Promise<{ allowed: boolean; remainingMs?: number }> {
  await ensureTable();
  const result = await pool.query('SELECT count, locked_until FROM rate_limits WHERE key = $1', [key]);
  if (result.rows.length === 0) return { allowed: true };

  const row = result.rows[0];
  const lockedUntil = Number(row.locked_until);
  const now = Date.now();

  if (lockedUntil > now) {
    return { allowed: false, remainingMs: lockedUntil - now };
  }

  if (lockedUntil <= now && row.count >= MAX_ATTEMPTS) {
    await pool.query('DELETE FROM rate_limits WHERE key = $1', [key]);
  }

  return { allowed: true };
}

export async function recordFailedAttemptDb(key: string): Promise<void> {
  await ensureTable();
  const result = await pool.query(
    `INSERT INTO rate_limits (key, count, locked_until, updated_at)
     VALUES ($1, 1, 0, NOW())
     ON CONFLICT (key) DO UPDATE
       SET count = rate_limits.count + 1,
           updated_at = NOW()
     RETURNING count`,
    [key]
  );
  const newCount = result.rows[0].count;
  if (newCount >= MAX_ATTEMPTS) {
    await pool.query(
      'UPDATE rate_limits SET locked_until = $1 WHERE key = $2',
      [Date.now() + LOCK_DURATION_MS, key]
    );
  }
}

export async function resetAttemptsDb(key: string): Promise<void> {
  await ensureTable();
  await pool.query('DELETE FROM rate_limits WHERE key = $1', [key]);
}

export async function cleanupExpiredRateLimits(): Promise<number> {
  await ensureTable();
  const result = await pool.query(
    'DELETE FROM rate_limits WHERE locked_until > 0 AND locked_until < $1',
    [Date.now()]
  );
  return result.rowCount ?? 0;
}
