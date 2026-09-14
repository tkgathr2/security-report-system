import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import http from 'http';
import type { AddressInfo } from 'net';
import type { Request, Response, NextFunction } from 'express';

// KZ-148: 警備員の開始/終了時刻が空のまま報告書（PDF・メール）が取引先へ送られていた。
// POST /api/reports/approve が時刻の空を 400 で拒否し、DB に到達しないことを検証する。
// 時刻がそろっていればバリデーションを通過して案件取得（DB）へ進むことも確認する。

const queryMock = vi.fn();

vi.mock('../db/pool', () => ({
  default: {
    query: (...args: unknown[]) => queryMock(...args),
    connect: vi.fn(),
  },
}));

vi.mock('../middleware/auth', () => ({
  authenticateCast: (req: Request & { castUser?: unknown }, _res: Response, next: NextFunction) => {
    req.castUser = { userId: 'cu-1', email: 'cast@example.com' };
    next();
  },
  requireAdmin: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

vi.mock('../services/emailSender', () => ({
  sendCompanyNotificationEmails: vi.fn(),
  sendWriterAndAdminNotifications: vi.fn(),
}));
vi.mock('../services/notifications', () => ({
  sendSlackNotification: vi.fn(),
  uploadPdfToSlack: vi.fn(),
  SLACK_REPORT_MENTIONS: '',
}));
vi.mock('../services/pdfGenerator', () => ({ generateReportPdf: vi.fn() }));
vi.mock('../services/pdfStorage', () => ({ default: {} }));
vi.mock('../utils/auditLog', () => ({ logAudit: vi.fn() }));

describe('POST /api/reports/approve（KZ-148 警備員の時刻を必須にする）', () => {
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    const { default: reportsRouter } = await import('./reports');
    const app = express();
    app.use(express.json({ limit: '5mb' }));
    app.use('/api/reports', reportsRouter);
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
    queryMock.mockResolvedValue({ rows: [] });
  });

  async function approve(guards: Array<Record<string, unknown>>) {
    const res = await fetch(`${baseUrl}/api/reports/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project_unique_url: 'unique-url-1',
        writer_name: '川面 直人',
        weather: 'sunny',
        guard_contents: ['交通誘導'],
        guards,
        signature_png_base64: 'iVBORw0KGgo=',
      }),
    });
    return { status: res.status, body: (await res.json()) as { message?: string } };
  }

  it('終了時刻が空の警備員がいると 400 で拒否し、DB に到達しない', async () => {
    const { status, body } = await approve([
      { index: 1, name: '川面 直人', start_time: '08:00', end_time: '17:00' },
      { index: 2, name: '山田 太郎', start_time: '08:00', end_time: '' },
    ]);

    expect(status).toBe(400);
    expect(body.message).toContain('山田 太郎');
    expect(body.message).toContain('終了時刻');
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('開始時刻が無い（キー自体が無い）警備員がいても 400 で拒否する', async () => {
    const { status } = await approve([{ index: 1, name: '川面 直人', end_time: '17:00' }]);

    expect(status).toBe(400);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('空白だけの時刻も未入力として拒否する', async () => {
    const { status } = await approve([{ index: 1, name: '川面 直人', start_time: '08:00', end_time: '  ' }]);

    expect(status).toBe(400);
  });

  it('全警備員の時刻がそろっていればバリデーションを通過し、案件の取得へ進む', async () => {
    const { status } = await approve([
      { index: 1, name: '川面 直人', start_time: '08:00', end_time: '17:00' },
      { index: 2, name: '山田 太郎', start_time: '8:00', end_time: '翌2:00' },
    ]);

    // 案件が見つからない（モックが空を返す）ため 404。時刻チェックでは弾かれていない。
    expect(status).not.toBe(400);
    expect(queryMock).toHaveBeenCalled();
  });
});
