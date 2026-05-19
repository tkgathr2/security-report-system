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

export interface RateLimitOptions {
  maxAttempts?: number;
  lockDurationMs?: number;
}

export async function checkRateLimitDb(
  key: string,
  options?: RateLimitOptions
): Promise<{ allowed: boolean; remainingMs?: number }> {
  await ensureTable();
  const maxAttempts = options?.maxAttempts ?? MAX_ATTEMPTS;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      'SELECT count, locked_until FROM rate_limits WHERE key = $1 FOR UPDATE',
      [key]
    );
    const now = Date.now();

    if (result.rows.length === 0) {
      await client.query('COMMIT');
      return { allowed: true };
    }

    const row = result.rows[0];
    const lockedUntil = Number(row.locked_until);

    if (lockedUntil > now) {
      await client.query('COMMIT');
      return { allowed: false, remainingMs: lockedUntil - now };
    }

    if (lockedUntil <= now && row.count >= maxAttempts) {
      await client.query('DELETE FROM rate_limits WHERE key = $1', [key]);
    }

    await client.query('COMMIT');
    return { allowed: true };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function recordFailedAttemptDb(
  key: string,
  options?: RateLimitOptions
): Promise<void> {
  await ensureTable();
  const maxAttempts = options?.maxAttempts ?? MAX_ATTEMPTS;
  const lockDurationMs = options?.lockDurationMs ?? LOCK_DURATION_MS;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Lock the row (or take an advisory action via INSERT ... ON CONFLICT DO UPDATE under transaction)
    const result = await client.query(
      `INSERT INTO rate_limits (key, count, locked_until, updated_at)
       VALUES ($1, 1, 0, NOW())
       ON CONFLICT (key) DO UPDATE
         SET count = rate_limits.count + 1,
             updated_at = NOW()
       RETURNING count`,
      [key]
    );
    const newCount = result.rows[0].count;
    if (newCount >= maxAttempts) {
      await client.query(
        'UPDATE rate_limits SET locked_until = $1 WHERE key = $2',
        [Date.now() + lockDurationMs, key]
      );
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Atomic check-and-record: in a single transaction, verify the key is not locked,
 * and if not, increment the counter. Eliminates the TOCTOU race between
 * checkRateLimitDb and recordFailedAttemptDb when used for pre-flight checks
 * that should also count as attempts (e.g. IP-based throttling of an endpoint
 * regardless of success).
 */
export async function checkAndIncrementRateLimitDb(
  key: string,
  options?: RateLimitOptions
): Promise<{ allowed: boolean; remainingMs?: number }> {
  await ensureTable();
  const maxAttempts = options?.maxAttempts ?? MAX_ATTEMPTS;
  const lockDurationMs = options?.lockDurationMs ?? LOCK_DURATION_MS;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query(
      'SELECT count, locked_until FROM rate_limits WHERE key = $1 FOR UPDATE',
      [key]
    );
    const now = Date.now();

    if (existing.rows.length > 0) {
      const row = existing.rows[0];
      const lockedUntil = Number(row.locked_until);
      if (lockedUntil > now) {
        await client.query('COMMIT');
        return { allowed: false, remainingMs: lockedUntil - now };
      }
      if (lockedUntil > 0 && lockedUntil <= now) {
        // lock expired — reset
        await client.query('DELETE FROM rate_limits WHERE key = $1', [key]);
      }
    }

    const upserted = await client.query(
      `INSERT INTO rate_limits (key, count, locked_until, updated_at)
       VALUES ($1, 1, 0, NOW())
       ON CONFLICT (key) DO UPDATE
         SET count = rate_limits.count + 1,
             updated_at = NOW()
       RETURNING count`,
      [key]
    );
    const newCount = upserted.rows[0].count;
    if (newCount >= maxAttempts) {
      await client.query(
        'UPDATE rate_limits SET locked_until = $1 WHERE key = $2',
        [Date.now() + lockDurationMs, key]
      );
    }

    await client.query('COMMIT');
    return { allowed: true };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
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
