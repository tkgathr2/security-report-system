import { Router, Request, Response } from 'express';
import multer from 'multer';
import pool from '../db/pool';

const upload = multer({ storage: multer.memoryStorage() });

const router = Router();

function requireAdmin(req: Request, res: Response, next: () => void): void {
  if (!req.isAuthenticated || !req.isAuthenticated() || !req.user) {
    res.status(401).json({
      error: 'ADMIN_UNAUTHORIZED',
      message: '管理者セッションがありません',
      details: {}
    });
    return;
  }
  next();
}

router.get('/me', (req: Request, res: Response) => {
  if (!req.isAuthenticated || !req.isAuthenticated() || !req.user) {
    res.status(401).json({
      error: 'ADMIN_UNAUTHORIZED',
      message: '管理者セッションがありません',
      details: {}
    });
    return;
  }

  res.json({
    admin: {
      id: req.user.id,
      email: req.user.email
    }
  });
});

router.get('/projects', requireAdmin, async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT p.id, p.project_key, p.client_name_raw, p.work_date, p.work_name, 
              p.location, p.status, p.unique_url, p.url_expires_at, p.created_at,
              c.name as client_name
       FROM projects p
       LEFT JOIN clients c ON p.client_id = c.id
       ORDER BY p.work_date DESC, p.created_at DESC
       LIMIT 100`
    );

    res.json({
      projects: result.rows,
      total: result.rows.length
    });
  } catch (error) {
    console.error('Projects list error:', error);
    res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'データベースエラーが発生しました',
      details: {}
    });
  }
});

router.get('/reports', requireAdmin, async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT r.id, r.project_id, r.supervisor_name, r.writer_name, r.weather,
              r.status, r.approved_at, r.created_at, r.pdf_generation_status,
              length(r.pdf_bytes) as pdf_size,
              p.client_name_raw, p.work_date, p.work_name, p.location
       FROM reports r
       JOIN projects p ON r.project_id = p.id
       ORDER BY r.approved_at DESC, r.created_at DESC
       LIMIT 100`
    );

    res.json({
      reports: result.rows,
      total: result.rows.length
    });
  } catch (error) {
    console.error('Reports list error:', error);
    res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'データベースエラーが発生しました',
      details: {}
    });
  }
});

router.get('/staff', requireAdmin, async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT id, display_name_kanji, display_name_kana, created_at, updated_at
       FROM staff_master
       ORDER BY display_name_kana
       LIMIT 500`
    );

    res.json({
      staff: result.rows,
      total: result.rows.length
    });
  } catch (error) {
    console.error('Staff list error:', error);
    res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'データベースエラーが発生しました',
      details: {}
    });
  }
});

router.post('/staff', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { display_name_kanji, display_name_kana } = req.body;

    if (!display_name_kanji || !display_name_kana) {
      res.status(400).json({
        error: 'INVALID_PAYLOAD',
        message: '漢字名とカタカナ名は必須です',
        details: {}
      });
      return;
    }

    const result = await pool.query(
      `INSERT INTO staff_master (display_name_kanji, display_name_kana)
       VALUES ($1, $2)
       RETURNING id, display_name_kanji, display_name_kana, created_at`,
      [display_name_kanji, display_name_kana]
    );

    res.status(201).json({
      staff: result.rows[0]
    });
  } catch (error) {
    console.error('Staff create error:', error);
    res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'データベースエラーが発生しました',
      details: {}
    });
  }
});

router.put('/staff/:id', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { display_name_kanji, display_name_kana } = req.body;

    if (!display_name_kanji || !display_name_kana) {
      res.status(400).json({
        error: 'INVALID_PAYLOAD',
        message: '漢字名とカタカナ名は必須です',
        details: {}
      });
      return;
    }

    const result = await pool.query(
      `UPDATE staff_master 
       SET display_name_kanji = $1, display_name_kana = $2, updated_at = CURRENT_TIMESTAMP
       WHERE id = $3
       RETURNING id, display_name_kanji, display_name_kana, updated_at`,
      [display_name_kanji, display_name_kana, id]
    );

    if (result.rows.length === 0) {
      res.status(404).json({
        error: 'NOT_FOUND',
        message: 'スタッフが見つかりません',
        details: {}
      });
      return;
    }

    res.json({
      staff: result.rows[0]
    });
  } catch (error) {
    console.error('Staff update error:', error);
    res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'データベースエラーが発生しました',
      details: {}
    });
  }
});

router.delete('/staff/:id', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `DELETE FROM staff_master WHERE id = $1 RETURNING id`,
      [id]
    );

    if (result.rows.length === 0) {
      res.status(404).json({
        error: 'NOT_FOUND',
        message: 'スタッフが見つかりません',
        details: {}
      });
      return;
    }

    res.json({ ok: true });
  } catch (error) {
    console.error('Staff delete error:', error);
    res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'データベースエラーが発生しました',
      details: {}
    });
  }
});

router.get('/cast-users', requireAdmin, async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT cu.id, cu.email, cu.selected_staff_id, cu.selected_name_kanji, cu.created_at, cu.updated_at,
              sm.display_name_kanji as staff_name_kanji, sm.display_name_kana as staff_name_kana
       FROM cast_users cu
       LEFT JOIN staff_master sm ON cu.selected_staff_id = sm.id
       ORDER BY cu.updated_at DESC
       LIMIT 200`
    );

    res.json({
      users: result.rows,
      total: result.rows.length
    });
  } catch (error) {
    console.error('Cast users list error:', error);
    res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'データベースエラーが発生しました',
      details: {}
    });
  }
});

