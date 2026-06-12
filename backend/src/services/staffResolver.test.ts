import { describe, it, expect } from 'vitest';
import { resolveStaffForImport, DbClient } from './staffResolver';

// SQLパターンに応じて応答を返すスクリプト式のフェイクDB。
// 実行されたクエリを記録し、照合順序と更新内容を検証する。
type Responder = { match: RegExp; rows: Array<Record<string, unknown>> };

function makeDb(responders: Responder[]) {
  const calls: Array<{ text: string; params: unknown[] }> = [];
  const db: DbClient = {
    async query(text: string, params: unknown[] = []) {
      calls.push({ text, params });
      for (const r of responders) {
        if (r.match.test(text)) {
          // 同じパターンの2回目以降の呼び出しに別応答を返したい場合は配列順で消費
          responders = responders.filter(x => x !== r);
          return { rows: r.rows };
        }
      }
      return { rows: [] };
    },
  };
  return { db, calls };
}

const base = { castName: '山田 太郎', castNameKana: 'ヤマダ タロウ', adminEmail: 'admin@example.com' };

describe('resolveStaffForImport', () => {
  it('スタッフNoが一致する既存キャストに紐付け、名前の変更を追従する', async () => {
    const { db, calls } = makeDb([
      {
        match: /procast_staff_no = \$1 AND deleted_at IS NULL/,
        rows: [{ id: 'staff-1', display_name_kanji: '山田 太朗', display_name_kana: 'ヤマダ タロウ' }],
      },
    ]);

    const result = await resolveStaffForImport(db, { ...base, staffNo: 'S001' });

    expect(result).toEqual({ staffId: 'staff-1', autoAdded: false });
    const update = calls.find(c => /UPDATE staff_master SET display_name_kanji/.test(c.text));
    expect(update).toBeDefined();
    expect(update!.params).toEqual(['山田 太郎', 'ヤマダ タロウ', 'staff-1']);
  });

  it('Noで見つからない場合はNo未付与の同名キャストに紐付け、Noをバックフィルする', async () => {
    const { db, calls } = makeDb([
      { match: /REPLACE\(REPLACE\(display_name_kanji/, rows: [{ id: 'staff-2', procast_staff_no: null }] },
    ]);

    const result = await resolveStaffForImport(db, { ...base, staffNo: 'S002' });

    expect(result).toEqual({ staffId: 'staff-2', autoAdded: false });
    const backfill = calls.find(c => /SET procast_staff_no = \$1/.test(c.text));
    expect(backfill).toBeDefined();
    expect(backfill!.params).toEqual(['S002', 'staff-2']);
  });

  it('同姓同名でも別Noのキャストには吸収せず、新規レコードを作成する（同姓同名の別人対応）', async () => {
    // 名前照合クエリは「No未付与 or 同一No」しか対象にしないため、別Noの同名はヒットしない想定。
    // ここでは全照合ミス → 新規INSERTに到達することを確認する。
    const { db, calls } = makeDb([
      { match: /INSERT INTO staff_master/, rows: [{ id: 'staff-new' }] },
    ]);

    const result = await resolveStaffForImport(db, { ...base, staffNo: 'S003' });

    expect(result).toEqual({ staffId: 'staff-new', autoAdded: true });
    const insert = calls.find(c => /INSERT INTO staff_master/.test(c.text));
    expect(insert!.params).toEqual(['山田 太郎', 'ヤマダ タロウ', 'S003', 'admin@example.com']);
    // 名前照合クエリがNo未付与ガード付きであること
    const nameLookup = calls.find(c => /display_name_kanji/.test(c.text) && /procast_staff_no IS NULL/.test(c.text));
    expect(nameLookup).toBeDefined();
  });

  it('Noなし行は従来どおり名前(カナ)で照合できる', async () => {
    const { db } = makeDb([
      { match: /display_name_kana.*deleted_at IS NULL/s, rows: [{ id: 'staff-4', procast_staff_no: null }] },
    ]);

    const result = await resolveStaffForImport(db, { ...base, staffNo: null });

    expect(result).toEqual({ staffId: 'staff-4', autoAdded: false });
  });

  it('soft-deleted済みの同Noキャストは復活させて紐付ける', async () => {
    const { db, calls } = makeDb([
      { match: /procast_staff_no = \$1 AND deleted_at IS NOT NULL/, rows: [{ id: 'staff-5' }] },
    ]);

    const result = await resolveStaffForImport(db, { ...base, staffNo: 'S005' });

    expect(result).toEqual({ staffId: 'staff-5', autoAdded: false });
    const revive = calls.find(c => /SET deleted_at = NULL/.test(c.text));
    expect(revive).toBeDefined();
  });

  it('新規作成が残存ユニーク制約で弾かれ続けた場合は同名既存レコードへ縮退して取込を止めない', async () => {
    // 全照合ミス → INSERT2回ともON CONFLICTで空 → 最終フォールバックの名前照合で吸収
    // 最終フォールバックだけ「Noガードなし + deleted_at IS NULL LIMIT 1 が隣接」で一意に識別できる
    const { db } = makeDb([
      { match: /REPLACE\(REPLACE\(display_name_kana[\s\S]*deleted_at IS NULL LIMIT 1/, rows: [{ id: 'staff-fallback' }] },
    ]);

    const result = await resolveStaffForImport(db, { ...base, staffNo: 'S007' });

    expect(result).toEqual({ staffId: 'staff-fallback', autoAdded: false });
  });

  it('INSERTが一意制約で弾かれた場合は既存レコードを引いて返す（取込レース対応）', async () => {
    let insertCount = 0;
    const calls: Array<{ text: string; params: unknown[] }> = [];
    const db: DbClient = {
      async query(text: string, params: unknown[] = []) {
        calls.push({ text, params });
        if (/INSERT INTO staff_master/.test(text)) {
          insertCount++;
          return { rows: [] }; // ON CONFLICT DO NOTHING で空が返るケース
        }
        if (/procast_staff_no = \$1 AND deleted_at IS NULL/.test(text) && calls.length > 1) {
          return { rows: [{ id: 'staff-raced' }] };
        }
        return { rows: [] };
      },
    };

    const result = await resolveStaffForImport(db, { ...base, staffNo: 'S006' });

    expect(result).toEqual({ staffId: 'staff-raced', autoAdded: false });
    expect(insertCount).toBe(1);
  });
});
