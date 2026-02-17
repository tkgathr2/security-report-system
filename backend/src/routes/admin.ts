import { Router, Request, Response } from 'express';
import multer from 'multer';
import pool from '../db/pool';
import { requireAdmin } from '../middleware/auth';
import { sendUnauthorized, sendNotFound, sendBadRequest, handleDbError } from '../utils/errorHandler';
import { isValidEmail } from '../utils/validation';
import { logAudit } from '../utils/auditLog';

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
        json_build_object('staff_no', pc.staff_no, 'cast_name', COALESCE(sm_pc.display_name_kanji, 'No.' || pc.staff_no), 'staff_id', pc.staff_id)
        ORDER BY pc.row_index
      ) FILTER (WHERE pc.project_id IS NOT NULL),
      '[]'::json
    ) as casts`;

    const groupBy = `p.id, p.project_key, p.work_date, p.work_name,
      p.location, p.status, p.unique_url, p.url_expires_at, p.created_at, c.name`;

    let query: string;
    let params: string[];

    if (start_date && end_date && typeof start_date === 'string' && typeof end_date === 'string') {
      // Date range query for infinite scroll
      query = `SELECT p.id, p.project_key, p.work_date, p.work_name,
              p.location, p.status, p.unique_url, p.url_expires_at, p.created_at,
              c.name as client_name,
              ${castsAgg}
       FROM projects p
       LEFT JOIN clients c ON p.client_id = c.id
       LEFT JOIN project_casts pc ON pc.project_id = p.id
       LEFT JOIN staff_master sm_pc ON pc.staff_id = sm_pc.id
       WHERE p.work_date >= $1 AND p.work_date <= $2 AND p.deleted_at IS NULL
       GROUP BY ${groupBy}
       ORDER BY p.work_date ASC, p.created_at DESC`;
      params = [start_date, end_date];
    } else if (date && typeof date === 'string') {
      query = `SELECT p.id, p.project_key, p.work_date, p.work_name,
              p.location, p.status, p.unique_url, p.url_expires_at, p.created_at,
              c.name as client_name,
              ${castsAgg}
       FROM projects p
       LEFT JOIN clients c ON p.client_id = c.id
       LEFT JOIN project_casts pc ON pc.project_id = p.id
       LEFT JOIN staff_master sm_pc ON pc.staff_id = sm_pc.id
       WHERE p.work_date = $1 AND p.deleted_at IS NULL
       GROUP BY ${groupBy}
       ORDER BY p.created_at DESC`;
      params = [date];
    } else {
      query = `SELECT p.id, p.project_key, p.work_date, p.work_name,
              p.location, p.status, p.unique_url, p.url_expires_at, p.created_at,
              c.name as client_name,
              ${castsAgg}
       FROM projects p
       LEFT JOIN clients c ON p.client_id = c.id
       LEFT JOIN project_casts pc ON pc.project_id = p.id
       LEFT JOIN staff_master sm_pc ON pc.staff_id = sm_pc.id
       WHERE p.deleted_at IS NULL
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
        `SELECT r.id, r.project_id, r.supervisor_name, r.weather,
                r.status, r.approved_at, r.created_at, r.pdf_generation_status,
                length(r.pdf_bytes) as pdf_size,
                c.name as client_name_raw, p.work_date, p.work_name, p.location,
                sm_w.display_name_kanji as writer_name
         FROM reports r
         JOIN projects p ON r.project_id = p.id
         LEFT JOIN clients c ON p.client_id = c.id
         LEFT JOIN staff_master sm_w ON r.writer_staff_id = sm_w.id
         WHERE p.work_date = $1 AND r.deleted_at IS NULL
         ORDER BY r.approved_at DESC, r.created_at DESC`,
        [dateFilter]
      );
    } else {
      result = await pool.query(
        `SELECT r.id, r.project_id, r.supervisor_name, r.weather,
                r.status, r.approved_at, r.created_at, r.pdf_generation_status,
                length(r.pdf_bytes) as pdf_size,
                c.name as client_name_raw, p.work_date, p.work_name, p.location,
                sm_w.display_name_kanji as writer_name
         FROM reports r
         JOIN projects p ON r.project_id = p.id
         LEFT JOIN clients c ON p.client_id = c.id
         LEFT JOIN staff_master sm_w ON r.writer_staff_id = sm_w.id
         WHERE r.deleted_at IS NULL
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
      `SELECT r.id, r.project_id, r.supervisor_name, r.weather,
              r.guard_contents, r.guard_other_text, r.has_qualifier, r.qualifier_name,
              r.guards_json, r.status, r.approved_at, r.created_at,
              r.pdf_generation_status, length(r.pdf_bytes) as pdf_size,
              encode(r.signature_png, 'base64') as signature_png_base64,
              c.name as client_name_raw, p.work_date, p.work_name, p.location, p.work_title_raw,
              sm_w.display_name_kanji as writer_name
       FROM reports r
       JOIN projects p ON r.project_id = p.id
       LEFT JOIN clients c ON p.client_id = c.id
       LEFT JOIN staff_master sm_w ON r.writer_staff_id = sm_w.id
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
       LEFT JOIN cast_users cu ON cu.staff_id = sm.id AND cu.email_verified = true AND cu.deleted_at IS NULL
       WHERE sm.deleted_at IS NULL
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

    const adminUser = req.user as { email: string };
    logAudit({ req, actorEmail: adminUser.email, action: 'CREATE_STAFF', targetType: 'staff_master', targetId: result.rows[0].id, payload: { display_name_kanji, display_name_kana } });

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

    if (email && !isValidEmail(email)) {
      sendBadRequest(res, '正しいメールアドレスを入力してください');
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

    if (email) {
      await pool.query(
        `UPDATE cast_users SET email = $1, updated_at = CURRENT_TIMESTAMP WHERE staff_id = $2`,
        [email, id]
      );
    }

    const adminUser = req.user as { email: string };
    logAudit({ req, actorEmail: adminUser.email, action: 'UPDATE_STAFF', targetType: 'staff_master', targetId: id, payload: { display_name_kanji, display_name_kana, email: email || null } });

    res.json({
      staff: result.rows[0]
    });
  } catch (error) {
    handleDbError(res, error, 'Staff update');
  }
});

