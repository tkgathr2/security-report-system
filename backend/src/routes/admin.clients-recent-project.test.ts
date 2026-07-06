import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import http from 'http';
import type { AddressInfo } from 'net';
import type { Request, Response, NextFunction } from 'express';

// GET /clients が has_recent_project（直近1か月〜未来の有効案件フラグ）を返すことの契約テスト。
// DBはモックし、発行SQLの内容とレスポンスのパススルーを検証する。

const queryMock = vi.fn();

vi.mock('../db/pool', () => ({
  default: {
    query: (...args: unknown[]) => queryMock(...args),
    connect: vi.fn(),
  },
}));

vi.mock('../middleware/auth', () => ({
  requireAdmin: (req: Request, _res: Response, next: NextFunction) => {
    req.user = { email: 'admin@example.com' } as Express.User;
    next();
  },
}));

vi.mock('../utils/auditLog', () => ({ logAudit: vi.fn() }));
vi.mock('../utils/email', () => ({ sendLoginUrlEmail: vi.fn() }));
vi.mock('../services/dailyReminderService', () => ({ sendRemindersNow: vi.fn() }));
vi.mock('../utils/rateLimit', () => ({ checkAndIncrementRateLimitDb: vi.fn() }));

describe('GET /api/admin/clients (has_recent_project)', () => {
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    const { default: adminRouter } = await import('./admin');
    const app = express();
    app.use(express.json());
    app.use('/api/admin', adminRouter);
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    );
  });

  it('SQLに has_recent_project 列（削除済み除外＋1か月ウィンドウ）が含まれ、行がそのまま返る', async () => {
    const rows = [
      { id: 'c1', name: '三和警備保障株式会社', has_recent_project: true },
      { id: 'c2', name: '休眠株式会社', has_recent_project: false },
    ];
    queryMock.mockResolvedValueOnce({ rows });

    const res = await fetch(`${baseUrl}/api/admin/clients`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { clients: unknown; total: number };
    expect(body.clients).toEqual(rows);
    expect(body.total).toBe(2);

    const sql: string = queryMock.mock.calls[0][0];
    expect(sql).toContain('AS has_recent_project');
    expect(sql).toContain('p.client_id = c.id');
    expect(sql).toContain('p.deleted_at IS NULL');
    expect(sql).toContain("Asia/Tokyo");
    expect(sql).toMatch(/work_date\s*>=.*INTERVAL '1 month'/s);
  });
});
