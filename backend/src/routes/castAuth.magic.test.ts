import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import http from 'http';
import type { AddressInfo } from 'net';

// KZ-145: 日次リマインダーメール（dailyReminderService）は magic_link_token ではなく
// 専用列 reminder_link_token を発行するようになった。POST /api/cast/magic は
// 両方の列をフォールバックで受け付ける必要がある（メール由来のログインを壊さないため）。
// DB・メール送信はすべてモックし、ルートのロジック分岐だけを検証対象とする。

const queryMock = vi.fn();

vi.mock('../db/pool', () => ({
  default: {
    query: (...args: unknown[]) => queryMock(...args),
    connect: vi.fn(),
  },
}));

vi.mock('../utils/email', () => ({
  sendVerificationEmail: vi.fn(),
  sendMagicLinkEmail: vi.fn(),
  sendWelcomeEmail: vi.fn().mockResolvedValue({ success: true }),
  sendPinResetEmail: vi.fn(),
  sendInquiryNotificationEmail: vi.fn(),
}));

vi.mock('../utils/auditLog', () => ({ logAudit: vi.fn() }));
vi.mock('../utils/rateLimit', () => ({
  checkRateLimitDb: vi.fn().mockResolvedValue({ allowed: true }),
  recordFailedAttemptDb: vi.fn(),
  resetAttemptsDb: vi.fn(),
  checkAndIncrementRateLimitDb: vi.fn().mockResolvedValue({ allowed: true }),
}));

describe('POST /api/cast/magic (KZ-145 reminder_link_token フォールバック)', () => {
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    const { default: castAuthRouter } = await import('./castAuth');
    const app = express();
    app.use(express.json());
    app.use('/api/cast', castAuthRouter);
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

  async function postMagic(token: string) {
    return fetch(`${baseUrl}/api/cast/magic`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
  }

  it('reminder_link_token 由来のトークンでもログインできる（メールのリンクが機能する）', async () => {
    queryMock.mockReset();
    queryMock.mockResolvedValueOnce({
      rows: [{ id: 'cast-1', email: 'cast1@example.com', staff_id: 'staff-1', name: '現場 太郎' }],
    }); // SELECT ... WHERE magic_link_token OR reminder_link_token
    queryMock.mockResolvedValueOnce({ rows: [] }); // UPDATE session issue + reminder_link_token clear

    const res = await postMagic('reminder-token-abc');
    expect(res.status).toBe(200);
    const body = await res.json() as { user: { email: string } };
    expect(body.user.email).toBe('cast1@example.com');

    // SELECT が両方の列を見ていることを確認（片方だけに戻す退行を防ぐ）
    const selectSql = queryMock.mock.calls[0][0] as string;
    expect(selectSql).toContain('magic_link_token');
    expect(selectSql).toContain('reminder_link_token');

    // ログイン成功時に reminder_link_token を使い切りにしている（再利用防止）ことを確認
    const updateSql = queryMock.mock.calls[1][0] as string;
    expect(updateSql).toContain('reminder_link_token = NULL');
  });

  it('無効なトークンは400になる', async () => {
    queryMock.mockReset();
    queryMock.mockResolvedValueOnce({ rows: [] });

    const res = await postMagic('nonexistent-token');
    expect(res.status).toBe(400);
  });
});
