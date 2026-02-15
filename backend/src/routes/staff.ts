import { Router, Request, Response } from 'express';
import pool from '../db/pool';
import { authenticateCast } from '../middleware/auth';
import { AuthenticatedCastRequest } from '../types';

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
       WHERE REPLACE(REPLACE(display_name_kana, ' ', ''), '　', '') ILIKE $1 AND deleted_at IS NULL
       ORDER BY display_name_kana
       LIMIT 20`,
      [`%${normalizedQuery}%`]
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

    const staffResult = await pool.query(
      'SELECT id, display_name_kanji FROM staff_master WHERE id = $1 AND deleted_at IS NULL',
      [staff_id]
    );

    if (staffResult.rows.length === 0) {
      res.status(404).json({
        error: 'NOT_FOUND',
        message: '指定されたスタッフが見つかりません'
      });
      return;
    }

    await pool.query(
      `UPDATE cast_users 
       SET staff_id = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 AND deleted_at IS NULL`,
      [staff_id, castUser.userId]
    );

    res.json({
      ok: true,
      selectedStaffId: staff_id,
      selectedNameKanji: staff_name_kanji
    });
  } catch (error) {
    console.error('Staff select error:', error);
    res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: '名前選択の保存中にエラーが発生しました'
    });
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
