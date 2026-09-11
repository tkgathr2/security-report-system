import { Router, Request, Response } from 'express';
import pool from '../db/pool';
import { authenticateCast } from '../middleware/auth';
import { AuthenticatedCastRequest } from '../types';
import { escapeLikePattern } from '../utils/dateUtil';
import { logAudit } from '../utils/auditLog';
import { isOutsourcedStaffKana } from '../services/staffResolver';

const router = Router();

function normalizeKatakana(input: string): string {
  let normalized = input
    .replace(/[\u3041-\u3096]/g, (char) => 
      String.fromCharCode(char.charCodeAt(0) + 0x60)
    )
    .replace(/[ａ-ｚＡ-Ｚ０-９]/g, (char) => 
      String.fromCharCode(char.charCodeAt(0) - 0xFEE0)
    )
    .replace(/\s+/g, '')
    .replace(/　/g, '');
  
  return normalized;
}

router.get('/search', authenticateCast, async (req: Request, res: Response) => {
  try {
    const { q } = req.query;
    
    if (!q || typeof q !== 'string' || q.trim().length === 0) {
      res.json({ staff: [] });
      return;
    }

    const normalizedQuery = normalizeKatakana(q.trim());
    
    if (normalizedQuery.length === 0) {
      res.json({ staff: [] });
      return;
    }

    const result = await pool.query(
      `SELECT id, display_name_kanji, display_name_kana
       FROM staff_master
       WHERE REPLACE(REPLACE(display_name_kana, ' ', ''), '　', '') ILIKE $1 ESCAPE '\\' AND deleted_at IS NULL
       ORDER BY display_name_kana
       LIMIT 20`,
      [`%${escapeLikePattern(normalizedQuery)}%`]
    );

    res.json({
      staff: result.rows.map(row => ({
        id: row.id,
        displayNameKanji: row.display_name_kanji,
        displayNameKana: row.display_name_kana
      }))
    });
  } catch (error) {
    console.error('Staff search error:', error);
    res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'スタッフ検索中にエラーが発生しました'
    });
  }
});

router.post('/select', authenticateCast, async (req: Request, res: Response) => {
  try {
    const castUser = (req as AuthenticatedCastRequest).castUser;
    const { staff_id, staff_name_kanji } = req.body;

    if (!staff_id || !staff_name_kanji) {
      res.status(400).json({
        error: 'INVALID_PAYLOAD',
        message: 'staff_idとstaff_name_kanjiは必須です'
      });
      return;
    }

    // KZ-147: 以前は認証済みキャストなら任意の staff_id に自分を紐付け直せたため、
    // 別人（外注スタッフ等）の行に自分のメールが表示され、その人宛の案内メールが届く状態になり得た。
    // 名前選択は「未紐付け（または紐付け先が削除済み）の本人が、空いている自分の名前を選ぶ」ときだけ許可し、
    // 紐付け済みの変更は管理者の cast-users 編集（監査ログ付き）に限定する。
    const currentResult = await pool.query(
      `SELECT cu.staff_id, cu.email, (sm.id IS NOT NULL) AS linked_to_active_staff
       FROM cast_users cu
       LEFT JOIN staff_master sm ON sm.id = cu.staff_id AND sm.deleted_at IS NULL
       WHERE cu.id = $1 AND cu.deleted_at IS NULL`,
      [castUser.userId]
    );

    if (currentResult.rows.length === 0) {
      res.status(404).json({
        error: 'NOT_FOUND',
        message: 'アカウントが見つかりません。再度ログインしてください'
      });
      return;
    }

    const current = currentResult.rows[0] as { staff_id: string | null; email: string; linked_to_active_staff: boolean };

    const staffResult = await pool.query(
      'SELECT id, display_name_kanji, display_name_kana, email FROM staff_master WHERE id = $1 AND deleted_at IS NULL',
      [staff_id]
    );

    if (staffResult.rows.length === 0) {
      res.status(404).json({
        error: 'NOT_FOUND',
        message: '指定されたスタッフが見つかりません'
      });
      return;
    }

    const staff = staffResult.rows[0] as { id: string; display_name_kanji: string; display_name_kana: string; email: string | null };

    if (isOutsourcedStaffKana(staff.display_name_kana)) {
      res.status(409).json({
        error: 'OUTSOURCED_STAFF',
        message: '外注スタッフの枠はご自身のお名前として選べません。ご自身のお名前を選んでください'
      });
      return;
    }

    if (current.staff_id !== staff_id) {
      if (current.linked_to_active_staff) {
        res.status(409).json({
          error: 'ALREADY_LINKED',
          message: '登録名はご自身で変更できません。お名前が違う場合は管理者にお問い合わせください'
        });
        return;
      }

      const staffEmail = typeof staff.email === 'string' ? staff.email.trim().toLowerCase() : '';
      if (staffEmail !== '' && staffEmail !== String(current.email).trim().toLowerCase()) {
        res.status(409).json({
          error: 'STAFF_EMAIL_MISMATCH',
          message: '選択したお名前は別のメールアドレスで登録されています。ご自身のお名前か確認してください'
        });
        return;
      }

      // 他の有効なキャストが既に使っている名前は選べない。判定と更新を1文にして同時選択の競合も防ぐ。
      const updated = await pool.query(
        `UPDATE cast_users
         SET staff_id = $1, updated_at = CURRENT_TIMESTAMP
         WHERE id = $2 AND deleted_at IS NULL
           AND staff_id IS NOT DISTINCT FROM $3
           AND NOT EXISTS (
             SELECT 1 FROM cast_users other
             WHERE other.staff_id = $1 AND other.deleted_at IS NULL AND other.id <> $2
           )
         RETURNING id`,
        [staff_id, castUser.userId, current.staff_id]
      );

      if (updated.rows.length === 0) {
        res.status(409).json({
          error: 'STAFF_ALREADY_LINKED',
          message: 'このお名前は既に別のアカウントで登録されています。ご自身のお名前か確認してください'
        });
        return;
      }

      logAudit({
        req,
        actorEmail: castUser.email,
        actorType: 'cast',
        action: 'CAST_SELECT_STAFF',
        targetType: 'cast_user',
        targetId: castUser.userId,
        payload: { staff_id, staff_name: staff.display_name_kanji, previous_staff_id: current.staff_id }
      });
    }

    res.json({
      ok: true,
      selectedStaffId: staff_id,
      selectedNameKanji: staff.display_name_kanji
    });
  } catch (error) {
    console.error('Staff select error:', error);
    res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: '名前選択の保存中にエラーが発生しました'
    });
  }
});

