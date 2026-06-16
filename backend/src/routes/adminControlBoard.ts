import { Router, Request, Response } from 'express';
import pool from '../db/pool';
import { requireAdmin } from '../middleware/auth';
import { handleDbError, sendBadRequest } from '../utils/errorHandler';

const router = Router();

export type Shift = 'morning' | 'mid' | 'evening';

// ----- pure functions (テスト対象) -----

/**
 * start_time('H:MM' / 'HH:MM' text) からシフト区分を導出する。
 *  <= 09:00 → morning(朝番)
 *  <  17:00 → mid(中番)
 *  それ以外  → evening(夜番)
 *  null/空/不正 → mid(中番)
 *
 * ※ start_time は text 型でゼロ埋め保証が無い（CSV取込が生値をtrimするのみ）。
 *   '9:00' のような1桁時刻でも正しく判定するため、辞書順比較ではなく
 *   分換算の数値比較を行う（'9:00' を辞書順で見ると evening に誤判定するため）。
 */
export function deriveShift(startTime: string | null | undefined): Shift {
  if (startTime == null) return 'mid';
  const m = String(startTime).trim().match(/^(\d{1,2}):(\d{2})/);
  if (!m) return 'mid';
  const minutes = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  if (minutes <= 9 * 60) return 'morning'; // <= 09:00
  if (minutes < 17 * 60) return 'mid'; // < 17:00
  return 'evening';
}

/** 文字列を正規化（NFKC＋全空白除去）。表記揺れ(全角半角/㈱⇄(株)/空白)を吸収しキーの衝突・分割を防ぐ。 */
function normalizeForKey(s: string | null | undefined): string {
  return (s ?? '').normalize('NFKC').replace(/[\s　]/g, '');
}

/** すべて空の現場を受ける番兵キー（盤面から落とさず「(現場未設定)」列に集約）。 */
export const UNSET_SITE_KEY = '__unset__';

/**
 * 現場を一意に識別するキーを生成する（盤面の「列」の同定に使う）。
 * 取引先名(clients.name)・所在地(location)・作業名(work_name)の複合＋正規化。
 *  - 同一取引先の別現場(所在地/作業違い)を別キーにする（取引先名だけだと衝突して片方が盤面から消えるため）。
 *  - 表記揺れ(全角半角/異体字/空白)は正規化で同一キーに寄せる（同一現場が別列に割れるのを防ぐ）。
 *  - すべて空なら UNSET_SITE_KEY を返し、「(現場未設定)」列で受ける（silent drop しない）。
 * ※ projects.client_name_raw は migration 1771200000000 で削除済みのため clients.name を使う。
 */
export function deriveSiteKey(
  clientName: string | null | undefined,
  location: string | null | undefined,
  workName?: string | null | undefined
): string {
  const key = [normalizeForKey(clientName), normalizeForKey(location), normalizeForKey(workName)].join('|');
  return key === '||' ? UNSET_SITE_KEY : key;
}

/** 列の表示ラベル。作業名→取引先名→所在地→「(現場未設定)」の順で人が読める名前を選ぶ。 */
export function deriveSiteLabel(
  clientName: string | null | undefined,
  location: string | null | undefined,
  workName?: string | null | undefined
): string {
  const w = (workName ?? '').trim();
  const c = (clientName ?? '').trim();
  const l = (location ?? '').trim();
  return w || c || l || '(現場未設定)';
}

export interface StaffPlacement {
  staffId: string | null;
  name: string;
  siteKey: string;
  siteLabel: string;
  shift: Shift;
}

export interface WarningEntry {
  staff_id: string;
  name: string;
  prev: string;
  curr: string;
  site: string;
}

/**
 * 連続勤務警告を導出する pure 関数。
 * 当日(curr)の朝番に居るキャストが、前日(prev)の夜番にも配置されていれば警告。
 * staff_id が null のキャストは突き合わせできないため対象外。
 *
 * @param currMorning 当日の朝番配置（site 単位で重複しうる）
 * @param prevEvening 前日の夜番配置
 * @param currLabel   当日の表示ラベル（例 '6/16朝'）
 * @param prevLabel   前日の表示ラベル（例 '6/15夜'）
 * @returns warning エントリと、警告対象の staffId 集合（cell の over フラグ用）
 */
