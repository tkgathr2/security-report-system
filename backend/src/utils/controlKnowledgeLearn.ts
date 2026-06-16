/**
 * 管制ナレッジ 学習アナライザ — pure functions（テスト対象）
 *
 * 過去の実配置履歴（projects × project_casts）から、管制ナレッジの「学び候補」を導出する。
 * DB アクセスや HTTP には依存しない純粋関数として実装し、境界条件を単体テストで担保する。
 *
 * 導出する3種：
 *  1. solo  : ある staff が「その現場に1人だけ」で配置された回数（soloCount）が閾値以上
 *             → solo_ok=true を提案（単独現場をこなした実績＝1人立ちできる蓋然性）。
 *  2. night : evening(夜番)シフトの配置がある staff（eveningCount）→ 夜勤実績として把握。
 *  3. pair  : 同一現場に同居した staff ペアの共起回数（togetherCount）が閾値以上
 *             → kind='good'（相性良好）の候補。
 *
 * ※ avoid（相性NG）は配置履歴からは推定できない（「一緒にしなかった＝NG」とは言えない）。
 *   トラブル/事故の記録が無い限り自動学習しない＝人手入力のまま（仕様）。
 */
/**
 * start_time('H:MM'/'HH:MM' text) が夜番(evening = 17:00以降)かを判定する。
 * routes/adminControlBoard.ts の deriveShift の evening 境界と同一挙動。
 * この util を pool 非依存（純粋・テスト容易）に保つためローカルに持つ
 *  ＝ adminControlBoard.ts は pool を import するので、そこからの import は避ける。
 */
function isEveningStart(startTime: string | null | undefined): boolean {
  if (startTime == null) return false;
  const m = String(startTime).trim().match(/^(\d{1,2}):(\d{2})/);
  if (!m) return false;
  const minutes = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  return minutes >= 17 * 60; // >= 17:00 → evening
}

/**
 * 2つの ID を辞書順で (小, 大) に正規化する。
 * routes/adminControlKnowledge.ts の normalizeCompatPair と同一挙動。
 * 循環 import（learn ↔ adminControlKnowledge）を避けるためローカルに持つ。
 */
function orderPair(aId: string, bId: string): { normA: string; normB: string } {
  return aId <= bId ? { normA: aId, normB: bId } : { normA: bId, normB: aId };
}

/** 集計の入力1行（1配置）。projects×project_casts を range 取得した素の形。 */
export interface PlacementInput {
  project_id: string;
  staff_id: string | null;
  /** その現場の開始時刻（text・同一 project 内は同値想定）。シフト判定に使う。 */
  start_time: string | null;
}

export interface SoloSuggestion {
  staff_id: string;
  /** 単独配置（その現場に自分1人だけ）だった現場数。 */
  solo_count: number;
  /** その staff が配置された現場の総数。 */
  total_count: number;
}

export interface NightEvidence {
  staff_id: string;
  /** evening(夜番)シフトに配置された現場数。 */
  evening_count: number;
}

export interface PairSuggestion {
  /** normalizeCompatPair で (小, 大) に正規化済み。 */
  staff_a_id: string;
  staff_b_id: string;
  /** 同一現場に同居した回数。 */
  together_count: number;
}

export interface AnalyzeOptions {
  /** solo_ok 提案の閾値（solo_count がこの値以上で提案）。既定3。 */
  soloThreshold: number;
  /** good ペア提案の閾値（together_count がこの値以上で提案）。既定3。 */
  pairThreshold: number;
}

export const DEFAULT_ANALYZE_OPTIONS: AnalyzeOptions = {
  soloThreshold: 3,
  pairThreshold: 3,
};

export interface AnalyzeResult {
  solo: SoloSuggestion[];
  night: NightEvidence[];
  pairs: PairSuggestion[];
}

/**
 * 配置履歴を集計し、学び候補を導出する。
 *
 * 同一 project 内の staff_id は重複排除（同じ人が複数行でも1人として数える）。
 * start_time は project 単位で最初に観測した非 null 値を採用する。
 */
export function analyzePlacements(
  rows: PlacementInput[],
  options: AnalyzeOptions = DEFAULT_ANALYZE_OPTIONS
): AnalyzeResult {
  // project_id → その現場の staff_id 集合 / start_time
  const byProject = new Map<string, { staff: Set<string>; startTime: string | null }>();

  for (const r of rows) {
    if (r.staff_id == null || r.staff_id === '') continue;
    let entry = byProject.get(r.project_id);
    if (!entry) {
      entry = { staff: new Set<string>(), startTime: r.start_time ?? null };
      byProject.set(r.project_id, entry);
    }
    entry.staff.add(r.staff_id);
    // start_time は projects 側の列（同一 project の全行で同値）なので、どの行を採っても等価。
    // 念のため最初に観測した非 null を採用する（将来 per-cast 時刻を join した場合の保険）。
    if (entry.startTime == null && r.start_time != null) {
      entry.startTime = r.start_time;
    }
  }

  const soloCount = new Map<string, number>();
  const totalCount = new Map<string, number>();
  const eveningCount = new Map<string, number>();
  const pairCount = new Map<string, number>(); // pairKey -> count
  const pairIds = new Map<string, { a: string; b: string }>();

  for (const { staff, startTime } of byProject.values()) {
    const members = Array.from(staff);
    if (members.length === 0) continue;

    const isEvening = isEveningStart(startTime);
    const isSolo = members.length === 1;

    for (const id of members) {
      totalCount.set(id, (totalCount.get(id) ?? 0) + 1);
      if (isSolo) soloCount.set(id, (soloCount.get(id) ?? 0) + 1);
      if (isEvening) eveningCount.set(id, (eveningCount.get(id) ?? 0) + 1);
    }

    // 同居ペア（順序非依存・正規化）
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const { normA, normB } = orderPair(members[i], members[j]);
        const key = `${normA}|${normB}`;
        pairCount.set(key, (pairCount.get(key) ?? 0) + 1);
        if (!pairIds.has(key)) pairIds.set(key, { a: normA, b: normB });
      }
    }
  }

  const solo: SoloSuggestion[] = [];
  for (const [staff_id, sc] of soloCount) {
    if (sc >= options.soloThreshold) {
      solo.push({ staff_id, solo_count: sc, total_count: totalCount.get(staff_id) ?? sc });
    }
  }
  solo.sort((a, b) => b.solo_count - a.solo_count || a.staff_id.localeCompare(b.staff_id));

  const night: NightEvidence[] = [];
  for (const [staff_id, ec] of eveningCount) {
    night.push({ staff_id, evening_count: ec });
  }
  night.sort((a, b) => b.evening_count - a.evening_count || a.staff_id.localeCompare(b.staff_id));

  const pairs: PairSuggestion[] = [];
  for (const [key, count] of pairCount) {
    if (count >= options.pairThreshold) {
      const ids = pairIds.get(key);
      if (ids) pairs.push({ staff_a_id: ids.a, staff_b_id: ids.b, together_count: count });
    }
  }
  pairs.sort(
    (a, b) =>
      b.together_count - a.together_count ||
      a.staff_a_id.localeCompare(b.staff_a_id) ||
      a.staff_b_id.localeCompare(b.staff_b_id)
  );

  return { solo, night, pairs };
}
