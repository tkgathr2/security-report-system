import { describe, it, expect, vi, beforeEach } from 'vitest';

// emailSender.ts imports pool from ../db/pool at module load (throws if DATABASE_URL is unset),
// and constructs a Resend client. Mock both so we can drive sendWriterAndAdminNotifications
// without touching a real DB or the network. Use vi.hoisted so the mock fns exist before
// the vi.mock factory (which is hoisted to top of file) runs.
const { mockQuery, mockResendSend } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockResendSend: vi.fn(),
}));
vi.mock('../db/pool', () => ({
  default: { query: mockQuery },
}));
vi.mock('resend', () => ({
  Resend: class {
    emails = { send: mockResendSend };
  },
}));

// Set env vars BEFORE module evaluation. vi.hoisted ensures these run before imports too.
vi.hoisted(() => {
  process.env.RESEND_API_KEY = 'test_dummy_key';
  process.env.ADMIN_NOTIFICATION_EMAILS = 'admin1@example.com, admin2@example.com';
});

import { sendWriterAndAdminNotifications } from './emailSender';

describe('sendWriterAndAdminNotifications — emailSender 経由切替（田所Critical#3対策）', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockResendSend.mockReset();
  });

  function baseParams(overrides: Partial<Parameters<typeof sendWriterAndAdminNotifications>[0]> = {}) {
    return {
      reportId: '11111111-1111-1111-1111-111111111111',
      companyId: '22222222-2222-2222-2222-222222222222',
      companyName: 'テスト株式会社',
      contactName: '田中',
      contactTitle: '部長',
      clientAddress: '大阪市中央区',
      workDate: '2026-06-16',
      projectName: 'テスト現場',
      writerEmail: 'writer@example.com',
      writerName: '記入者太郎',
      supervisorName: '監督者次郎',
      location: '現場A',
      pdfBuffer: Buffer.from('%PDF-1.4 dummy'),
      ...overrides,
    };
  }

  it('writer + admin(2件) 各宛先1件ずつ email_logs に INSERT/UPDATE が走る', async () => {
    // INSERT ... ON CONFLICT ... RETURNING id, status を毎回成功させる
    mockQuery.mockImplementation((sql: string) => {
      if (typeof sql === 'string' && sql.includes('INSERT INTO email_logs')) {
        return Promise.resolve({ rows: [{ id: 'log-' + Math.random().toString(36).slice(2), status: 'pending' }] });
      }
      // UPDATE / その他は空でOK
      return Promise.resolve({ rows: [] });
    });
    mockResendSend.mockResolvedValue({ data: { id: 'rmsg-1' }, error: null });

    const result = await sendWriterAndAdminNotifications(baseParams());

    expect(result.writerSent).toBe(true);
    expect(result.adminSent).toBe(true);
    expect(result.warnings).toEqual([]);

    // email_logs への書き込みが writer1件 + admin2件 = 計3件分発生していること（INSERTのみで3回以上）
    const insertCalls = mockQuery.mock.calls.filter(c => typeof c[0] === 'string' && c[0].includes('INSERT INTO email_logs'));
    expect(insertCalls.length).toBe(3);

    // recipient_type が writer/admin/admin の組み合わせで渡されていること
    const recipientTypes = insertCalls.map(c => c[1][3]);
    expect(recipientTypes.filter((t: string) => t === 'writer').length).toBe(1);
    expect(recipientTypes.filter((t: string) => t === 'admin').length).toBe(2);

    // resend.emails.send が3回呼ばれていること（writer + admin x 2）
    expect(mockResendSend).toHaveBeenCalledTimes(3);
  });

  it('admin 1件が永続エラー(404)でも writer と admin もう1件は成功扱い、warning に永続失敗が記録される', async () => {
    mockQuery.mockImplementation((sql: string) => {
      if (typeof sql === 'string' && sql.includes('INSERT INTO email_logs')) {
        return Promise.resolve({ rows: [{ id: 'log-x', status: 'pending' }] });
      }
      return Promise.resolve({ rows: [] });
    });

    // admin2@ だけ 404 永続エラー、それ以外は成功
    mockResendSend.mockImplementation(({ to }: { to: string[] }) => {
      if (to[0] === 'admin2@example.com') {
        return Promise.resolve({ data: null, error: { name: 'permanent', message: 'not found', statusCode: 404 } });
      }
      return Promise.resolve({ data: { id: 'rmsg-ok' }, error: null });
    });

    const result = await sendWriterAndAdminNotifications(baseParams());

    expect(result.writerSent).toBe(true);
    // 1件成功すれば adminSent=true
    expect(result.adminSent).toBe(true);
    expect(result.warnings.some(w => w.includes('管理者メール送信失敗'))).toBe(true);
  });
});