export function computeWarnings(
  currMorning: StaffPlacement[],
  prevEvening: StaffPlacement[],
  currLabel: string,
  prevLabel: string
): { warnings: WarningEntry[]; warnStaffIds: Set<string> } {
  const prevEveningIds = new Set(
    prevEvening.filter((p) => p.staffId != null).map((p) => p.staffId as string)
  );

  const warnings: WarningEntry[] = [];
  const warnStaffIds = new Set<string>();
  const seen = new Set<string>();

  for (const m of currMorning) {
    if (m.staffId == null) continue;
    if (!prevEveningIds.has(m.staffId)) continue;
    if (seen.has(m.staffId)) continue;
    seen.add(m.staffId);
    warnStaffIds.add(m.staffId);
    warnings.push({
      staff_id: m.staffId,
      name: m.name,
      prev: prevLabel,
      curr: currLabel,
      site: m.siteLabel,
    });
  }

  return { warnings, warnStaffIds };
}

// ----- 管制ナレッジ（制約・相性）の違反検出 -----

/** 2人のstaff_idを順序非依存のペアキーにする（相性ペアの突き合わせ用）。 */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export interface ViolationCast {
  staff_id: string | null;
  name: string;
  warn: string[];
}
export interface ViolationCell {
  site_key: string;
  site_label: string;
  shift: Shift;
  casts: ViolationCast[];
}
export interface Violation {
  site_key: string;
  site_label: string;
  kind: 'solo' | 'night' | 'compat';
  message: string;
  names: string[];
}

/**
 * 管制ナレッジ（暗黙知）に基づく配置違反を検出する pure 関数。各 cast の warn[] に警告ラベルを付け、
 * 違反サマリ（Violation[]）を返す。
 *  - solo : solo_ok=false のキャストが、その現場(cell)で1人だけ＝単独配置 → 「1人立ち未承認」
 *  - night: night_ok=false のキャストが夜番(evening)に居る → 「夜勤NG」
 *  - compat: avoid ペアが同一現場(site_key・シフト跨ぎ)に同居 → 両者に「相性NG」
 * staff_id が null（マスタ未解決）のキャストは突き合わせ不可のため対象外。
 */
export function computeViolations(
  cells: ViolationCell[],
  constraints: Map<string, { solo_ok: boolean; night_ok: boolean }>,
  avoidPairs: Set<string>
): Violation[] {
  const violations: Violation[] = [];
  const add = (c: ViolationCast, label: string) => {
    if (!c.warn.includes(label)) c.warn.push(label);
  };

  // solo / night（cell 単位）
  for (const cell of cells) {
    for (const c of cell.casts) {
      if (c.staff_id == null) continue;
      const cons = constraints.get(c.staff_id);
      if (!cons) continue;
      if (cell.casts.length === 1 && !cons.solo_ok) {
        add(c, '1人立ち未承認');
        violations.push({
          site_key: cell.site_key,
          site_label: cell.site_label,
          kind: 'solo',
          message: `${c.name}：1人立ち未承認の単独配置`,
          names: [c.name],
        });
      }
      if (cell.shift === 'evening' && !cons.night_ok) {
        add(c, '夜勤NG');
        violations.push({
          site_key: cell.site_key,
          site_label: cell.site_label,
          kind: 'night',
          message: `${c.name}：夜勤NG（夜番に配置）`,
          names: [c.name],
        });
      }
    }
  }

  // compat（同一現場 site_key にまとめ、avoid ペアの同居を検出）
  const bySite = new Map<string, { label: string; casts: ViolationCast[] }>();
  for (const cell of cells) {
    const e = bySite.get(cell.site_key) ?? { label: cell.site_label, casts: [] };
    for (const c of cell.casts) if (c.staff_id != null) e.casts.push(c);
    bySite.set(cell.site_key, e);
  }
  for (const [site_key, { label, casts }] of bySite) {
    const seenPair = new Set<string>();
    for (let i = 0; i < casts.length; i++) {
      for (let j = i + 1; j < casts.length; j++) {
        const a = casts[i].staff_id as string;
        const b = casts[j].staff_id as string;
        if (a === b) continue;
        const pk = pairKey(a, b);
        if (!avoidPairs.has(pk) || seenPair.has(pk)) continue;
        seenPair.add(pk);
        add(casts[i], '相性NG');
        add(casts[j], '相性NG');
        violations.push({
          site_key,
          site_label: label,
          kind: 'compat',
          message: `${casts[i].name}×${casts[j].name}：相性NG（同現場回避）`,
          names: [casts[i].name, casts[j].name],
        });
      }
    }
  }

  return violations;
}

