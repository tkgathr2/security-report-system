import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import http from 'http';
import type { AddressInfo } from 'net';
import type { Request, Response, NextFunction } from 'express';

// POST /api/admin/staff/import が soft-delete 済みスタッフを無条件で復活させないことを検証する。
// 2026-09-10 バグ修正：キャスト管理画面から削除したスタッフが、翌日のスタッフCSVインポートで
// 再表示されてしまう不具合の回帰テスト（寺町さん報告 #総務_aidx）。
// bug-check-lab（北村）の逆検証指摘を反映：
//   - display_name_kana の部分UNIQUEは廃止済みのため、active行を必ず
//     `deleted_at IS NULL` + `ORDER BY` + `LIMIT 1` で確定的に取得すること
//   - 漢字更新のUPDATEは `WHERE id = ...` を使い、同カナの他レコード（同姓同名の別人）を
//     巻き込まないこと
// DB・認証はすべてモックし、ルートの分岐だけを検証対象とする。

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

describe('POST /api/admin/staff/import', () => {
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    const { default: adminRouter } = await import('./admin');
    const app = express();
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

  async function postCsv(csvContent: string) {
    const formData = new FormData();
    const blob = new Blob([csvContent], { type: 'text/csv' });
    formData.append('file', blob, 'staff.csv');

    const res = await fetch(`${baseUrl}/api/admin/staff/import`, {
      method: 'POST',
      body: formData,
    });
    return {
      status: res.status,
      body: (await res.json()) as { inserted: number; updated: number; skipped: number; skipped_deleted: number },
    };
  }

  it('soft-delete済みスタッフがCSVに含まれていても復活させず、UPDATEも発行せずskippedにする', async () => {
    queryMock.mockReset();
    // 1) active行の検索 → 0件（active行なし）
    queryMock.mockResolvedValueOnce({ rows: [] });
    // 2) 削除済み行の検索 → 1件ヒット
    queryMock.mockResolvedValueOnce({ rows: [{ id: 'staff-1' }] });
    // 3) 監査ログ INSERT
    queryMock.mockResolvedValueOnce({ rows: [] });

    const csv = '氏名,フリガナ\n山田太郎,ヤマダタロウ\n';
    const { status, body } = await postCsv(csv);

    expect(status).toBe(200);
    expect(body).toEqual({ inserted: 0, updated: 0, skipped: 1, skipped_deleted: 1 });

    // deleted_at を NULL に戻す UPDATE が一切発行されていないことを確認（復活防止の核心）
    const reviveCalls = queryMock.mock.calls.filter(
      call => typeof call[0] === 'string' && call[0].includes('deleted_at = NULL')
    );
    expect(reviveCalls.length).toBe(0);
  });

  it('active行検索SQLに deleted_at IS NULL / ORDER BY / LIMIT 1 が含まれる（非決定動作の防止）', async () => {
    queryMock.mockReset();
    queryMock.mockResolvedValueOnce({ rows: [] }); // active検索
    queryMock.mockResolvedValueOnce({ rows: [] }); // 削除済み検索
    queryMock.mockResolvedValueOnce({ rows: [{ id: 'new-id' }] }); // INSERT
    queryMock.mockResolvedValueOnce({ rows: [] }); // 監査ログ

    await postCsv('氏名,フリガナ\n佐藤花子,サトウハナコ\n');

    const activeSearchSql = queryMock.mock.calls[0][0] as string;
    expect(activeSearchSql).toContain('deleted_at IS NULL');
    expect(activeSearchSql).toContain('ORDER BY created_at');
    expect(activeSearchSql).toContain('LIMIT 1');
    expect(activeSearchSql).toContain('normalize_kana(');
  });

  it('新規スタッフ（既存レコードなし）は従来どおりinsertされる', async () => {
    queryMock.mockReset();
    queryMock.mockResolvedValueOnce({ rows: [] }); // active検索ヒットなし
    queryMock.mockResolvedValueOnce({ rows: [] }); // 削除済み検索ヒットなし
    queryMock.mockResolvedValueOnce({ rows: [{ id: 'new-staff-id' }] }); // INSERT
    queryMock.mockResolvedValueOnce({ rows: [] }); // 監査ログ

    const csv = '氏名,フリガナ\n佐藤花子,サトウハナコ\n';
    const { status, body } = await postCsv(csv);

    expect(status).toBe(200);
    expect(body).toEqual({ inserted: 1, updated: 0, skipped: 0, skipped_deleted: 0 });
  });

  it('削除されていない既存スタッフの漢字表記ゆれは従来どおりid指定で更新される', async () => {
    queryMock.mockReset();
    queryMock.mockResolvedValueOnce({
      rows: [{ id: 'staff-2', display_name_kanji: '鈴木一郎' }],
    }); // active検索ヒット
    queryMock.mockResolvedValueOnce({ rows: [] }); // UPDATE 漢字
    queryMock.mockResolvedValueOnce({ rows: [] }); // 監査ログ

    const csv = '氏名,フリガナ\n鈴木壱郎,スズキイチロウ\n';
    const { status, body } = await postCsv(csv);

    expect(status).toBe(200);
    expect(body).toEqual({ inserted: 0, updated: 1, skipped: 0, skipped_deleted: 0 });

    // UPDATE が id 指定で発行され、カナ全体への一括更新になっていないことを確認
    const updateCall = queryMock.mock.calls.find(
      call => typeof call[0] === 'string' && call[0].includes('UPDATE staff_master SET display_name_kanji')
    );
    expect(updateCall).toBeDefined();
    expect(updateCall![0]).toContain('WHERE id = $2');
    expect(updateCall![1]).toEqual(['鈴木壱郎', 'staff-2']);
  });
});
