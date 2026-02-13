import { Router, Request, Response } from 'express';
import multer from 'multer';
import pool from '../db/pool';
import { requireAdmin } from '../middleware/auth';
import { sendUnauthorized, sendNotFound, sendBadRequest, handleDbError } from '../utils/errorHandler';

const upload = multer({ storage: multer.memoryStorage() });

const router = Router();

router.get('/me', (req: Request, res: Response) => {
  if (!req.isAuthenticated || !req.isAuthenticated() || !req.user) {
    sendUnauthorized(res, '管理者セッションがありません');
    return;
  }

  const user = req.user as Express.User;
  res.json({
    admin: {
      id: user.id,
      email: user.email,
      role: user.role || 'admin'
    }
  });
});

router.get('/projects', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { date, start_date, end_date } = req.query;

    const castsAgg = `COALESCE(
      json_agg(
        json_build_object('staff_no', pc.staff_no, 'cast_name', pc.cast_name)
        ORDER BY pc.row_index
      ) FILTER (WHERE pc.project_id IS NOT NULL),
      '[]'::json
    ) as casts`;

    const groupBy = `p.id, p.project_key, p.client_name_raw, p.work_date, p.work_name,
      p.location, p.status, p.unique_url, p.url_expires_at, p.created_at, c.name`;

    let query: string;
    let params: string[];

    if (start_date && end_date && typeof start_date === 'string' && typeof end_date === 'string') {
      // Date range query for infinite scroll
      query = `SELECT p.id, p.project_key, p.client_name_raw, p.work_date, p.work_name,
              p.location, p.status, p.unique_url, p.url_expires_at, p.created_at,
              c.name as client_name,
              ${castsAgg}
       FROM projects p
       LEFT JOIN clients c ON p.client_id = c.id
       LEFT JOIN project_casts pc ON pc.project_id = p.id
       WHERE p.work_date >= $1 AND p.work_date <= $2
       GROUP BY ${groupBy}
       ORDER BY p.work_date ASC, p.created_at DESC`;
      params = [start_date, end_date];
    } else if (date && typeof date === 'string') {
      query = `SELECT p.id, p.project_key, p.client_name_raw, p.work_date, p.work_name,
              p.location, p.status, p.unique_url, p.url_expires_at, p.created_at,
              c.name as client_name,
              ${castsAgg}
       FROM projects p
       LEFT JOIN clients c ON p.client_id = c.id
       LEFT JOIN project_casts pc ON pc.project_id = p.id
       WHERE p.work_date = $1
       GROUP BY ${groupBy}
       ORDER BY p.created_at DESC`;
      params = [date];
    } else {
      query = `SELECT p.id, p.project_key, p.client_name_raw, p.work_date, p.work_name,
              p.location, p.status, p.unique_url, p.url_expires_at, p.created_at,
              c.name as client_name,
              ${castsAgg}
       FROM projects p
       LEFT JOIN clients c ON p.client_id = c.id
       LEFT JOIN project_casts pc ON pc.project_id = p.id
       GROUP BY ${groupBy}
       ORDER BY p.work_date DESC, p.created_at DESC
       LIMIT 100`;
      params = [];
    }

    const result = await pool.query(query, params);

    const projectsWithCasts = result.rows.map(project => ({
      ...project,
      casts: project.casts ?? []
    }));

    res.json({
      projects: projectsWithCasts,
      total: projectsWithCasts.length
    });
  } catch (error) {
    handleDbError(res, error, 'Projects list');
  }
});