// ----- ヘルパ -----

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** YYYY-MM-DD の前日を返す（TZ非依存・UTC基準）。 */
function prevDateStr(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** 'M/D' 形式の短い日付ラベル（warning/handover 用）。 */
function shortDate(dateStr: string): string {
  const [, m, d] = dateStr.split('-');
  return `${parseInt(m, 10)}/${parseInt(d, 10)}`;
}

interface ProjectRow {
  project_id: string;
  client_name: string | null;
  work_name: string | null;
  location: string | null;
  start_time: string | null;
}

interface CastRow {
  project_id: string;
  staff_id: string | null;
  display_name_kanji: string | null;
  staff_no: string | null;
}

function displayName(c: CastRow): string {
  if (c.display_name_kanji && c.display_name_kanji.trim() !== '') return c.display_name_kanji;
  return `No.${c.staff_no ?? ''}`;
}

// その日の projects と project_casts を取得する。
// ※ projects.client_name_raw / project_casts.cast_name は migration 1771200000000 で削除済み。
//   現場名は clients.name（client_id JOIN）、キャスト表示名は staff_master.display_name_kanji を使う。
const PROJECTS_SQL = `
  SELECT p.id AS project_id,
         c.name AS client_name,
         p.work_name,
         p.location,
         p.start_time
  FROM projects p
  LEFT JOIN clients c ON p.client_id = c.id
  WHERE p.work_date = $1
    AND p.deleted_at IS NULL
    AND p.status IS DISTINCT FROM 'cancelled'
    AND p.cancelled_at IS NULL
  ORDER BY p.start_time NULLS LAST, p.created_at ASC`;

const CASTS_SQL = `
  SELECT pc.project_id,
         pc.staff_id,
         pc.staff_no,
         sm.display_name_kanji
  FROM project_casts pc
  INNER JOIN projects p ON p.id = pc.project_id
  LEFT JOIN staff_master sm ON pc.staff_id = sm.id
  WHERE p.work_date = $1
    AND p.deleted_at IS NULL
    AND p.status IS DISTINCT FROM 'cancelled'
    AND p.cancelled_at IS NULL
    AND pc.deleted_at IS NULL
  ORDER BY pc.row_index ASC NULLS LAST, pc.id ASC`;

/** ある日の配置を StaffPlacement[] に展開する（warning 計算用の素材）。 */
function buildPlacements(projects: ProjectRow[], casts: CastRow[]): StaffPlacement[] {
  const projById = new Map(projects.map((p) => [p.project_id, p]));
  const out: StaffPlacement[] = [];
  for (const c of casts) {
    const proj = projById.get(c.project_id);
    if (!proj) continue;
    const siteKey = deriveSiteKey(proj.client_name, proj.location, proj.work_name);
    const siteLabel = deriveSiteLabel(proj.client_name, proj.location, proj.work_name);
    out.push({
      staffId: c.staff_id,
      name: displayName(c),
      siteKey,
      siteLabel,
      shift: deriveShift(proj.start_time),
    });
  }
  return out;
}

router.get('/', requireAdmin, async (req: Request, res: Response) => {
  try {
    const date = req.query.date;
    if (typeof date !== 'string' || !DATE_RE.test(date)) {
      sendBadRequest(res, 'date は YYYY-MM-DD 形式で指定してください');
      return;
    }
    const prevDate = prevDateStr(date);

    const [projRes, castRes, prevProjRes, prevCastRes, staffRes, compatRes, activityRes] = await Promise.all([
      pool.query(PROJECTS_SQL, [date]),
      pool.query(CASTS_SQL, [date]),
      pool.query(PROJECTS_SQL, [prevDate]),
      pool.query(CASTS_SQL, [prevDate]),
      pool.query(
        `SELECT id, display_name_kanji, solo_ok, night_ok, hidden FROM staff_master WHERE deleted_at IS NULL ORDER BY display_name_kana ASC NULLS LAST`
      ),
      pool.query(
        `SELECT staff_a_id, staff_b_id FROM staff_compatibility WHERE kind = 'avoid' AND deleted_at IS NULL`
      ),
      // 未配置スタッフの並べ替え用：各スタッフの最終出勤日と出勤回数（履歴）。
      pool.query(
        `SELECT pc.staff_id, MAX(p.work_date) AS last_seen, COUNT(*)::int AS appear_count
         FROM project_casts pc
         INNER JOIN projects p ON p.id = pc.project_id
         WHERE pc.staff_id IS NOT NULL AND pc.deleted_at IS NULL
           AND p.deleted_at IS NULL AND p.status IS DISTINCT FROM 'cancelled' AND p.cancelled_at IS NULL
         GROUP BY pc.staff_id`
      ),
    ]);

    // 非表示スタッフ（高木など配置対象でない人）：盤面・警告・引継ぎ・未配置から除外する。
    const hiddenSet = new Set(
      (staffRes.rows as Array<{ id: string; hidden?: boolean }>).filter((s) => s.hidden).map((s) => s.id)
    );
    const notHidden = (c: CastRow) => c.staff_id == null || !hiddenSet.has(c.staff_id);

    const projects = projRes.rows as ProjectRow[];
    const casts = (castRes.rows as CastRow[]).filter(notHidden);
    const prevProjects = prevProjRes.rows as ProjectRow[];
    const prevCasts = (prevCastRes.rows as CastRow[]).filter(notHidden);

    // sites: その日の現場(列)。重複排除。
    const siteMap = new Map<string, { key: string; label: string; meta: string }>();
    for (const p of projects) {
      const key = deriveSiteKey(p.client_name, p.location, p.work_name);
      if (siteMap.has(key)) continue;
      const label = deriveSiteLabel(p.client_name, p.location, p.work_name);
      const meta = (p.location ?? '').trim() || (p.client_name ?? '').trim();
      siteMap.set(key, { key, label, meta });
    }
    const sites = Array.from(siteMap.values()).map((s) => ({ key: s.key, label: s.label, meta: s.meta }));

    // placements（当日・前日）
    const currPlacements = buildPlacements(projects, casts);
    const prevPlacements = buildPlacements(prevProjects, prevCasts);

    const currLabel = `${shortDate(date)}朝`;
    const prevLabel = `${shortDate(prevDate)}夜`;
    const currMorning = currPlacements.filter((p) => p.shift === 'morning');
    const prevEvening = prevPlacements.filter((p) => p.shift === 'evening');

    const { warnings, warnStaffIds } = computeWarnings(currMorning, prevEvening, currLabel, prevLabel);

    // cells: project 単位 × shift で casts をまとめる。
    const castsByProject = new Map<string, CastRow[]>();
    for (const c of casts) {
      const arr = castsByProject.get(c.project_id);
      if (arr) arr.push(c);
      else castsByProject.set(c.project_id, [c]);
    }

    const cells = projects.map((p) => {
      const siteKey = deriveSiteKey(p.client_name, p.location, p.work_name);
      const shift = deriveShift(p.start_time);
      const rows = castsByProject.get(p.project_id) ?? [];
      const seenForHandoff = new Set<string>();
      const castsOut = rows.map((c) => {
        const over = c.staff_id != null && warnStaffIds.has(c.staff_id);
        // handoff: 夜番セルの在席キャスト（翌朝へ引き継ぐ可能性）に立てる。
        const handoff = shift === 'evening' && c.staff_id != null && !seenForHandoff.has(c.staff_id);
        if (handoff && c.staff_id != null) seenForHandoff.add(c.staff_id);
        return {
          staff_id: c.staff_id,
          name: displayName(c),
          over,
          handoff,
          warn: [] as string[],
        };
      });
      return {
        project_id: p.project_id,
        site_key: siteKey,
        shift,
        casts: castsOut,
      };
    });

    // 管制ナレッジ違反の検出（各 cast の warn[] に付与し、違反サマリを作る）
    const constraintMap = new Map(
      (staffRes.rows as Array<{ id: string; solo_ok: boolean; night_ok: boolean }>).map((s) => [
        s.id,
        { solo_ok: s.solo_ok, night_ok: s.night_ok },
      ])
    );
    const avoidPairs = new Set(
      (compatRes.rows as Array<{ staff_a_id: string; staff_b_id: string }>).map((r) =>
        pairKey(r.staff_a_id, r.staff_b_id)
      )
    );
    const violCells: ViolationCell[] = cells.map((c) => ({
      site_key: c.site_key,
      site_label: siteMap.get(c.site_key)?.label ?? c.site_key,
      shift: c.shift,
      casts: c.casts,
    }));
    const violations = computeViolations(violCells, constraintMap, avoidPairs);

    // pool: その日どの案件にも配置されていない staff_master（deleted_at IS NULL）
    const assignedStaffIds = new Set(
      casts.filter((c) => c.staff_id != null).map((c) => c.staff_id as string)
    );
    // 各スタッフの活動履歴（最終出勤日・出勤回数）。未配置の並べ替えに使う。
    const activityMap = new Map(
      (activityRes.rows as Array<{ staff_id: string; last_seen: string | Date | null; appear_count: number }>)
        .map((r) => [r.staff_id, { last_seen: r.last_seen ? String(r.last_seen).slice(0, 10) : null, appear_count: r.appear_count }])
    );
    const allStaff = staffRes.rows as Array<{ id: string; display_name_kanji: string | null; hidden?: boolean }>;

    // pool: その日未配置 かつ 非表示でない staff_master。
    // 並び＝最終出勤日が新しい順（履歴で来ている人を上へ）→ 未経験(null)は下へ → 出勤回数の多い順 → 名前。
    const poolOut = allStaff
      .filter((s) => !assignedStaffIds.has(s.id) && !s.hidden)
      .map((s) => {
        const a = activityMap.get(s.id);
        return { staff_id: s.id, name: s.display_name_kanji ?? '', last_seen: a?.last_seen ?? null, appear_count: a?.appear_count ?? 0 };
      })
      .sort((x, y) => {
        const lx = x.last_seen ?? '';
        const ly = y.last_seen ?? '';
        if (lx !== ly) return ly < lx ? -1 : 1; // 日付降順（新しいほど上・null は最下）
        if (x.appear_count !== y.appear_count) return y.appear_count - x.appear_count;
        return x.name.localeCompare(y.name);
      });

    // 非表示中スタッフ（UI で「戻す」ために返す）。
    const hiddenStaff = allStaff
      .filter((s) => s.hidden)
      .map((s) => ({ staff_id: s.id, name: s.display_name_kanji ?? '' }));

    // handover: 前日夜番の配置者を names に列挙
    const handoverNames: string[] = [];
    const seenHandover = new Set<string>();
    for (const p of prevEvening) {
      if (p.name === '') continue;
      // 同一人物の重複排除は staff_id 基準（同姓同名の別人を name で潰さない）。
      // staff_id が null のキャストは突き合わせ不可のため name 基準にフォールバック。
      const dedupKey = p.staffId != null ? `id:${p.staffId}` : `name:${p.name}`;
      if (seenHandover.has(dedupKey)) continue;
      seenHandover.add(dedupKey);
      handoverNames.push(p.name);
    }
    const handover = handoverNames.length > 0
      ? [{ shift_from: 'evening', date: prevDate, names: handoverNames, note: '翌朝と連続注意' }]
      : [];

    const assignedCount = assignedStaffIds.size;

    res.json({
      date,
      sites,
      cells,
      pool: poolOut,
      hidden_staff: hiddenStaff,
      warnings,
      handover,
      violations,
      kpi: {
        sites: sites.length,
        assigned: assignedCount,
        pool: poolOut.length,
        warnings: warnings.length,
        violations: violations.length,
      },
    });
  } catch (error) {
    handleDbError(res, error, 'Control board');
  }
});

export default router;