router.delete('/staff/:id', requireAdmin, async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const adminUser = req.user as { id: string; email: string };

    const check = await client.query(
      `SELECT sm.id, sm.display_name_kanji, sm.display_name_kana, sm.email
       FROM staff_master sm WHERE sm.id = $1 AND sm.deleted_at IS NULL`,
      [id]
    );

    if (check.rows.length === 0) {
      sendNotFound(res, 'スタッフが見つかりません');
      return;
    }

    const staff = check.rows[0];

    await client.query('BEGIN');

    await client.query(
      `INSERT INTO admin_audit_logs (admin_email, action, target_type, target_id, payload_json)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        adminUser.email,
        'DELETE_STAFF',
        'staff_master',
        id,
        JSON.stringify({
          deleted_name_kanji: staff.display_name_kanji,
          deleted_name_kana: staff.display_name_kana,
          deleted_email: staff.email
        })
      ]
    );

    await client.query(
      `UPDATE cast_users SET deleted_at = NOW() WHERE staff_id = $1 AND deleted_at IS NULL`,
      [id]
    );
    await client.query(
      `UPDATE project_casts SET deleted_at = NOW() WHERE staff_id = $1 AND deleted_at IS NULL`,
      [id]
    );
    await client.query(
      `UPDATE staff_master SET deleted_at = NOW() WHERE id = $1`,
      [id]
    );

    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (error) {
    await client.query('ROLLBACK');
    handleDbError(res, error, 'Staff delete');
  } finally {
    client.release();
  }
});

router.get('/cast-users', requireAdmin, async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT cu.id, cu.email, cu.staff_id, cu.created_at, cu.updated_at,
              sm.display_name_kanji as name, sm.display_name_kanji as staff_name_kanji,
              sm.display_name_kana as staff_name_kana
       FROM cast_users cu
       LEFT JOIN staff_master sm ON cu.staff_id = sm.id
       WHERE cu.deleted_at IS NULL AND cu.email_verified = true
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
      `SELECT cu.email, sm.display_name_kanji as name
       FROM cast_users cu
       LEFT JOIN staff_master sm ON cu.staff_id = sm.id
       WHERE cu.id = $1 AND cu.deleted_at IS NULL`,
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

    await pool.query(`UPDATE cast_users SET deleted_at = NOW() WHERE id = $1`, [id]);

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
      `SELECT cu.email, cu.staff_id, sm.display_name_kanji as name
       FROM cast_users cu
       LEFT JOIN staff_master sm ON cu.staff_id = sm.id
       WHERE cu.id = $1 AND cu.deleted_at IS NULL`,
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
          old_value: { staff_id: currentUser.staff_id, name: currentUser.name },
          new_value: { staff_id: staff_id, name: staff_name_kanji },
          reason: reason || null
        })
      ]
    );

    const result = await pool.query(
      `UPDATE cast_users 
       SET staff_id = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2
       RETURNING id, email, staff_id`,
      [staff_id || null, id]
    );

    const updatedUser = result.rows[0];
    res.json({
      user: { ...updatedUser, name: staff_name_kanji, selected_staff_id: updatedUser.staff_id, selected_name_kanji: staff_name_kanji },
      audit_logged: true
    });
  } catch (error) {
    handleDbError(res, error, 'Cast user name update');
  }
});

// GET /api/admin/clients - クライアント一覧（projects内の未登録会社も自動追加）
router.get('/clients', requireAdmin, async (req: Request, res: Response) => {
  try {
    // normalization: auto-insert from projects removed (projects no longer store client_name_raw)

    const result = await pool.query(
      `SELECT id, name, name_normalized, emails, is_active, 
              contact_name, contact_title, contact_email, address,
              created_at, updated_at
       FROM clients
       WHERE deleted_at IS NULL
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
    const { name, contact_name, contact_title, contact_email, address, emails } = req.body;

    if (!name || !name.trim()) {
      sendBadRequest(res, '会社名は必須です');
      return;
    }

    if (contact_email && !isValidEmail(contact_email)) {
      sendBadRequest(res, '正しいメールアドレスを入力してください');
      return;
    }

    const emailList: string[] = Array.isArray(emails) ? emails : [];
    const invalidEmails = emailList.filter((e) => e && !isValidEmail(String(e)));
    if (invalidEmails.length > 0) {
      sendBadRequest(res, '無効なメールアドレスが含まれています', { invalid: invalidEmails });
      return;
    }

    const normalizedEmails = emailList
      .filter(Boolean)
      .map((e) => String(e).trim().toLowerCase());

    if (contact_email) {
      const normalizedContactEmail = contact_email.trim().toLowerCase();
      if (!normalizedEmails.includes(normalizedContactEmail)) {
        normalizedEmails.push(normalizedContactEmail);
      }
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
           contact_email = $5, emails = $6, address = $7, updated_at = CURRENT_TIMESTAMP
       WHERE id = $8
       RETURNING id, name, name_normalized, contact_name, contact_title, contact_email, address, emails, is_active, updated_at`,
      [name.trim(), nameNormalized, contact_name || null, contact_title || null, contact_email || null, normalizedEmails, address || null, id]
    );

    if (result.rows.length === 0) {
      sendNotFound(res, 'クライアントが見つかりません');
      return;
    }

    const adminUser = req.user as { email: string };
    logAudit({ req, actorEmail: adminUser.email, action: 'UPDATE_CLIENT', targetType: 'client', targetId: id, payload: { name: name.trim(), contact_name, contact_email } });

    res.json({
      client: result.rows[0]
    });
  } catch (error) {
    handleDbError(res, error, 'Client update');
  }
});

// DELETE /api/admin/clients/:id - クライアント削除
router.delete('/clients/:id', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const adminUser = req.user as { id: string; email: string };

    const currentResult = await pool.query(
      `SELECT name FROM clients WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );

    if (currentResult.rows.length === 0) {
      sendNotFound(res, '会社が見つかりません');
      return;
    }

    await pool.query(
      `INSERT INTO admin_audit_logs (admin_email, action, target_type, target_id, payload_json)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        adminUser.email,
        'DELETE_CLIENT',
        'client',
        id,
        JSON.stringify({ deleted_name: currentResult.rows[0].name })
      ]
    );

    await pool.query(`UPDATE clients SET deleted_at = NOW() WHERE id = $1`, [id]);

    res.json({ ok: true });
  } catch (error) {
    handleDbError(res, error, 'Client delete');
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

    const adminUser = req.user as { email: string };
    logAudit({ req, actorEmail: adminUser.email, action: 'CREATE_CLIENT', targetType: 'client', targetId: result.rows[0].id, payload: { name: name.trim() } });

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
      `SELECT c.name as client_name_raw, COUNT(*) as project_count
       FROM projects p
       JOIN clients c ON p.client_id = c.id
       WHERE p.status = 'pending_client'
       GROUP BY c.name
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
       SET status = 'active'
       WHERE client_id = $1 AND status = 'pending_client'
       RETURNING id`,
      [clientId]
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
       WHERE p.deleted_at IS NULL AND NOT EXISTS (
         SELECT 1 FROM project_casts pc WHERE pc.project_id = p.id AND pc.deleted_at IS NULL
       )`
    );
    const countToDelete = parseInt(countResult.rows[0].count, 10);

    if (countToDelete === 0) {
      res.json({ deleted: 0, message: 'キャストがいない案件はありません' });
      return;
    }

    const deleteResult = await pool.query(
      `UPDATE projects SET deleted_at = NOW()
       WHERE deleted_at IS NULL AND NOT EXISTS (
         SELECT 1 FROM project_casts pc WHERE pc.project_id = projects.id AND pc.deleted_at IS NULL
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
      `SELECT pc.id, pc.staff_no, pc.row_index, pc.staff_id,
              COALESCE(sm.display_name_kanji, 'No.' || pc.staff_no) as cast_name
       FROM project_casts pc
       LEFT JOIN staff_master sm ON pc.staff_id = sm.id
       WHERE pc.project_id = $1 AND pc.deleted_at IS NULL
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
    const { staff_no, cast_name, staff_id: castStaffId } = req.body;

    if (!staff_no) {
      sendBadRequest(res, 'staff_no は必須です');
      return;
    }

    const projectCheck = await pool.query('SELECT id FROM projects WHERE id = $1 AND deleted_at IS NULL', [projectId]);
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
      `INSERT INTO project_casts (project_id, staff_no, staff_id, row_index)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (project_id, staff_no) DO NOTHING
       RETURNING id, staff_no, staff_id, row_index`,
      [projectId, staff_no, castStaffId || null, nextRow]
    );

    if (result.rows.length === 0) {
      sendBadRequest(res, 'このキャストは既に割り当て済みです');
      return;
    }

    const castRow = result.rows[0];
    const staffNameResult = castStaffId ? await pool.query('SELECT display_name_kanji FROM staff_master WHERE id = $1', [castStaffId]) : { rows: [] };

    const adminUser = req.user as { email: string };
    logAudit({ req, actorEmail: adminUser.email, action: 'ADD_PROJECT_CAST', targetType: 'project_casts', targetId: castRow.id, payload: { project_id: projectId, staff_no, staff_id: castStaffId || null } });

    res.status(201).json({ cast: { ...castRow, cast_name: staffNameResult.rows[0]?.display_name_kanji || cast_name } });
  } catch (error) {
    handleDbError(res, error, 'Add project cast');
  }
});