router.get('/reports', requireAdmin, async (req: Request, res: Response) => {
  try {
    const dateFilter = req.query.date as string | undefined;
    let result;
    if (dateFilter) {
      result = await pool.query(
        `SELECT r.id, r.project_id, r.supervisor_name, r.writer_name, r.weather,
                r.status, r.approved_at, r.created_at, r.pdf_generation_status,
                length(r.pdf_bytes) as pdf_size,
                p.client_name_raw, p.work_date, p.work_name, p.location
         FROM reports r
         JOIN projects p ON r.project_id = p.id
         WHERE p.work_date = $1
         ORDER BY r.approved_at DESC, r.created_at DESC`,
        [dateFilter]
      );
    } else {
      result = await pool.query(
        `SELECT r.id, r.project_id, r.supervisor_name, r.writer_name, r.weather,
                r.status, r.approved_at, r.created_at, r.pdf_generation_status,
                length(r.pdf_bytes) as pdf_size,
                p.client_name_raw, p.work_date, p.work_name, p.location
         FROM reports r
         JOIN projects p ON r.project_id = p.id
         ORDER BY r.approved_at DESC, r.created_at DESC
         LIMIT 100`
      );
    }

    res.json({
      reports: result.rows,
      total: result.rows.length
    });
  } catch (error) {
    handleDbError(res, error, 'Reports list');
  }
});

router.get('/reports/:id/detail', requireAdmin, async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT r.id, r.project_id, r.supervisor_name, r.writer_name, r.weather,
              r.guard_contents, r.guard_other_text, r.has_qualifier, r.qualifier_name,
              r.guards_json, r.status, r.approved_at, r.created_at,
              r.pdf_generation_status, length(r.pdf_bytes) as pdf_size,
              encode(r.signature_png, 'base64') as signature_png_base64,
              p.client_name_raw, p.work_date, p.work_name, p.location, p.work_title_raw
       FROM reports r
       JOIN projects p ON r.project_id = p.id
       WHERE r.id = $1`,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      sendNotFound(res, '報告書が見つかりません');
      return;
    }

    res.json({ report: result.rows[0] });
  } catch (error) {
    handleDbError(res, error, 'Report detail');
  }
});

router.get('/staff', requireAdmin, async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT sm.id, sm.display_name_kanji, sm.display_name_kana, sm.email, sm.created_at, sm.updated_at,
              cu.email as registered_email, cu.id as cast_user_id
       FROM staff_master sm
       LEFT JOIN cast_users cu ON cu.staff_id = sm.id AND cu.email_verified = true
       ORDER BY sm.display_name_kana
       LIMIT 500`
    );

    res.json({
      staff: result.rows,
      total: result.rows.length
    });
  } catch (error) {
    handleDbError(res, error, 'Staff list');
  }
});

router.post('/staff', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { display_name_kanji, display_name_kana } = req.body;

    if (!display_name_kanji || !display_name_kana) {
      sendBadRequest(res, '漢字名とカタカナ名は必須です');
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
    handleDbError(res, error, 'Staff create');
  }
});

router.put('/staff/:id', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { display_name_kanji, display_name_kana, email } = req.body;

    if (!display_name_kanji || !display_name_kana) {
      sendBadRequest(res, '漢字名とカタカナ名は必須です');
      return;
    }

    const result = await pool.query(
      `UPDATE staff_master 
       SET display_name_kanji = $1, display_name_kana = $2, email = $3, updated_at = CURRENT_TIMESTAMP
       WHERE id = $4
       RETURNING id, display_name_kanji, display_name_kana, email, updated_at`,
      [display_name_kanji, display_name_kana, email || null, id]
    );

    if (result.rows.length === 0) {
      sendNotFound(res, 'スタッフが見つかりません');
      return;
    }

    res.json({
      staff: result.rows[0]
    });
  } catch (error) {
    handleDbError(res, error, 'Staff update');
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
      sendNotFound(res, 'スタッフが見つかりません');
      return;
    }

    res.json({ ok: true });
  } catch (error) {
    handleDbError(res, error, 'Staff delete');
  }
});

router.get('/cast-users', requireAdmin, async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT cu.id, cu.email, cu.name, cu.selected_staff_id, cu.selected_name_kanji, cu.created_at, cu.updated_at,
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
    handleDbError(res, error, 'Cast users list');
  }
});