router.put('/cast-users/:id/name', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { staff_id, staff_name_kanji, reason } = req.body;
    const adminUser = req.user as { id: string; email: string };

    const currentResult = await pool.query(
      `SELECT email, selected_staff_id, selected_name_kanji FROM cast_users WHERE id = $1`,
      [id]
    );

    if (currentResult.rows.length === 0) {
      res.status(404).json({
        error: 'NOT_FOUND',
        message: 'ユーザーが見つかりません',
        details: {}
      });
      return;
    }

    const currentUser = currentResult.rows[0];

    await pool.query(
      `INSERT INTO admin_audit_logs (admin_email, action, target_type, target_id, payload_json)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        adminUser.email,
        'UPDATE_USER_NAME',
        'cast_user',
        id,
        JSON.stringify({
          old_value: { staff_id: currentUser.selected_staff_id, name: currentUser.selected_name_kanji },
          new_value: { staff_id: staff_id, name: staff_name_kanji },
          reason: reason || null
        })
      ]
    );

    const result = await pool.query(
      `UPDATE cast_users 
       SET selected_staff_id = $1, selected_name_kanji = $2, updated_at = CURRENT_TIMESTAMP
       WHERE id = $3
       RETURNING id, email, selected_staff_id, selected_name_kanji`,
      [staff_id || null, staff_name_kanji || null, id]
    );

    res.json({
      user: result.rows[0],
      audit_logged: true
    });
  } catch (error) {
    console.error('Cast user name update error:', error);
    res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'データベースエラーが発生しました',
      details: {}
    });
  }
});

// POST /api/admin/staff/import - スタッフCSVインポート
router.post('/staff/import', requireAdmin, upload.single('file'), async (req: Request, res: Response) => {
  try {
    const adminUser = req.user as { id: string; email: string };
    const file = req.file;

    if (!file) {
      res.status(400).json({
        error: 'NO_FILE',
        message: 'ファイルが選択されていません',
        details: {}
      });
      return;
    }

    // CSVパース（UTF-8 BOM対応）
    const csvContent = file.buffer.toString('utf-8').replace(/^\uFEFF/, '');
    const lines = csvContent.split('\n').filter(line => line.trim());

    if (lines.length < 2) {
      res.status(400).json({
        error: 'CSV_EMPTY',
        message: 'CSVにデータ行がありません',
        details: {}
      });
      return;
    }

    // ヘッダー検証（1行目）
    const header = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
    const nameKanjiIdx = header.findIndex(h => h.includes('氏名') || h.includes('漢字'));
    const nameKanaIdx = header.findIndex(h => h.includes('フリガナ') || h.includes('カナ'));

    if (nameKanjiIdx === -1 || nameKanaIdx === -1) {
      res.status(400).json({
        error: 'CSV_HEADER_MISMATCH',
        message: '氏名とフリガナの列が見つかりません。ヘッダー行に「氏名」と「フリガナ」を含めてください。',
        details: { found_headers: header }
      });
      return;
    }

    let inserted = 0, updated = 0, skipped = 0;

    // データ行を処理
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',').map(c => c.trim().replace(/^"|"$/g, ''));
      const nameKanji = cols[nameKanjiIdx] || '';
      const nameKana = cols[nameKanaIdx] || '';

      if (!nameKana) {
        skipped++;
        continue;
      }

      // カナで既存検索
      const existing = await pool.query(
        'SELECT id, display_name_kanji FROM staff_master WHERE display_name_kana = $1',
        [nameKana]
      );

      if (existing.rows.length === 0) {
        // 新規追加
        await pool.query(
          `INSERT INTO staff_master (display_name_kanji, display_name_kana, created_at, updated_at, created_by)
           VALUES ($1, $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, $3)`,
          [nameKanji, nameKana, adminUser.email]
        );
        inserted++;
      } else if (existing.rows[0].display_name_kanji !== nameKanji && nameKanji) {
        // 漢字更新
        await pool.query(
          'UPDATE staff_master SET display_name_kanji = $1, updated_at = CURRENT_TIMESTAMP WHERE display_name_kana = $2',
          [nameKanji, nameKana]
        );
        updated++;
      } else {
        skipped++;
      }
    }

    // 監査ログ
    await pool.query(
      `INSERT INTO admin_audit_logs (admin_email, action, target_type, payload_json)
       VALUES ($1, $2, $3, $4)`,
      [
        adminUser.email,
        'staff_import',
        'staff_master',
        JSON.stringify({ file_name: file.originalname, inserted, updated, skipped })
      ]
    );

    res.json({ inserted, updated, skipped });
  } catch (error) {
    console.error('Staff import error:', error);
    res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'インポートに失敗しました',
      details: {}
    });
  }
});

export default router;
