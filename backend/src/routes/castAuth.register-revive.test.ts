import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import http from 'http';
import type { AddressInfo } from 'net';

// KZ-127: 削除済み(soft-deleted) cast_users を再登録(復活)する際、
// 「削除済みstaff_masterを指す古いstaff_id」ではなく
// 「メールアドレスで新たに特定した現行staff_id」を優先しなければならない。
// COALESCEの引数順が誤っていると、削除→再作成したstaff_masterと紐付かず
// 「登録したのに未登録と表示される」不具合が起きる（本番incidentで実証済み）。

const queryMock = vi.fn();

vi.mock('../db/pool', () => ({
  default: {
    query: (...args: unknown[]) => queryMock(...args),
    connect: vi.fn(),
  },
}));

vi.mock('../utils/email', () => ({
  sendVerificationEmail: vi.fn().mockResolvedValue({ success: true }),
  sendMagicLinkEmail: vi.fn().mockResolvedValue({ success: true }),
  sendWelcomeEmail: vi.fn().mockResolvedValue({ success: true }),
  sendPinResetEmail: vi.fn().mockResolvedValue({ success: true }),
  sendInquiryNotificationEmail: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock('../utils/auditLog', () => ({ logAudit: vi.fn() }));
vi.mock('../utils/rateLimit', () => ({
  checkRateLimitDb: vi.fn().mockResolvedValue({ allowed: true }),
  recordFailedAttemptDb: vi.fn(),
  resetAttemptsDb: vi.fn(),
  checkAndIncrementRateLimitDb: vi.fn().mockResolvedValue({ allowed: true }),
}));

describe('POST /api/cast/register (soft-delete復活時のstaff_id紐付け)', () => {
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

  it('削除済みcast_usersを復活させる際、現行staff_id($3)を優先するSQLを発行する', async () => {
    queryMock.mockReset();
    // 1. existingUser: deleted_at IS NULL の現役レコードなし
    queryMock.mockResolvedValueOnce({ rows: [] });
    // 2. staffLookup: メールアドレスに一致する「現行」staff_masterが見つかる(削除→再作成後の新ID)
    queryMock.mockResolvedValueOnce({ rows: [{ id: 'new-staff-id' }] });
    // 3. softDeleted: 削除済み(古いstaff_idを持つ)cast_usersが見つかる
    queryMock.mockResolvedValueOnce({ rows: [{ id: 'cast-user-id' }] });
    // 4. UPDATE (復活処理)
    queryMock.mockResolvedValueOnce({ rows: [] });

    const res = await fetch(`${baseUrl}/api/cast/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'oto050514@gmail.com' }),
    });
    expect(res.status).toBe(200);

    const updateCall = queryMock.mock.calls[3];
    const [sql, params] = updateCall as [string, unknown[]];

    // COALESCEは「新たに特定したstaff_id($3)」を優先する順序でなければならない。
    // COALESCE(staff_id, $3) のように既存値を優先する順序に戻す退行を防ぐ。
    expect(sql).toContain('staff_id = COALESCE($3, staff_id)');
    expect(params[2]).toBe('new-staff-id'); // $3 = linkedStaffId
  });
});