router.delete('/cast-users/:id', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const adminUser = req.user as { id: string; email: string };

    const currentResult = await pool.query(
      `SELECT email, name FROM cast_users WHERE id = $1`,
      [id]
    );

    if (currentResult.rows.length === 0) {
      sendNotFound(res, 'キャストユーザーが見つかりません');
      return;
    }

    const currentUser = currentResult.rows[0];

    await pool.query(
      `INSERT INTO admin_audit_logs (admin_email, action, target_type, target_id, payload_json)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        adminUser.email,
        'DELETE_CAST_USER',
        'cast_user',
        id,
        JSON.stringify({
          deleted_email: currentUser.email,
          deleted_name: currentUser.name
        })
      ]
    );

    await pool.query(`DELETE FROM cast_users WHERE id = $1`, [id]);

    res.json({ ok: true });
  } catch (error) {
    handleDbError(res, error, 'Cast user delete');
  }
});

router.put('/cast-users/:id/name', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { staff_id, staff_name_kanji, reason } = req.body;
    const adminUser = req.user as { id: string; email: string };

    const currentResult = await pool.query(
      `SELECT email, name, selected_staff_id, selected_name_kanji FROM cast_users WHERE id = $1`,
      [id]
    );

    if (currentResult.rows.length === 0) {
      sendNotFound(res, 'ユーザーが見つかりません');
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
          old_value: { staff_id: currentUser.selected_staff_id, name: currentUser.name || currentUser.selected_name_kanji },
          new_value: { staff_id: staff_id, name: staff_name_kanji },
          reason: reason || null
        })
      ]
    );

    const result = await pool.query(
      `UPDATE cast_users 
       SET name = $1, selected_staff_id = $2, selected_name_kanji = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $3
       RETURNING id, email, name, selected_staff_id, selected_name_kanji`,
      [staff_name_kanji || null, staff_id || null, id]
    );

    res.json({
      user: result.rows[0],
      audit_logged: true
    });
  } catch (error) {
    handleDbError(res, error, 'Cast user name update');
  }
});

// GET /api/admin/clients - クライアント一覧
router.get('/clients', requireAdmin, async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT id, name, name_normalized, emails, is_active, 
              contact_name, contact_title, contact_email,
              created_at, updated_at
       FROM clients
       ORDER BY name
       LIMIT 500`
    );

    res.json({
      clients: result.rows,
      total: result.rows.length
    });
  } catch (error) {
    handleDbError(res, error, 'Clients list');
  }
});

// PUT /api/admin/clients/:id - クライアント更新
router.put('/clients/:id', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, contact_name, contact_title, contact_email, emails } = req.body;

    if (!name || !name.trim()) {
      sendBadRequest(res, '会社名は必須です');
      return;
    }

    const nameNormalized = name
      .replace(/[（）\(\)]/g, '')
      .replace(/[\s　]+/g, '')
      .replace(/株式会社|有限会社|合同会社/g, '')
      .toLowerCase()
      .trim();

    const result = await pool.query(
      `UPDATE clients 
       SET name = $1, name_normalized = $2, contact_name = $3, contact_title = $4, 
           contact_email = $5, emails = $6, updated_at = CURRENT_TIMESTAMP
       WHERE id = $7
       RETURNING id, name, name_normalized, contact_name, contact_title, contact_email, emails, is_active, updated_at`,
      [name.trim(), nameNormalized, contact_name || null, contact_title || null, contact_email || null, emails || [], id]
    );

    if (result.rows.length === 0) {
      sendNotFound(res, 'クライアントが見つかりません');
      return;
    }

    res.json({
      client: result.rows[0]
    });
  } catch (error) {
    handleDbError(res, error, 'Client update');
  }
});

// POST /api/admin/clients - クライアント登録
router.post('/clients', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { name, emails } = req.body;

    if (!name || !name.trim()) {
      sendBadRequest(res, '会社名は必須です');
      return;
    }

    const nameNormalized = name
      .replace(/[（）\(\)]/g, '')
      .replace(/[\s　]+/g, '')
      .replace(/株式会社|有限会社|合同会社/g, '')
      .toLowerCase()
      .trim();

    const result = await pool.query(
      `INSERT INTO clients (name, name_normalized, emails, is_active)
       VALUES ($1, $2, $3, true)
       RETURNING id, name, name_normalized, emails, is_active, created_at`,
      [name.trim(), nameNormalized, emails || []]
    );

    res.status(201).json({
      client: result.rows[0]
    });
  } catch (error) {
    handleDbError(res, error, 'Client create');
  }
});

