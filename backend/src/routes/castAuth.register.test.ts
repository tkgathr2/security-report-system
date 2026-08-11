import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import http from 'http';
import type { AddressInfo } from 'net';

// KZ-127: 削除済みキャストの同一メールでの再登録が
// 「このメールアドレスは既に他のキャストに使用されています」等で阻まれず、
// 論理削除された cast_users 行が正しく復活（deleted_at = NULL）することを検証する。
// DB・メール送信・監査ログはすべてモックし、ルートのロジック分岐だけを検証対象とする。

const queryMock = vi.fn();
const sendVerificationEmailMock = vi.fn().mockResolvedValue({ success: true, data: { id: 'email-1' } });

vi.mock('../db/pool', () => ({
  default: {
    query: (...args: unknown[]) => queryMock(...args),
    connect: vi.fn(),
  },
}));

vi.mock('../utils/email', () => ({
  sendVerificationEmail: (...args: unknown[]) => sendVerificationEmailMock(...args),
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

describe('POST /api/cast/register (KZ-127 削除→再登録)', () => {
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

  async function postRegister(email: string) {
    const res = await fetch(`${baseUrl}/api/cast/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    return { status: res.status, body: (await res.json()) as { message?: string; redirect?: string } };
  }

  it('論理削除済みの同一メールの cast_users 行を復活させる（新規INSERTしない）', async () => {
    queryMock.mockReset();
    sendVerificationEmailMock.mockClear();

    // 1) existingUser (deleted_at IS NULL) 検索 → ヒットなし（削除済みなので）
    queryMock.mockResolvedValueOnce({ rows: [] });
    // 2) staffLookup（staff_master 側でメール一致確認）→ ヒットあり
    queryMock.mockResolvedValueOnce({ rows: [{ id: 'staff-1' }] });
    // 3) softDeleted 検索 → 削除済み行がヒット
    queryMock.mockResolvedValueOnce({ rows: [{ id: 'cast-user-old-id' }] });
    // 4) 復活UPDATE
    queryMock.mockResolvedValueOnce({ rows: [] });

    const { status, body } = await postRegister('kanno@example.com');

    expect(status).toBe(200);
    expect(body.message).toContain('確認メール');

    // INSERT ではなく UPDATE (復活) が呼ばれたことを確認
    const calls = queryMock.mock.calls.map(c => String(c[0]));
    const revivalCall = calls.find(sql => sql.includes('SET deleted_at = NULL'));
    expect(revivalCall).toBeDefined();
    const insertCall = calls.find(sql => sql.trim().startsWith('INSERT INTO cast_users'));
    expect(insertCall).toBeUndefined();

    expect(sendVerificationEmailMock).toHaveBeenCalledTimes(1);
  });

  it('cast_users 行が全く存在しない場合は新規INSERTする', async () => {
    queryMock.mockReset();
    sendVerificationEmailMock.mockClear();

    queryMock.mockResolvedValueOnce({ rows: [] }); // existingUser
    queryMock.mockResolvedValueOnce({ rows: [] }); // staffLookup
    queryMock.mockResolvedValueOnce({ rows: [] }); // softDeleted
    queryMock.mockResolvedValueOnce({ rows: [{ id: 'new-cast-user-id' }] }); // INSERT

    const { status } = await postRegister('brand-new@example.com');

    expect(status).toBe(200);
    const calls = queryMock.mock.calls.map(c => String(c[0]));
    const insertCall = calls.find(sql => sql.trim().startsWith('INSERT INTO cast_users'));
    expect(insertCall).toBeDefined();
  });

  it('既に登録済み（email_verified かつ紐付け済み）なら登録済みメッセージを返す', async () => {
    queryMock.mockReset();

    queryMock.mockResolvedValueOnce({
      rows: [{ id: 'cast-1', email_verified: true, staff_id: 'staff-1', name: '神野 音成' }],
    });

    const { status, body } = await postRegister('kanno@example.com');

    expect(status).toBe(400);
    expect(body.redirect).toBe('/cast/login');
  });
});

describe('POST /api/cast/field-register (KZ-127 兄弟経路: モバイル登録)', () => {
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

  it('新規登録INSERTの ON CONFLICT は実際のインデックス LOWER(email) と一致する式を使う', async () => {
    queryMock.mockReset();

    queryMock.mockResolvedValueOnce({ rows: [] }); // staffMatch
    queryMock.mockResolvedValueOnce({ rows: [] }); // existingUser（cast_users）
    queryMock.mockResolvedValueOnce({
      rows: [{ id: 'new-id', email: 'mobile@example.com', created_at: '2026-08-11T00:00:00.000Z' }],
    }); // INSERT ... ON CONFLICT

    const res = await fetch(`${baseUrl}/api/cast/field-register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'mobile@example.com', pin: '1234' }),
    });

    expect(res.status).toBe(201);

    const calls = queryMock.mock.calls.map(c => String(c[0]));
    const insertCall = calls.find(sql => sql.includes('INSERT INTO cast_users'));
    expect(insertCall).toBeDefined();
    // 実際に本番で有効なインデックスは idx_cast_users_email_lower_active = UNIQUE (LOWER(email))。
    // ON CONFLICT (email) のような不一致な式を書くと、conflictが起きなくても
    // 「there is no unique or exclusion constraint matching the ON CONFLICT specification」で
    // 常に失敗する（PostgreSQL は実行のたびに arbiter index を解決するため）。
    expect(insertCall).toMatch(/ON CONFLICT \(LOWER\(email\)\)/);
  });
});
