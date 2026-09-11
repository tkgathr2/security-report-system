import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import http from 'http';
import type { AddressInfo } from 'net';
import type { Request, Response, NextFunction } from 'express';

// KZ-147: 外注スタッフの枠（カナ：ガイチュウスタッフ）は個人ではないため、管理画面から
// メールアドレスを登録したりログインURLを送ったりできないことを検証する。
// （本番では外注枠のレコードに川面さんのメールが付き、その枠の現場案内が川面さんに届く状態になった）

const queryMock = vi.fn();
const clientQueryMock = vi.fn();
const sendLoginUrlEmailMock = vi.fn();

vi.mock('../db/pool', () => ({
  default: {
    query: (...args: unknown[]) => queryMock(...args),
    connect: vi.fn(async () => ({ query: (...args: unknown[]) => clientQueryMock(...args), release: vi.fn() })),
  },
}));

vi.mock('../middleware/auth', () => ({
  requireAdmin: (req: Request, _res: Response, next: NextFunction) => {
    req.user = { email: 'admin@example.com' } as Express.User;
    next();
  },
}));

vi.mock('../utils/auditLog', () => ({ logAudit: vi.fn() }));
vi.mock('../utils/email', () => ({ sendLoginUrlEmail: (...args: unknown[]) => sendLoginUrlEmailMock(...args) }));
vi.mock('../services/dailyReminderService', () => ({ sendRemindersNow: vi.fn() }));
vi.mock('../utils/rateLimit', () => ({ checkAndIncrementRateLimitDb: vi.fn().mockResolvedValue({ allowed: true }) }));

describe('管理画面: 外注スタッフへのメール登録・ログインURL送信の禁止（KZ-147）', () => {
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

  beforeEach(() => {
    queryMock.mockReset();
    clientQueryMock.mockReset();
    sendLoginUrlEmailMock.mockReset();
  });

  async function request(method: string, path: string, body: Record<string, unknown>) {
    const res = await fetch(`${baseUrl}/api/admin${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as { message?: string } };
  }

  it('PUT /staff/:id: 外注スタッフにメールアドレスを登録しようとすると400で、DBを更新しない', async () => {
    const { status, body } = await request('PUT', '/staff/st-tiger2', {
      display_name_kanji: 'タイガーセキュリティー２',
      display_name_kana: 'ガイチュウスタッフ',
      email: 'kawamo@example.com',
    });

    expect(status).toBe(400);
    expect(body.message).toContain('外注スタッフ');
    expect(clientQueryMock).not.toHaveBeenCalled();
  });

  it('PUT /staff/:id: 外注スタッフでもメールなしなら名前は更新できる', async () => {
    clientQueryMock.mockImplementation(async (sql: string) => {
      if (/UPDATE staff_master/.test(sql)) {
        return { rows: [{ id: 'st-tiger2', display_name_kanji: 'タイガーセキュリティー２', display_name_kana: 'ガイチュウスタッフ', email: '' }] };
      }
      return { rows: [] };
    });

    const { status } = await request('PUT', '/staff/st-tiger2', {
      display_name_kanji: 'タイガーセキュリティー２',
      display_name_kana: 'ガイチュウスタッフ',
      email: '',
    });

    expect(status).toBe(200);
  });

  it('POST /send-login-url: 外注スタッフ宛てには送らず、メールも書き込まない', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{ name: 'タイガーセキュリティー２', kana: 'ガイチュウスタッフ', sm_email: null, cu_email: null }],
    });

    const { status, body } = await request('POST', '/send-login-url', {
      staff_id: 'st-tiger2',
      email: 'kawamo@example.com',
    });

    expect(status).toBe(400);
    expect(body.message).toContain('外注スタッフ');
    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(sendLoginUrlEmailMock).not.toHaveBeenCalled();
  });
});