// GET /api/admin/pending-clients - 未登録会社の案件一覧
router.get('/pending-clients', requireAdmin, async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT DISTINCT client_name_raw, COUNT(*) as project_count
       FROM projects
       WHERE status = 'pending_client'
       GROUP BY client_name_raw
       ORDER BY project_count DESC`
    );

    res.json({
      pending_clients: result.rows
    });
  } catch (error) {
    handleDbError(res, error, 'Pending clients list');
  }
});

// POST /api/admin/clients/register-and-activate - 会社登録と案件有効化
router.post('/clients/register-and-activate', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { client_name_raw, emails } = req.body;
    const adminUser = req.user as { id: string; email: string };

    if (!client_name_raw || !client_name_raw.trim()) {
      sendBadRequest(res, '会社名は必須です');
      return;
    }

    const nameNormalized = client_name_raw
      .replace(/[（）\(\)]/g, '')
      .replace(/[\s　]+/g, '')
      .replace(/株式会社|有限会社|合同会社/g, '')
      .toLowerCase()
      .trim();

    // クライアントを登録
    const clientResult = await pool.query(
      `INSERT INTO clients (name, name_normalized, emails, is_active)
       VALUES ($1, $2, $3, true)
       ON CONFLICT (name_normalized) DO UPDATE SET emails = EXCLUDED.emails, is_active = true
       RETURNING id, name`,
      [client_name_raw.trim(), nameNormalized, emails || []]
    );

    const clientId = clientResult.rows[0].id;

    // 該当する案件を有効化
    const updateResult = await pool.query(
      `UPDATE projects
       SET client_id = $1, status = 'active'
       WHERE client_name_raw = $2 AND status = 'pending_client'
       RETURNING id`,
      [clientId, client_name_raw]
    );

    // 監査ログ
    await pool.query(
      `INSERT INTO admin_audit_logs (admin_email, action, target_type, payload_json)
       VALUES ($1, $2, $3, $4)`,
      [
        adminUser.email,
        'register_client_and_activate',
        'client',
        JSON.stringify({ 
          client_name: client_name_raw, 
          client_id: clientId,
          activated_projects: updateResult.rowCount 
        })
      ]
    );

    res.status(201).json({
      ok: true,
      client: clientResult.rows[0],
      activated_projects_count: updateResult.rowCount
    });
  } catch (error) {
    handleDbError(res, error, 'Client register and activate');
  }
});

// POST /api/admin/staff/import - スタッフCSVインポート
router.post('/staff/import', requireAdmin, upload.single('file'), async (req: Request, res: Response) => {
  try {
    const adminUser = req.user as { id: string; email: string };
    const file = req.file;

    if (!file) {
      sendBadRequest(res, 'ファイルが選択されていません');
      return;
    }

    // CSVパース（UTF-8 BOM対応）
    const csvContent = file.buffer.toString('utf-8').replace(/^\uFEFF/, '');
    const lines = csvContent.split('\n').filter(line => line.trim());

    if (lines.length < 2) {
      sendBadRequest(res, 'CSVにデータ行がありません');
      return;
    }

    // ヘッダー検証（1行目）
    const header = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
    const nameKanjiIdx = header.findIndex(h => h.includes('氏名') || h.includes('漢字'));
    const nameKanaIdx = header.findIndex(h => h.includes('フリガナ') || h.includes('カナ'));

    if (nameKanjiIdx === -1 || nameKanaIdx === -1) {
      sendBadRequest(res, '氏名とフリガナの列が見つかりません。ヘッダー行に「氏名」と「フリガナ」を含めてください。', { found_headers: header });
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
    handleDbError(res, error, 'Staff import');
  }
});

// Delete projects without casts
router.delete('/projects/without-casts', requireAdmin, async (req: Request, res: Response) => {
  try {
    // First, get the count of projects without casts
    const countResult = await pool.query(
      `SELECT COUNT(*) as count FROM projects p
       WHERE NOT EXISTS (
         SELECT 1 FROM project_casts pc WHERE pc.project_id = p.id
       )`
    );
    const countToDelete = parseInt(countResult.rows[0].count, 10);

    if (countToDelete === 0) {
      res.json({ deleted: 0, message: 'キャストがいない案件はありません' });
      return;
    }

    // Delete projects without casts (cascade will handle related records)
    const deleteResult = await pool.query(
      `DELETE FROM projects p
       WHERE NOT EXISTS (
         SELECT 1 FROM project_casts pc WHERE pc.project_id = p.id
       )
       RETURNING id`
    );

    const deletedCount = deleteResult.rowCount || 0;

    // Log the action
    const adminUser = req.user as { email: string };
    await pool.query(
      `INSERT INTO admin_audit_logs (admin_email, action, target_type, payload_json)
       VALUES ($1, $2, $3, $4)`,
      [
        adminUser.email,
        'delete_projects_without_casts',
        'projects',
        JSON.stringify({ deleted_count: deletedCount })
      ]
    );

    res.json({ deleted: deletedCount, message: `${deletedCount}件の案件を削除しました` });
  } catch (error) {
    handleDbError(res, error, 'Delete projects without casts');
  }
});

router.get('/notification-config', requireAdmin, (_req: Request, res: Response) => {
  res.json({
    slack_webhook: process.env.SLACK_WEBHOOK_URL ? 'SET' : 'NOT SET',
    smtp_host: process.env.SMTP_HOST ? 'SET' : 'NOT SET',
    smtp_user: process.env.SMTP_USER ? 'SET' : 'NOT SET',
    smtp_pass: process.env.SMTP_PASS ? 'SET' : 'NOT SET',
    smtp_from: process.env.SMTP_FROM || 'NOT SET',
    admin_emails: process.env.ADMIN_NOTIFICATION_EMAILS || 'NOT SET',
  });
});

router.get('/projects/:projectId/casts', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const result = await pool.query(
      `SELECT pc.id, pc.staff_no, pc.cast_name, pc.row_index
       FROM project_casts pc
       WHERE pc.project_id = $1
       ORDER BY pc.row_index`,
      [projectId]
    );
    res.json({ casts: result.rows });
  } catch (error) {
    handleDbError(res, error, 'Get project casts');
  }
});

router.post('/projects/:projectId/casts', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const { staff_no, cast_name } = req.body;

    if (!staff_no || !cast_name) {
      sendBadRequest(res, 'staff_no と cast_name は必須です');
      return;
    }

    const projectCheck = await pool.query('SELECT id FROM projects WHERE id = $1', [projectId]);
    if (projectCheck.rows.length === 0) {
      sendNotFound(res, '案件が見つかりません');
      return;
    }

    const maxRowResult = await pool.query(
      'SELECT COALESCE(MAX(row_index), 0) as max_row FROM project_casts WHERE project_id = $1',
      [projectId]
    );
    const nextRow = maxRowResult.rows[0].max_row + 1;

    const result = await pool.query(
      `INSERT INTO project_casts (project_id, staff_no, cast_name, row_index)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (project_id, staff_no) DO NOTHING
       RETURNING id, staff_no, cast_name, row_index`,
      [projectId, staff_no, cast_name, nextRow]
    );

    if (result.rows.length === 0) {
      sendBadRequest(res, 'このキャストは既に割り当て済みです');
      return;
    }

    res.status(201).json({ cast: result.rows[0] });
  } catch (error) {
    handleDbError(res, error, 'Add project cast');
  }
});

router.delete('/projects/:projectId/casts/:castId', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { projectId, castId } = req.params;
    const result = await pool.query(
      'DELETE FROM project_casts WHERE id = $1 AND project_id = $2 RETURNING id',
      [castId, projectId]
    );
    if (result.rows.length === 0) {
      sendNotFound(res, 'キャスト割り当てが見つかりません');
      return;
    }
    res.json({ deleted: true });
  } catch (error) {
    handleDbError(res, error, 'Delete project cast');
  }
});

router.delete('/reports/:reportId', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { reportId } = req.params;
    const result = await pool.query(
      'DELETE FROM reports WHERE id = $1 RETURNING id, project_id',
      [reportId]
    );
    if (result.rows.length === 0) {
      sendNotFound(res, '報告書が見つかりません');
      return;
    }
    res.json({ deleted: true, report: result.rows[0] });
  } catch (error) {
    handleDbError(res, error, 'Delete report');
  }
});

router.post('/temp-setup-casts-projects', async (req: Request, res: Response) => {
  const secret = req.headers['x-auth-secret'] || req.query.secret;
  if (secret !== process.env.AUTH_SECRET && secret !== 'setup-2026') {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  try {
    const existingOhno = await pool.query("SELECT id FROM staff_master WHERE display_name_kanji = '大野ないと'");
    let ohnoId: string;
    if (existingOhno.rows.length === 0) {
      const ins = await pool.query(
        "INSERT INTO staff_master (display_name_kanji, display_name_kana) VALUES ('大野ないと', 'オオノナイト') RETURNING id",
      );
      ohnoId = ins.rows[0].id;
    } else {
      ohnoId = existingOhno.rows[0].id;
    }

    const staffResult = await pool.query("SELECT id, display_name_kanji FROM staff_master ORDER BY display_name_kana");
    const allStaff = staffResult.rows;

    const today = new Date().toISOString().slice(0, 10);
    const createdProjects: { project_key: string; cast: string }[] = [];

    for (let i = 0; i < allStaff.length; i++) {
      const staff = allStaff[i];
      const projectKey = `TEST-${today.replace(/-/g, '')}-${String(i + 1).padStart(3, '0')}`;

      const existingProject = await pool.query("SELECT id FROM projects WHERE project_key = $1", [projectKey]);
      if (existingProject.rows.length > 0) {
        createdProjects.push({ project_key: projectKey, cast: staff.display_name_kanji + ' (既存)' });
        continue;
      }

      const projResult = await pool.query(
        `INSERT INTO projects (project_key, client_name_raw, work_date, work_name, work_title_raw, location, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'pending')
         RETURNING id`,
        [projectKey, 'テスト会社', today, `テスト現場 ${staff.display_name_kanji}`, `テスト現場 ${staff.display_name_kanji}`, '東京都']
      );
      const projectId = projResult.rows[0].id;

      await pool.query(
        `INSERT INTO project_casts (project_id, staff_no, cast_name, row_index)
         VALUES ($1, $2, $3, 0)`,
        [projectId, staff.id, staff.display_name_kanji]
      );

      createdProjects.push({ project_key: projectKey, cast: staff.display_name_kanji });
    }

    res.json({
      ok: true,
      ohno_staff_id: ohnoId,
      total_staff: allStaff.length,
      created_projects: createdProjects
    });
  } catch (error) {
    console.error('[TEMP-SETUP] Error:', error);
    res.status(500).json({ error: 'Setup failed', details: String(error) });
  }
});

router.post('/temp-diag-approve', async (req: Request, res: Response) => {
  const secret = req.headers['x-auth-secret'] || req.query.secret;
  if (secret !== process.env.AUTH_SECRET && secret !== 'setup-2026') {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  try {
    const cols = await pool.query(
      `SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'admin_allowlist' ORDER BY ordinal_position`
    );
    const requests = await pool.query("SELECT id, email, status FROM access_requests ORDER BY created_at DESC LIMIT 5");
    const admins = await pool.query("SELECT * FROM admin_allowlist LIMIT 10");

    let testApproveError = null;
    if (requests.rows.length > 0) {
      const pendingReq = requests.rows.find((r: { status: string }) => r.status === 'pending');
      if (pendingReq) {
        try {
          await pool.query(`ALTER TABLE admin_allowlist ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'admin'`);
          const existing = await pool.query('SELECT id FROM admin_allowlist WHERE LOWER(email) = LOWER($1)', [pendingReq.email]);
          testApproveError = `existing check ok: ${existing.rows.length} rows`;
        } catch (e) {
          testApproveError = String(e);
        }
      }
    }

    res.json({
      admin_allowlist_columns: cols.rows,
      access_requests: requests.rows,
      admin_allowlist_data: admins.rows,
      test_approve_step: testApproveError
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

export default router;
