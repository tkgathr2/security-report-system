/**
 * スタッフ名の曖昧解決（チャットからの「中村さん」→ staff_id 解決用）— pure functions。
 *
 * 管制チャットでは管制官が「中村さん」「川面」のように略称・敬称つきで呼ぶ。
 * これを staff_master（display_name_kanji / display_name_kana）に突き合わせて候補を出す。
 * DB アクセスはしない純粋関数。境界条件を単体テストで担保する。
 */

export interface StaffNameRow {
  id: string;
  display_name_kanji: string | null;
  display_name_kana: string | null;
}

export interface NameMatch {
  id: string;
  name: string; // 表示用（kanji 優先）
}

/** 敬称（さん/くん/ちゃん/様/氏）を末尾から除去する。 */
function stripHonorific(s: string): string {
  return s.replace(/(さん|サン|くん|クン|ちゃん|チャン|様|さま|サマ|氏)$/u, '');
}

/** NFKC 正規化＋全空白除去＋敬称除去。表記揺れ（全角半角・スペース）を吸収。 */
export function normalizeName(s: string | null | undefined): string {
  if (s == null) return '';
  const base = String(s).normalize('NFKC').replace(/[\s　]/g, '');
  return stripHonorific(base);
}

/**
 * 問い合わせ名 query にマッチするスタッフ候補を返す。
 *
 * マッチ規則（正規化後）：
 *  1. 完全一致（kanji or kana）→ 最優先
 *  2. 前方一致（staff 名が query で始まる / query が staff 名で始まる）
 *  3. 部分一致（どちらかがどちらかを含む）
 * query が空、または 1 文字未満なら空配列（誤爆防止）。
 */
export function resolveStaffName(query: string, staff: StaffNameRow[]): NameMatch[] {
  const q = normalizeName(query);
  if (q.length === 0) return [];

  const exact: NameMatch[] = [];
  const prefix: NameMatch[] = [];
  const partial: NameMatch[] = [];

  for (const s of staff) {
    const kanji = normalizeName(s.display_name_kanji);
    const kana = normalizeName(s.display_name_kana);
    const display = (s.display_name_kanji && s.display_name_kanji.trim()) || (s.display_name_kana && s.display_name_kana.trim()) || s.id;
    const m: NameMatch = { id: s.id, name: display };

    if ((kanji && kanji === q) || (kana && kana === q)) {
      exact.push(m);
    } else if (
      (kanji && (kanji.startsWith(q) || q.startsWith(kanji))) ||
      (kana && (kana.startsWith(q) || q.startsWith(kana)))
    ) {
      prefix.push(m);
    } else if (
      (kanji && (kanji.includes(q) || q.includes(kanji))) ||
      (kana && (kana.includes(q) || q.includes(kana)))
    ) {
      partial.push(m);
    }
  }

  // 重複 id を除去しつつ exact→prefix→partial の優先順で。
  const seen = new Set<string>();
  const out: NameMatch[] = [];
  for (const m of [...exact, ...prefix, ...partial]) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    out.push(m);
  }
  return out;
}
