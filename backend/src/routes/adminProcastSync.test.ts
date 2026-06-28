import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

// db/pool をモックして DATABASE_URL 不要にする
vi.mock('../db/pool', () => ({
  default: { query: vi.fn(), connect: vi.fn() },
}));

vi.mock('../middleware/auth', () => ({
  requireAdmin: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as express.Request).user = {
      id: 'admin-id',
      email: 'admin@takagi.bz',
      is_active: true,
      role: 'admin',
    };
    next();
  },
}));
vi.mock('../utils/auditLog', () => ({
  logAudit: vi.fn(),
}));

import pool from '../db/pool';
import adminProcastSyncRouter, { _resetCooldownForTests } from './adminProcastSync';

const mockPool = pool as unknown as {
  query: ReturnType<typeof vi.fn>;
  connect: ReturnType<typeof vi.fn>;
};

/** クールダウン未使用（rate_limits に行なし）の connect モックを返す */
function makeFreeClient() {
  return {
    query: vi.fn().mockImplementation((sql: string) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
        return Promise.resolve();
      }
      // SELECT ... FOR UPDATE → 行なし（クールダウン未使用）
      if (/SELECT locked_until/.test(sql)) {
        return Promise.resolve({ rows: [] });
      }
      // INSERT
      return Promise.resolve({ rows: [] });
    }),
    release: vi.fn(),
  };
}

/** クールダウン中（locked_until が未来）の connect モックを返す */
function makeLockedClient(lockedUntilMs: number) {
  return {
    query: vi.fn().mockImplementation((sql: string) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
        return Promise.resolve();
      }
      if (/SELECT locked_until/.test(sql)) {
        return Promise.resolve({ rows: [{ locked_until: String(lockedUntilMs) }] });
      }
      return Promise.resolve({ rows: [] });
    }),
    release: vi.fn(),
  };
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/procast-sync', adminProcastSyncRouter);
  return app;
}

describe('POST /api/admin/procast-sync/trigger', () => {
  const origEnv = { ...process.env };
  const fetchSpy = vi.spyOn(global, 'fetch');

  beforeEach(async () => {
    // _resetCooldownForTests は pool.query を呼ぶだけ
    mockPool.query.mockResolvedValue({ rows: [] });
    await _resetCooldownForTests();
    fetchSpy.mockReset();
    process.env.PROCAST_SYNC_TRIGGER_URL = 'https://example.invalid/trigger';
    process.env.PROCAST_SYNC_TRIGGER_TOKEN = 'test-token';
  });

  afterEach(() => {
    process.env = { ...origEnv };
    vi.clearAllMocks();
  });

  it('returns 503 when token env is missing (feature disabled)', async () => {
    delete process.env.PROCAST_SYNC_TRIGGER_TOKEN;
    // 503 は DB に触れる前に弾かれるのでモック不要だが念のため設定
    mockPool.query.mockResolvedValue({ rows: [] });
    mockPool.connect.mockResolvedValue(makeFreeClient());

    const res = await request(buildApp()).post('/api/admin/procast-sync/trigger');
    expect(res.status).toBe(503);
    expect(res.body.error).toContain('未設定');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('proxies to upstream with Bearer token and returns 202 on success', async () => {
    mockPool.query.mockResolvedValue({ rows: [] }); // CREATE TABLE IF NOT EXISTS
    mockPool.connect.mockResolvedValue(makeFreeClient());

    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ message: 'started' }), { status: 200 })
    );
    const res = await request(buildApp()).post('/api/admin/procast-sync/trigger');
    expect(res.status).toBe(202);
    expect(res.body.message).toContain('取り込みを開始しました');
    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://example.invalid/trigger');
    expect((init as RequestInit).method).toBe('POST');
    expect(((init as RequestInit).headers as Record<string, string>).Authorization).toBe(
      'Bearer test-token'
    );
  });

  it('returns 429 when called within 5 minutes of previous success (DB locked)', async () => {
    mockPool.query.mockResolvedValue({ rows: [] });
    mockPool.connect.mockResolvedValue(makeLockedClient(Date.now() + 4 * 60 * 1000));

    const res = await request(buildApp()).post('/api/admin/procast-sync/trigger');
    expect(res.status).toBe(429);
    expect(res.body.error).toContain('5分以内');
    expect(res.body.retryAfterSec).toBeGreaterThan(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns 502 when upstream returns non-2xx', async () => {
    mockPool.query.mockResolvedValue({ rows: [] });
    mockPool.connect.mockResolvedValue(makeFreeClient());

    fetchSpy.mockResolvedValueOnce(
      new Response('upstream auth failed', { status: 401 })
    );
    const res = await request(buildApp()).post('/api/admin/procast-sync/trigger');
    expect(res.status).toBe(502);
    expect(res.body.error).toContain('upstream 401');
  });

  it('returns 502 when fetch throws (timeout/network)', async () => {
    mockPool.query.mockResolvedValue({ rows: [] });
    mockPool.connect.mockResolvedValue(makeFreeClient());

    fetchSpy.mockRejectedValueOnce(new Error('timeout'));
    const res = await request(buildApp()).post('/api/admin/procast-sync/trigger');
    expect(res.status).toBe(502);
    expect(res.body.detail).toContain('timeout');
  });
});
