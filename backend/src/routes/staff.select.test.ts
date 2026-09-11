import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import http from 'http';
import type { AddressInfo } from 'net';

// KZ-147: 報告書画面の名前選択（POST /api/staff/select）で、認証済みキャストが任意のスタッフに
// 自分を紐付け直せたため、外注スタッフ「タイガーセキュリティ２」の行に別人（川面さん）の
// メールが表示される状態になり得た。紐付けてよいケースだけ通ることを検証する。
// DB・認証・監査ログはモックし、ルートの分岐だけを検証対象とする。

const queryMock = vi.fn();
const logAuditMock = vi.fn();

vi.mock('../db/pool', () => ({
  default: {
    query: (...args: unknown[]) => queryMock(...args),
    connect: vi.fn(),
  },
}));

vi.mock('../middleware/auth', () => ({
  authenticateCast: (req: { castUser?: unknown }, _res: unknown, next: () => void) => {
    req.castUser = { userId: 'cu-kawamo', email: 'kawamo@example.com' };
    next();
  },
}));

vi.mock('../utils/auditLog', () => ({ logAudit: (...args: unknown[]) => logAuditMock(...args) }));

const CURRENT_SQL = /FROM cast_users cu\s+LEFT JOIN staff_master/;
const STAFF_SQL = /SELECT id, display_name_kanji, display_name_kana, email FROM staff_master/;
const UPDATE_SQL = /UPDATE cast_users/;

function currentRow(staffId: string | null, linkedToActiveStaff: boolean) {
  return { rows: [{ staff_id: staffId, email: 'kawamo@example.com', linked_to_active_staff: linkedToActiveStaff }] };
}

function staffRow(id: string, name: string, email: string | null = null, kana = 'カワオモ ナオト') {
  return { rows: [{ id, display_name_kanji: name, display_name_kana: kana, email }] };
}

function updateCalls() {
  return queryMock.mock.calls.filter(([sql]) => UPDATE_SQL.test(String(sql)));
}

