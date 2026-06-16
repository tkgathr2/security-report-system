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
      payload: { solo_ok, night_ok, control_note: controlNote },
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
      payload: { staff_a_id: normA, staff_b_id: normB, kind, note },
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

export default router;
