/**
 * 管制ナレッジ API — 仕様書 v1.0
 *
 * PUT /api/admin/control-knowledge/staff/:id/constraints
 *   スタッフの管制制約（solo_ok / night_ok / control_note）を更新する
 *
 * GET /api/admin/control-knowledge/compat
 *   相性ペア一覧を返す（staff_master を2回 JOIN して名前付与）
 *
 * POST /api/admin/control-knowledge/compat
 *   相性ペアを追加する（(LEAST,GREATEST) で順序正規化して格納）
 *
 * DELETE /api/admin/control-knowledge/compat/:id
 *   相性ペアを論理削除する
 */
import { Router, Request, Response } from 'express';
import pool from '../db/pool';
import { requireAdmin } from '../middleware/auth';
import { logAudit } from '../utils/auditLog';
import { handleDbError, sendBadRequest, sendConflict, sendNotFound } from '../utils/errorHandler';
import { validateStringField, MAX_LENGTHS } from '../utils/validation';
import { analyzePlacements, PlacementInput } from '../utils/controlKnowledgeLearn';

const router = Router();

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_KINDS = ['avoid', 'good'] as const;
const CONTROL_NOTE_MAX_LENGTH = 1000;

// ── ペア正規化（pure function・テスト対象） ────────────────────────────────
/**
 * 2つの UUID を辞書順で (smaller, larger) に正規化する。
 * LEAST/GREATEST と同じ挙動。INSERT 前に呼んで一意制約を効かせる。
 */
export function normalizeCompatPair(
  aId: string,
  bId: string
): { normA: string; normB: string } {
  if (aId <= bId) {
    return { normA: aId, normB: bId };
  }
  return { normA: bId, normB: aId };
}

// ── PUT /staff/:id/constraints ────────────────────────────────────────────
router.put('/staff/:id/constraints', requireAdmin, async (req: Request, res: Response) => {
  const staffId = req.params.id as string;

  if (!staffId || !UUID_REGEX.test(staffId)) {
    sendBadRequest(res, 'スタッフIDの形式が不正です');
    return;
  }

  const { solo_ok, night_ok, control_note: controlNoteRaw } = req.body as {
    solo_ok: unknown;
    night_ok: unknown;
    control_note: unknown;
  };

  if (typeof solo_ok !== 'boolean') {
    sendBadRequest(res, 'solo_ok は boolean で指定してください');
    return;
  }
  if (typeof night_ok !== 'boolean') {
    sendBadRequest(res, 'night_ok は boolean で指定してください');
    return;
  }

  const controlNote: string | null =
    controlNoteRaw === null || controlNoteRaw === undefined
      ? null
      : typeof controlNoteRaw === 'string'
        ? controlNoteRaw.trim() || null
        : null;

  if (controlNote !== null) {
    const noteErr = validateStringField(controlNote, '管制メモ', CONTROL_NOTE_MAX_LENGTH);
    if (noteErr) {
      sendBadRequest(res, noteErr);
      return;
    }
  }

  try {
    const result = await pool.query(
      `UPDATE staff_master
       SET solo_ok = $1, night_ok = $2, control_note = $3, updated_at = NOW()
       WHERE id = $4 AND deleted_at IS NULL
       RETURNING id, solo_ok, night_ok, control_note`,
      [solo_ok, night_ok, controlNote, staffId]
    );

    if (result.rows.length === 0) {
      sendNotFound(res, 'スタッフが見つかりません');
      return;
    }

    const adminUser = req.user as { email: string };
    logAudit({
      req,
      actorEmail: adminUser.email,
      action: 'UPDATE_STAFF_CONSTRAINTS',
      targetType: 'staff_master',
      targetId: staffId,
      payload: {
        solo_ok,
        night_ok,
        control_note_len: controlNote?.length ?? 0,
        control_note_present: controlNote !== null,
      },
    });

    res.json({ staff: result.rows[0] });
  } catch (error) {
    handleDbError(res, error, 'Update staff constraints');
  }
});

