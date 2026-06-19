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

// 表記揺れ吸収のための正規化（バグチェックラボ田所High#7対応 2026-06-16）。
// 半角/全角スペース除去だけだと、ひらがな/カタカナ違い、NFC vs NFD（"ガ" vs "カ+゛"）、
// 長音「ー/－/‐/−」のゆれ、半角カナを取り逃して別レコードを量産する。
// Node側のこの実装と、PostgreSQL側の normalize_kana(text) 関数（migration
// 1781500000000）は完全に同じ出力を返さなければならない（テストで検証）。
const HIRA_TO_KATA_OFFSET = 0x60; // ぁ(U+3041) → ァ(U+30A1)
const HIRA_RANGE_START = 0x3041;
const HIRA_RANGE_END = 0x3096;

// 半角カナ→全角カナ。濁点/半濁点は合成済み（NFC）を返す。
const HANKAKU_KANA_MAP: Record<string, string> = {
  'ｦ': 'ヲ', 'ｧ': 'ァ', 'ｨ': 'ィ', 'ｩ': 'ゥ', 'ｪ': 'ェ', 'ｫ': 'ォ',
  'ｬ': 'ャ', 'ｭ': 'ュ', 'ｮ': 'ョ', 'ｯ': 'ッ',
  'ｰ': 'ー',
  'ｱ': 'ア', 'ｲ': 'イ', 'ｳ': 'ウ', 'ｴ': 'エ', 'ｵ': 'オ',
  'ｶ': 'カ', 'ｷ': 'キ', 'ｸ': 'ク', 'ｹ': 'ケ', 'ｺ': 'コ',
  'ｻ': 'サ', 'ｼ': 'シ', 'ｽ': 'ス', 'ｾ': 'セ', 'ｿ': 'ソ',
  'ﾀ': 'タ', 'ﾁ': 'チ', 'ﾂ': 'ツ', 'ﾃ': 'テ', 'ﾄ': 'ト',
  'ﾅ': 'ナ', 'ﾆ': 'ニ', 'ﾇ': 'ヌ', 'ﾈ': 'ネ', 'ﾉ': 'ノ',
  'ﾊ': 'ハ', 'ﾋ': 'ヒ', 'ﾌ': 'フ', 'ﾍ': 'ヘ', 'ﾎ': 'ホ',
  'ﾏ': 'マ', 'ﾐ': 'ミ', 'ﾑ': 'ム', 'ﾒ': 'メ', 'ﾓ': 'モ',
  'ﾔ': 'ヤ', 'ﾕ': 'ユ', 'ﾖ': 'ヨ',
  'ﾗ': 'ラ', 'ﾘ': 'リ', 'ﾙ': 'ル', 'ﾚ': 'レ', 'ﾛ': 'ロ',
  'ﾜ': 'ワ', 'ﾝ': 'ン',
};

export function normalizeForLookup(input: string | null | undefined): string {
  if (input == null) return '';
  // 1) Unicode NFC（"カ"+"゛" → "ガ"、合成形に統一）
  let s = input.normalize('NFC');
  // 2) 半角カナ→全角カナ（先に行う。残った濁点/半濁点は次のNFCで合成）
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const next = s[i + 1];
    if (HANKAKU_KANA_MAP[ch]) {
      let mapped = HANKAKU_KANA_MAP[ch];
      // 濁点(ﾞ U+FF9E)/半濁点(ﾟ U+FF9F)の合成
      if (next === 'ﾞ') { mapped = mapped + '゙'; i++; }
      else if (next === 'ﾟ') { mapped = mapped + '゚'; i++; }
      out += mapped;
    } else {
      out += ch;
    }
  }
  s = out.normalize('NFC');
  // 3) ひらがな→カタカナ
  let res = '';
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (cp >= HIRA_RANGE_START && cp <= HIRA_RANGE_END) {
      res += String.fromCodePoint(cp + HIRA_TO_KATA_OFFSET);
    } else {
      res += ch;
    }
  }
  // 4) 長音類の統一（全角ハイフン/半角ハイフン/マイナス → 長音「ー」）
  res = res.replace(/[‐−－ー-]/g, 'ー');
  // 5) 半角/全角スペース除去
  res = res.replace(/[\s　]+/g, '');
  return res;
}

// SQL側は normalize_kana() 関数で同じ正規化を行う（migration 1781500000000）。
const NRM = (col: string) => `normalize_kana(${col})`;

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

    // 意図的に削除された（soft-delete）スタッフはCSV同期で復活させない。
    // fall-through して新規レコードを作成する（部分UNIQUEはdeleted_at IS NULLのみが対象のため競合しない）。
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

  // soft-deleted スタッフは名前照合でも復活させない（意図的な削除を CSV 同期が上書きしない）。

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
  // ただしNo指定がある行で、別Noが付いた同姓同名へ silent混入させない。
  // → No指定時は (procast_staff_no IS NULL OR procast_staff_no = $no) のレコードのみ許容。
  const lastResortParams = no ? [staffKana, no] : [staffKana];
  const lastResortNoGuard = no ? `AND (procast_staff_no IS NULL OR procast_staff_no = $2)` : '';
  const lastResort = await db.query(
    `SELECT id FROM staff_master
     WHERE ${NRM('display_name_kana')} = ${NRM('$1')} AND deleted_at IS NULL ${lastResortNoGuard} LIMIT 1`,
    lastResortParams
  );
  if (lastResort.rows[0]) {
    return { staffId: (lastResort.rows[0] as { id: string }).id, autoAdded: false };
  }

  throw new Error(
    `staffResolver: キャスト「${castName}」(No=${no ?? 'なし'}) を作成も照合もできませんでした。staff_masterの制約を確認してください。`
  );
}
