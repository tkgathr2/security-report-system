// プロキャストCSV取込時のキャスト(staff_master)突合ロジック。
// 方針（2026-06 スタッフNoキー化）:
//   1. スタッフNo(procast_staff_no)で照合する。名前は表示項目であり identity ではない。
//      No一致時はプロキャスト側の名前を正として表記（改姓・スペースゆれ）を追従更新する。
//   2. Noで見つからない場合のみ名前(漢字→カナ)で照合する。ただし対象は
//      「No未付与のレコード」だけ。別のNoが付いた同姓同名レコードは別人なので吸収しない。
//      名前一致したNo未付与レコードにはNoをバックフィルする。
//   3. どちらでも見つからなければ新規作成（No付き）。
// これにより同姓同名の別人が正しく別レコードとして共存できる。

interface QueryResult {
  rows: Array<Record<string, unknown>>;
}

export interface DbClient {
  query(text: string, params?: unknown[]): Promise<QueryResult>;
}

export interface ResolveStaffParams {
  staffNo: string | null;
  castName: string;
  castNameKana: string | null;
  adminEmail: string;
}

export interface ResolveStaffResult {
  staffId: string;
  autoAdded: boolean;
}

// SQL側のスペース正規化（既存取込と同じ規則: 半角/全角スペース除去で比較）
const NRM = (col: string) => `REPLACE(REPLACE(${col}, ' ', ''), E'\\u3000', '')`;

export async function resolveStaffForImport(
  db: DbClient,
  { staffNo, castName, castNameKana, adminEmail }: ResolveStaffParams
): Promise<ResolveStaffResult> {
  const staffKana = castNameKana || castName;
  const normalizedKana = staffKana.replace(/\s+/g, ' ').replace(/　/g, ' ').trim();
  const no = staffNo && staffNo.trim() !== '' ? staffNo.trim() : null;

  // 1) スタッフNoで照合（最優先）
  if (no) {
    const byNo = await db.query(
      `SELECT id, display_name_kanji, display_name_kana FROM staff_master
       WHERE procast_staff_no = $1 AND deleted_at IS NULL LIMIT 1`,
      [no]
    );
    if (byNo.rows[0]) {
      const row = byNo.rows[0] as { id: string; display_name_kanji: string; display_name_kana: string };
      if (row.display_name_kanji !== castName || row.display_name_kana !== normalizedKana) {
        await db.query(
          `UPDATE staff_master SET display_name_kanji = $1, display_name_kana = $2, updated_at = CURRENT_TIMESTAMP
           WHERE id = $3`,
          [castName, normalizedKana, row.id]
        );
      }
      return { staffId: row.id, autoAdded: false };
    }

    const softDeletedByNo = await db.query(
      `SELECT id FROM staff_master
       WHERE procast_staff_no = $1 AND deleted_at IS NOT NULL LIMIT 1`,
      [no]
    );
    if (softDeletedByNo.rows[0]) {
      const id = (softDeletedByNo.rows[0] as { id: string }).id;
      await db.query(
        `UPDATE staff_master SET deleted_at = NULL, display_name_kanji = $1, display_name_kana = $2, updated_at = CURRENT_TIMESTAMP
         WHERE id = $3`,
        [castName, normalizedKana, id]
      );
      return { staffId: id, autoAdded: false };
    }
  }

  // 2) 名前で照合（No未付与レコードのみ。別Noの同姓同名は別人なので対象外）
  const noGuard = `AND (procast_staff_no IS NULL${no ? ' OR procast_staff_no = $2' : ''})`;
  const nameParams = no ? [castName, no] : [castName];
  let byName = await db.query(
    `SELECT id, procast_staff_no FROM staff_master
     WHERE ${NRM('display_name_kanji')} = ${NRM('$1')} AND deleted_at IS NULL ${noGuard} LIMIT 1`,
    nameParams
  );
  if (!byName.rows[0]) {
    const kanaParams = no ? [staffKana, no] : [staffKana];
    byName = await db.query(
      `SELECT id, procast_staff_no FROM staff_master
       WHERE ${NRM('display_name_kana')} = ${NRM('$1')} AND deleted_at IS NULL ${noGuard} LIMIT 1`,
      kanaParams
    );
  }
  if (byName.rows[0]) {
    const row = byName.rows[0] as { id: string; procast_staff_no: string | null };
    if (no && !row.procast_staff_no) {
      await db.query(
        `UPDATE staff_master SET procast_staff_no = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
        [no, row.id]
      );
    }
    return { staffId: row.id, autoAdded: false };
  }

  // soft-deleted の名前復活（No未付与 or 同No のものに限る）
  const softParams = no ? [staffKana, no] : [staffKana];
  const softDeleted = await db.query(
    `SELECT id FROM staff_master
     WHERE ${NRM('display_name_kana')} = ${NRM('$1')} AND deleted_at IS NOT NULL
       AND (procast_staff_no IS NULL${no ? ' OR procast_staff_no = $2' : ''}) LIMIT 1`,
    softParams
  );
  if (softDeleted.rows[0]) {
    const id = (softDeleted.rows[0] as { id: string }).id;
    await db.query(
      `UPDATE staff_master SET deleted_at = NULL${no ? ', procast_staff_no = $2' : ''}, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      no ? [id, no] : [id]
    );
    return { staffId: id, autoAdded: false };
  }

  // 3) 新規作成（取込同時実行のレースは procast_staff_no の一意indexで防ぎ、衝突時は既存を引く）
  const inserted = await db.query(
    `INSERT INTO staff_master (display_name_kanji, display_name_kana, procast_staff_no, created_at, updated_at, created_by)
     VALUES ($1, $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, $4)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [castName, normalizedKana, no, adminEmail]
  );
  if (inserted.rows[0]) {
    return { staffId: (inserted.rows[0] as { id: string }).id, autoAdded: true };
  }

  if (no) {
    const raced = await db.query(
      `SELECT id FROM staff_master WHERE procast_staff_no = $1 AND deleted_at IS NULL LIMIT 1`,
      [no]
    );
    if (raced.rows[0]) {
      return { staffId: (raced.rows[0] as { id: string }).id, autoAdded: false };
    }
  }

  // リトライもON CONFLICT DO NOTHINGにする。素のINSERTで23505を出すと
  // 取込トランザクション全体がabortし、CSV取込が丸ごと失敗するため（2026-06-12障害の教訓）。
  const retried = await db.query(
    `INSERT INTO staff_master (display_name_kanji, display_name_kana, procast_staff_no, created_at, updated_at, created_by)
     VALUES ($1, $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, $4)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [castName, normalizedKana, no, adminEmail]
  );
  if (retried.rows[0]) {
    return { staffId: (retried.rows[0] as { id: string }).id, autoAdded: true };
  }

  // 最終フォールバック: 想定外のユニーク制約（残存index等）で新規作成が弾かれた場合は、
  // 取込を止めるより既存の同名レコードへ紐付ける（従来の名前照合と同じ挙動に縮退）。
  const lastResort = await db.query(
    `SELECT id FROM staff_master
     WHERE ${NRM('display_name_kana')} = ${NRM('$1')} AND deleted_at IS NULL LIMIT 1`,
    [staffKana]
  );
  if (lastResort.rows[0]) {
    return { staffId: (lastResort.rows[0] as { id: string }).id, autoAdded: false };
  }

  throw new Error(
    `staffResolver: キャスト「${castName}」(No=${no ?? 'なし'}) を作成も照合もできませんでした。staff_masterの制約を確認してください。`
  );
}
