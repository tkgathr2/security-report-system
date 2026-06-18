import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

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

import adminProcastSyncRouter, { _resetCooldownForTests } from './adminProcastSync';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/procast-sync', adminProcastSyncRouter);
  return app;
}

describe('POST /api/admin/procast-sync/trigger', () => {
  const origEnv = { ...process.env };
  const fetchSpy = vi.spyOn(global, 'fetch');

  beforeEach(() => {
    _resetCooldownForTests();
    fetchSpy.mockReset();
    process.env.PROCAST_SYNC_TRIGGER_URL = 'https://example.invalid/trigger';
    process.env.PROCAST_SYNC_TRIGGER_TOKEN = 'test-token';
  });

  afterEach(() => {
    process.env = { ...origEnv };
  });

  it('returns 503 when token env is missing (feature disabled)', async () => {
    delete process.env.PROCAST_SYNC_TRIGGER_TOKEN;
    const res = await request(buildApp()).post('/api/admin/procast-sync/trigger');
    expect(res.status).toBe(503);
    expect(res.body.error).toContain('未設定');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('proxies to upstream with Bearer token and returns 202 on success', async () => {
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

  it('returns 429 when called within 5 minutes of previous success', async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ message: 'started' }), { status: 200 })
    );
    const app = buildApp();
    const first = await request(app).post('/api/admin/procast-sync/trigger');
    expect(first.status).toBe(202);

    const second = await request(app).post('/api/admin/procast-sync/trigger');
    expect(second.status).toBe(429);
    expect(second.body.error).toContain('5分以内');
    expect(second.body.retryAfterSec).toBeGreaterThan(0);
    expect(fetchSpy).toHaveBeenCalledOnce(); // 2回目は upstream を叩かない
  });

  it('returns 502 when upstream returns non-2xx', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response('upstream auth failed', { status: 401 })
    );
    const res = await request(buildApp()).post('/api/admin/procast-sync/trigger');
    expect(res.status).toBe(502);
    expect(res.body.error).toContain('upstream 401');
  });

  it('returns 502 when fetch throws (timeout/network)', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('timeout'));
    const res = await request(buildApp()).post('/api/admin/procast-sync/trigger');
    expect(res.status).toBe(502);
    expect(res.body.detail).toContain('timeout');
  });
});