// ── GET /compat ────────────────────────────────────────────────────────────
router.get('/compat', requireAdmin, async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT sc.id, sc.staff_a_id, sa.display_name_kanji AS staff_a_name,
              sc.staff_b_id, sb.display_name_kanji AS staff_b_name,
              sc.kind, sc.note
       FROM staff_compatibility sc
       JOIN staff_master sa ON sc.staff_a_id = sa.id
       JOIN staff_master sb ON sc.staff_b_id = sb.id
       WHERE sc.deleted_at IS NULL
       ORDER BY sc.created_at DESC`
    );

    res.json({ pairs: result.rows });
  } catch (error) {
    handleDbError(res, error, 'Compat list');
  }
});

// ── POST /compat ───────────────────────────────────────────────────────────
router.post('/compat', requireAdmin, async (req: Request, res: Response) => {
  const { staff_a_id, staff_b_id, kind, note: noteRaw } = req.body as {
    staff_a_id: unknown;
    staff_b_id: unknown;
    kind: unknown;
    note: unknown;
  };

  if (typeof staff_a_id !== 'string' || !UUID_REGEX.test(staff_a_id)) {
    sendBadRequest(res, 'staff_a_id の形式が不正です');
    return;
  }
  if (typeof staff_b_id !== 'string' || !UUID_REGEX.test(staff_b_id)) {
    sendBadRequest(res, 'staff_b_id の形式が不正です');
    return;
  }
  if (staff_a_id.toLowerCase() === staff_b_id.toLowerCase()) {
    sendBadRequest(res, '同じスタッフ同士のペアは登録できません');
    return;
  }
  if (typeof kind !== 'string' || !(VALID_KINDS as readonly string[]).includes(kind)) {
    sendBadRequest(res, `kind は ${VALID_KINDS.join(' または ')} で指定してください`);
    return;
  }

  const note: string | null =
    noteRaw === null || noteRaw === undefined
      ? null
      : typeof noteRaw === 'string'
        ? noteRaw.trim() || null
        : null;

  if (note !== null) {
    const noteErr = validateStringField(note, 'メモ', CONTROL_NOTE_MAX_LENGTH);
    if (noteErr) {
      sendBadRequest(res, noteErr);
      return;
    }
  }

  // 両スタッフの存在確認
  try {
    const staffCheck = await pool.query(
      `SELECT id FROM staff_master WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL`,
      [[staff_a_id, staff_b_id]]
    );
    if (staffCheck.rows.length < 2) {
      sendNotFound(res, '指定されたスタッフが存在しません');
      return;
    }
  } catch (error) {
    handleDbError(res, error, 'Compat staff check');
    return;
  }

  // (LEAST, GREATEST) 相当の正規化
  const { normA, normB } = normalizeCompatPair(staff_a_id, staff_b_id);

  const adminUser = req.user as { email: string };

  try {
    // 既存ペア+kind の重複チェック
    const dupCheck = await pool.query(
      `SELECT id FROM staff_compatibility
       WHERE staff_a_id = $1 AND staff_b_id = $2 AND kind = $3 AND deleted_at IS NULL`,
      [normA, normB, kind]
    );
    if (dupCheck.rows.length > 0) {
      sendConflict(res, '同じペアと種別の組み合わせが既に登録されています');
      return;
    }

    const result = await pool.query(
      `INSERT INTO staff_compatibility (staff_a_id, staff_b_id, kind, note, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, staff_a_id, staff_b_id, kind, note, created_by, created_at`,
      [normA, normB, kind, note, adminUser.email]
    );

    logAudit({
      req,
      actorEmail: adminUser.email,
      action: 'CREATE_COMPAT',
      targetType: 'staff_compatibility',
      targetId: result.rows[0].id as string,
      payload: {
        staff_a_id: normA,
        staff_b_id: normB,
        kind,
        note_len: note?.length ?? 0,
        note_present: note !== null,
      },
    });

    res.status(201).json({ pair: result.rows[0] });
  } catch (error) {
    const pgError = error as { code?: string };
    if (pgError.code === '23505') {
      sendConflict(res, '同じペアと種別の組み合わせが既に登録されています');
      return;
    }
    handleDbError(res, error, 'Create compat');
  }
});

// ── DELETE /compat/:id ────────────────────────────────────────────────────
router.delete('/compat/:id', requireAdmin, async (req: Request, res: Response) => {
  const compatId = req.params.id as string;

  if (!compatId || !UUID_REGEX.test(compatId)) {
    sendBadRequest(res, 'IDの形式が不正です');
    return;
  }

  try {
    const result = await pool.query(
      `UPDATE staff_compatibility
       SET deleted_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND deleted_at IS NULL
       RETURNING id`,
      [compatId]
    );

    if (result.rows.length === 0) {
      sendNotFound(res, '相性ペアが見つかりません');
      return;
    }

    const adminUser = req.user as { email: string };
    logAudit({
      req,
      actorEmail: adminUser.email,
      action: 'DELETE_COMPAT',
      targetType: 'staff_compatibility',
      targetId: compatId,
      payload: {},
    });

    res.json({ ok: true });
  } catch (error) {
    handleDbError(res, error, 'Delete compat');
  }
});

// ── 学習アナライザ（過去配置データから学ぶ） ──────────────────────────────
const LEARN_DEFAULT_DAYS = 30;
const LEARN_MAX_DAYS = 365;

// 共通の絞り込み（有効な配置・名寄せ済みのみ）。
const LEARN_PLACEMENTS_FILTER = `
    AND p.work_date <= CURRENT_DATE
    AND p.deleted_at IS NULL
    AND p.status IS DISTINCT FROM 'cancelled'
    AND p.cancelled_at IS NULL
    AND pc.deleted_at IS NULL
    AND pc.staff_id IS NOT NULL`;

// 直近 N 日の配置履歴（projects × project_casts）。
const LEARN_PLACEMENTS_SQL = `
  SELECT pc.project_id, pc.staff_id, p.start_time
  FROM project_casts pc
  INNER JOIN projects p ON p.id = pc.project_id
  WHERE p.work_date >= (CURRENT_DATE - (($1::int - 1) || ' days')::interval)
  ${LEARN_PLACEMENTS_FILTER}`;

// 全期間の配置履歴（下限なし）。days=all のとき使う。
const LEARN_PLACEMENTS_ALL_SQL = `
  SELECT pc.project_id, pc.staff_id, p.start_time
  FROM project_casts pc
  INNER JOIN projects p ON p.id = pc.project_id
  WHERE 1 = 1
  ${LEARN_PLACEMENTS_FILTER}`;

// ── GET /learn/suggestions?days=30|all ─────────────────────────────────────
// 過去データを集計して「学び候補」を返す（読み取り専用・適用しない）。
// days=all で全期間（過去の全日程）を対象にする。
router.get('/learn/suggestions', requireAdmin, async (req: Request, res: Response) => {
  let days: number | null = LEARN_DEFAULT_DAYS; // null = 全期間
  if (req.query.days !== undefined) {
    if (req.query.days === 'all') {
      days = null;
    } else {
      const parsed = Number(req.query.days);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > LEARN_MAX_DAYS) {
        sendBadRequest(res, `days は 1〜${LEARN_MAX_DAYS} の整数、または all を指定してください`);
        return;
      }
      days = parsed;
    }
  }

  try {
    const placeRes =
      days === null
        ? await pool.query(LEARN_PLACEMENTS_ALL_SQL)
        : await pool.query(LEARN_PLACEMENTS_SQL, [days]);
    const result = analyzePlacements(placeRes.rows as PlacementInput[]);

    // 関与する staff_id の名前・現在状態を引く
    const staffIds = new Set<string>();
    for (const s of result.solo) staffIds.add(s.staff_id);
    for (const n of result.night) staffIds.add(n.staff_id);
    for (const p of result.pairs) {
      staffIds.add(p.staff_a_id);
      staffIds.add(p.staff_b_id);
    }

    const staffMap = new Map<
      string,
      { name: string | null; solo_ok: boolean; night_ok: boolean }
    >();
    if (staffIds.size > 0) {
      const staffRes = await pool.query(
        `SELECT id, display_name_kanji, solo_ok, night_ok
         FROM staff_master WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL`,
        [Array.from(staffIds)]
      );
      for (const r of staffRes.rows as Array<{
        id: string;
        display_name_kanji: string | null;
        solo_ok: boolean;
        night_ok: boolean;
      }>) {
        staffMap.set(r.id, {
          name: r.display_name_kanji,
          solo_ok: r.solo_ok,
          night_ok: r.night_ok,
        });
      }
    }

    // 既存の good ペア（重複提案を避ける）
    const existingGood = new Set<string>();
    const goodRes = await pool.query(
      `SELECT staff_a_id, staff_b_id FROM staff_compatibility
       WHERE kind = 'good' AND deleted_at IS NULL`
    );
    for (const r of goodRes.rows as Array<{ staff_a_id: string; staff_b_id: string }>) {
      existingGood.add(`${r.staff_a_id}|${r.staff_b_id}`);
    }

    // solo: 現在 solo_ok=false の人だけが「適用すると効く」候補。staff_master に居る人に限る。
    const soloOut = result.solo
      .filter((s) => staffMap.has(s.staff_id) && staffMap.get(s.staff_id)!.solo_ok === false)
      .map((s) => ({
        staff_id: s.staff_id,
        name: staffMap.get(s.staff_id)!.name,
        solo_count: s.solo_count,
        total_count: s.total_count,
        already: false,
      }));

    // night: 夜勤実績があるのに現在 night_ok=false の人（＝夜勤NG警告と実績が矛盾）を提案。
    const nightOut = result.night
      .filter((n) => staffMap.has(n.staff_id) && staffMap.get(n.staff_id)!.night_ok === false)
      .map((n) => ({
        staff_id: n.staff_id,
        name: staffMap.get(n.staff_id)!.name,
        evening_count: n.evening_count,
        already: false,
      }));

    // pairs: 既存 good ペアを除外。両者が staff_master に居るもののみ。
    const pairOut = result.pairs
      .filter(
        (p) =>
          staffMap.has(p.staff_a_id) &&
          staffMap.has(p.staff_b_id) &&
          !existingGood.has(`${p.staff_a_id}|${p.staff_b_id}`)
      )
      .map((p) => ({
        staff_a_id: p.staff_a_id,
        staff_a_name: staffMap.get(p.staff_a_id)!.name,
        staff_b_id: p.staff_b_id,
        staff_b_name: staffMap.get(p.staff_b_id)!.name,
        together_count: p.together_count,
      }));

    res.json({
      days,
      period_label: days === null ? '全期間' : `直近${days}日`,
      counts: { solo: soloOut.length, night: nightOut.length, pairs: pairOut.length },
      suggestions: { solo: soloOut, night: nightOut, pairs: pairOut },
    });
  } catch (error) {
    handleDbError(res, error, 'Learn suggestions');
  }
});

// ── POST /learn/apply ──────────────────────────────────────────────────────
// 選択された学び候補を実際に管制ナレッジへ反映する（冪等）。
router.post('/learn/apply', requireAdmin, async (req: Request, res: Response) => {
  const body = req.body as {
    solo_ok_staff_ids?: unknown;
    night_ok_staff_ids?: unknown;
    good_pairs?: unknown;
  };

  const soloIds = Array.isArray(body.solo_ok_staff_ids) ? body.solo_ok_staff_ids : [];
  const nightIds = Array.isArray(body.night_ok_staff_ids) ? body.night_ok_staff_ids : [];
  const goodPairs = Array.isArray(body.good_pairs) ? body.good_pairs : [];

  // バリデーション（UUID 形式・件数上限）
  const MAX_ITEMS = 500;
  if (soloIds.length > MAX_ITEMS || nightIds.length > MAX_ITEMS || goodPairs.length > MAX_ITEMS) {
    sendBadRequest(res, `一度に適用できるのは各${MAX_ITEMS}件までです`);
    return;
  }
  for (const id of [...soloIds, ...nightIds]) {
    if (typeof id !== 'string' || !UUID_REGEX.test(id)) {
      sendBadRequest(res, 'staff_id の形式が不正です');
      return;
    }
  }
  const normalizedPairs: Array<{ a: string; b: string }> = [];
  for (const raw of goodPairs) {
    const p = raw as { staff_a_id?: unknown; staff_b_id?: unknown };
    if (
      typeof p.staff_a_id !== 'string' ||
      !UUID_REGEX.test(p.staff_a_id) ||
      typeof p.staff_b_id !== 'string' ||
      !UUID_REGEX.test(p.staff_b_id)
    ) {
      sendBadRequest(res, 'good_pairs の staff_id 形式が不正です');
      return;
    }
    if (p.staff_a_id.toLowerCase() === p.staff_b_id.toLowerCase()) {
      sendBadRequest(res, '同じスタッフ同士のペアは登録できません');
      return;
    }
    const { normA, normB } = normalizeCompatPair(p.staff_a_id, p.staff_b_id);
    normalizedPairs.push({ a: normA, b: normB });
  }

  const adminUser = req.user as { email: string };
  const applied = { solo_ok: 0, night_ok: 0, good_pairs: 0 };

  try {
    // solo_ok=true を冪等に適用（既に true の人・存在しない人は対象外）
    for (const id of soloIds as string[]) {
      const r = await pool.query(
        `UPDATE staff_master SET solo_ok = true, updated_at = NOW()
         WHERE id = $1 AND solo_ok = false AND deleted_at IS NULL
         RETURNING id`,
        [id]
      );
      if (r.rows.length > 0) {
        applied.solo_ok += 1;
        logAudit({
          req,
          actorEmail: adminUser.email,
          action: 'LEARN_SOLO_OK',
          targetType: 'staff_master',
          targetId: id,
          payload: { solo_ok: true, source: 'learn' },
        });
      }
    }

    // night_ok=true を冪等に適用
    for (const id of nightIds as string[]) {
      const r = await pool.query(
        `UPDATE staff_master SET night_ok = true, updated_at = NOW()
         WHERE id = $1 AND night_ok = false AND deleted_at IS NULL
         RETURNING id`,
        [id]
      );
      if (r.rows.length > 0) {
        applied.night_ok += 1;
        logAudit({
          req,
          actorEmail: adminUser.email,
          action: 'LEARN_NIGHT_OK',
          targetType: 'staff_master',
          targetId: id,
          payload: { night_ok: true, source: 'learn' },
        });
      }
    }

    // good ペアを冪等に登録（既存・重複は ON CONFLICT で握る）
    for (const { a, b } of normalizedPairs) {
      // 両者の存在確認
      const staffCheck = await pool.query(
        `SELECT id FROM staff_master WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL`,
        [[a, b]]
      );
      if (staffCheck.rows.length < 2) continue;

      const r = await pool.query(
        `INSERT INTO staff_compatibility (staff_a_id, staff_b_id, kind, note, created_by)
         VALUES ($1, $2, 'good', $3, $4)
         ON CONFLICT (staff_a_id, staff_b_id, kind) WHERE deleted_at IS NULL DO NOTHING
         RETURNING id`,
        [a, b, '過去配置データから学習（よく一緒に組むペア）', adminUser.email]
      );
      if (r.rows.length > 0) {
        applied.good_pairs += 1;
        logAudit({
          req,
          actorEmail: adminUser.email,
          action: 'LEARN_GOOD_PAIR',
          targetType: 'staff_compatibility',
          targetId: r.rows[0].id as string,
          payload: { staff_a_id: a, staff_b_id: b, kind: 'good', source: 'learn' },
        });
      }
    }

    res.json({ ok: true, applied });
  } catch (error) {
    handleDbError(res, error, 'Learn apply');
  }
});

export default router;