router.delete('/projects/:projectId/casts/:castId', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { projectId, castId } = req.params;
    const result = await pool.query(
      'UPDATE project_casts SET deleted_at = NOW() WHERE id = $1 AND project_id = $2 AND deleted_at IS NULL RETURNING id',
      [castId, projectId]
    );
    if (result.rows.length === 0) {
      sendNotFound(res, 'キャスト割り当てが見つかりません');
      return;
    }

    const adminUser = req.user as { email: string };
    logAudit({ req, actorEmail: adminUser.email, action: 'DELETE_PROJECT_CAST', targetType: 'project_casts', targetId: castId, payload: { project_id: projectId } });

    res.json({ deleted: true });
  } catch (error) {
    handleDbError(res, error, 'Delete project cast');
  }
});

router.delete('/reports/:reportId', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { reportId } = req.params;
    const adminUser = req.user as { id: string; email: string };

    const current = await pool.query(
      `SELECT r.id, r.project_id, p.work_name, p.work_date, c.name as client_name
       FROM reports r
       JOIN projects p ON r.project_id = p.id
       LEFT JOIN clients c ON p.client_id = c.id
       WHERE r.id = $1 AND r.deleted_at IS NULL`,
      [reportId]
    );
    if (current.rows.length === 0) {
      sendNotFound(res, '報告書が見つかりません');
      return;
    }

    await pool.query(
      `INSERT INTO admin_audit_logs (admin_email, action, target_type, target_id, payload_json)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        adminUser.email,
        'DELETE_REPORT',
        'report',
        reportId,
        JSON.stringify({
          project_id: current.rows[0].project_id,
          work_name: current.rows[0].work_name,
          work_date: current.rows[0].work_date,
          client_name: current.rows[0].client_name
        })
      ]
    );

    const result = await pool.query(
      'UPDATE reports SET deleted_at = NOW() WHERE id = $1 RETURNING id, project_id',
      [reportId]
    );
    res.json({ deleted: true, report: result.rows[0] });
  } catch (error) {
    handleDbError(res, error, 'Delete report');
  }
});

export default router;
