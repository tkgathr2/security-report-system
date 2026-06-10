import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import http from 'http';
import type { AddressInfo } from 'net';
import type { Request, Response, NextFunction } from 'express';

// POST /staff の重複キー(23505)が汎用500ではなく409+案内メッセージになることを検証する。
// DB・認証・メール等はすべてモックし、ルートのエラーハンドリング分岐だけを検証対象とする。

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

describe('POST /api/admin/staff', () => {
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    const { default: adminRouter } = await import('./admin');
    const app = express();
    app.use(express.json());
    app.use('/api/admin', adminRouter);
    server = http.createServer(app);
    await new Promise<void>(resolve => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close(err => (err ? reject(err) : resolve()))
    );
  });

  async function postStaff(body: Record<string, string>) {
    const res = await fetch(`${baseUrl}/api/admin/staff`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as { error?: string; message?: string } };
  }

  it('カナ名の重複(unique violation 23505)は409と案内メッセージを返す', async () => {
    queryMock.mockRejectedValueOnce(
      Object.assign(new Error('duplicate key value violates unique constraint "idx_staff_master_display_name_kana_not_deleted"'), {
        code: '23505',
      })
    );

    const { status, body } = await postStaff({
      display_name_kanji: '山田 太郎',
      display_name_kana: 'ヤマダ タロウ',
    });

    expect(status).toBe(409);
    expect(body.error).toBe('DUPLICATE');
    expect(body.message).toContain('同じカタカナ名のキャストが既に登録されています');
  });

  it('23505以外のDBエラーは従来どおり500を返す', async () => {
    queryMock.mockRejectedValueOnce(new Error('connection refused'));

    const { status, body } = await postStaff({
      display_name_kanji: '山田 太郎',
      display_name_kana: 'ヤマダ タロウ',
    });

    expect(status).toBe(500);
    expect(body.error).toBe('INTERNAL_ERROR');
  });

  it('必須項目が欠けていれば400を返す', async () => {
    const { status, body } = await postStaff({ display_name_kanji: '山田 太郎', display_name_kana: '' });
    expect(status).toBe(400);
    expect(body.message).toContain('必須');
  });
});