describe('POST /api/staff/select（KZ-147 別人への紐付け防止）', () => {
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    const { default: staffRouter } = await import('./staff');
    const app = express();
    app.use(express.json());
    app.use('/api/staff', staffRouter);
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
    logAuditMock.mockReset();
  });

  async function postSelect(staffId: string, name: string) {
    const res = await fetch(`${baseUrl}/api/staff/select`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ staff_id: staffId, staff_name_kanji: name }),
    });
    return { status: res.status, body: (await res.json()) as { error?: string; selectedNameKanji?: string } };
  }

  it('未紐付けのキャストが空いている自分の名前を選ぶと紐付き、監査ログが残る', async () => {
    queryMock.mockResolvedValueOnce(currentRow(null, false));
    queryMock.mockResolvedValueOnce(staffRow('st-kawamo', '川面直人'));
    queryMock.mockResolvedValueOnce({ rows: [{ id: 'cu-kawamo' }] });

    const { status, body } = await postSelect('st-kawamo', '川面直人');

    expect(status).toBe(200);
    expect(body.selectedNameKanji).toBe('川面直人');
    expect(String(queryMock.mock.calls[0][0])).toMatch(CURRENT_SQL);
    expect(String(queryMock.mock.calls[1][0])).toMatch(STAFF_SQL);
    const updates = updateCalls();
    expect(updates).toHaveLength(1);
    expect(String(updates[0][0])).toMatch(/NOT EXISTS/);
    expect(updates[0][1]).toEqual(['st-kawamo', 'cu-kawamo', null]);
    expect(logAuditMock).toHaveBeenCalledTimes(1);
    expect(logAuditMock.mock.calls[0][0]).toMatchObject({
      action: 'CAST_SELECT_STAFF',
      actorType: 'cast',
      targetId: 'cu-kawamo',
      payload: { staff_id: 'st-kawamo', previous_staff_id: null },
    });
  });

  it('既に有効な名前に紐付いているキャストは別の名前（外注スタッフ等）へ付け替えられない', async () => {
    queryMock.mockResolvedValueOnce(currentRow('st-kawamo', true));
    queryMock.mockResolvedValueOnce(staffRow('st-tiger2', 'タイガーセキュリティ２'));

    const { status, body } = await postSelect('st-tiger2', 'タイガーセキュリティ２');

    expect(status).toBe(409);
    expect(body.error).toBe('ALREADY_LINKED');
    expect(updateCalls()).toHaveLength(0);
    expect(logAuditMock).not.toHaveBeenCalled();
  });

  it('未紐付けのキャストでも外注スタッフの枠（カナ：ガイチュウスタッフ）は選べない', async () => {
    queryMock.mockResolvedValueOnce(currentRow(null, false));
    queryMock.mockResolvedValueOnce(staffRow('st-tiger2', 'タイガーセキュリティー２', null, 'ガイチュウスタッフ'));

    const { status, body } = await postSelect('st-tiger2', 'タイガーセキュリティー２');

    expect(status).toBe(409);
    expect(body.error).toBe('OUTSOURCED_STAFF');
    expect(updateCalls()).toHaveLength(0);
    expect(logAuditMock).not.toHaveBeenCalled();
  });

  it('他の有効なキャストが既に使っている名前は選べない', async () => {
    queryMock.mockResolvedValueOnce(currentRow(null, false));
    queryMock.mockResolvedValueOnce(staffRow('st-other', '山田太郎'));
    queryMock.mockResolvedValueOnce({ rows: [] }); // NOT EXISTS により更新0件

    const { status, body } = await postSelect('st-other', '山田太郎');

    expect(status).toBe(409);
    expect(body.error).toBe('STAFF_ALREADY_LINKED');
    expect(logAuditMock).not.toHaveBeenCalled();
  });

  it('スタッフ台帳に別のメールが登録されている名前は選べない', async () => {
    queryMock.mockResolvedValueOnce(currentRow(null, false));
    queryMock.mockResolvedValueOnce(staffRow('st-other', '山田太郎', 'yamada@example.com'));

    const { status, body } = await postSelect('st-other', '山田太郎');

    expect(status).toBe(409);
    expect(body.error).toBe('STAFF_EMAIL_MISMATCH');
    expect(updateCalls()).toHaveLength(0);
  });

  it('台帳メールが本人のメール（大文字小文字違い）なら選べる', async () => {
    queryMock.mockResolvedValueOnce(currentRow(null, false));
    queryMock.mockResolvedValueOnce(staffRow('st-kawamo', '川面直人', 'Kawamo@Example.com'));
    queryMock.mockResolvedValueOnce({ rows: [{ id: 'cu-kawamo' }] });

    const { status } = await postSelect('st-kawamo', '川面直人');

    expect(status).toBe(200);
    expect(updateCalls()).toHaveLength(1);
  });

  it('紐付け先が削除済みスタッフ（KZ-127 の再登録ケース）なら選び直せる', async () => {
    queryMock.mockResolvedValueOnce(currentRow('st-deleted', false));
    queryMock.mockResolvedValueOnce(staffRow('st-kawamo', '川面直人'));
    queryMock.mockResolvedValueOnce({ rows: [{ id: 'cu-kawamo' }] });

    const { status } = await postSelect('st-kawamo', '川面直人');

    expect(status).toBe(200);
    expect(updateCalls()[0][1]).toEqual(['st-kawamo', 'cu-kawamo', 'st-deleted']);
  });

  it('既に紐付いている自分の名前を選び直すのは何も変更せず成功する', async () => {
    queryMock.mockResolvedValueOnce(currentRow('st-kawamo', true));
    queryMock.mockResolvedValueOnce(staffRow('st-kawamo', '川面直人'));

    const { status } = await postSelect('st-kawamo', '川面直人');

    expect(status).toBe(200);
    expect(updateCalls()).toHaveLength(0);
    expect(logAuditMock).not.toHaveBeenCalled();
  });
});