router.post('/register', authenticateCast, async (req: Request, res: Response) => {
  try {
    const { display_name_kanji, display_name_kana, email } = req.body;

    if (!display_name_kanji || typeof display_name_kanji !== 'string' || display_name_kanji.trim().length === 0) {
      res.status(400).json({ error: 'INVALID_PAYLOAD', message: '漢字名は必須です' });
      return;
    }
    if (!display_name_kana || typeof display_name_kana !== 'string' || display_name_kana.trim().length === 0) {
      res.status(400).json({ error: 'INVALID_PAYLOAD', message: 'カタカナ名は必須です' });
      return;
    }
    if (display_name_kanji.length > 100 || display_name_kana.length > 100) {
      res.status(400).json({ error: 'INVALID_PAYLOAD', message: '名前は100文字以内で入力してください' });
      return;
    }

    const trimmedKanji = display_name_kanji.trim();
    const trimmedKana = display_name_kana.trim();
    const normalizedEmail = typeof email === 'string' && email.trim() ? email.trim().toLowerCase() : null;

    if (normalizedEmail) {
      const emailDup = await pool.query(
        `SELECT id FROM staff_master WHERE LOWER(email) = $1 AND deleted_at IS NULL LIMIT 1`,
        [normalizedEmail]
      );
      if (emailDup.rows.length > 0) {
        res.status(409).json({ error: 'DUPLICATE', message: 'このメールアドレスは既に登録されています' });
        return;
      }
    }

    const kanaDup = await pool.query(
      `SELECT id FROM staff_master
       WHERE REPLACE(REPLACE(display_name_kana, ' ', ''), '　', '')
           = REPLACE(REPLACE($1, ' ', ''), '　', '')
         AND deleted_at IS NULL
       LIMIT 1`,
      [trimmedKana]
    );
    if (kanaDup.rows.length > 0) {
      res.status(409).json({ error: 'DUPLICATE', message: '同じカナ名のスタッフが既に登録されています' });
      return;
    }

    let result;
    try {
      result = await pool.query(
        `INSERT INTO staff_master (display_name_kanji, display_name_kana, email)
         VALUES ($1, $2, $3)
         RETURNING id, display_name_kanji, display_name_kana`,
        [trimmedKanji, trimmedKana, normalizedEmail]
      );
    } catch (insertErr: unknown) {
      const pgCode = (insertErr as { code?: string } | null)?.code;
      if (pgCode === '23505') {
        res.status(409).json({ error: 'DUPLICATE', message: '同じ名前またはメールアドレスのスタッフが既に登録されています' });
        return;
      }
      throw insertErr;
    }

    const castUser = (req as AuthenticatedCastRequest).castUser;
    console.log(`[STAFF_REGISTER] Cast user ${castUser.email} registered new staff: ${trimmedKanji} (${trimmedKana})`);

    res.status(201).json({
      ok: true,
      staff: {
        id: result.rows[0].id,
        displayNameKanji: result.rows[0].display_name_kanji,
        displayNameKana: result.rows[0].display_name_kana
      }
    });
  } catch (error) {
    console.error('Staff register error:', error);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: 'スタッフ登録中にエラーが発生しました' });
  }
});

router.get('/me', authenticateCast, async (req: Request, res: Response) => {
  try {
    const castUser = (req as AuthenticatedCastRequest).castUser;

    const result = await pool.query(
      `SELECT cu.staff_id, sm.display_name_kanji as staff_name
       FROM cast_users cu
       LEFT JOIN staff_master sm ON cu.staff_id = sm.id AND sm.deleted_at IS NULL
       WHERE cu.id = $1 AND cu.deleted_at IS NULL`,
      [castUser.userId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({
        error: 'NOT_FOUND',
        message: 'ユーザーが見つかりません'
      });
      return;
    }

    const user = result.rows[0];
    res.json({
      selectedStaffId: user.staff_id,
      selectedNameKanji: user.staff_name,
      hasSelectedName: !!user.staff_id
    });
  } catch (error) {
    console.error('Get user info error:', error);
    res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'ユーザー情報の取得中にエラーが発生しました'
    });
  }
});

export default router;
