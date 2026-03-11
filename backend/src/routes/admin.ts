import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import pool from '../db/pool';
import { requireAdmin } from '../middleware/auth';
import { sendUnauthorized, sendNotFound, sendBadRequest, handleDbError } from '../utils/errorHandler';
import { isValidEmail, validateStringField, validateArrayItems, MAX_LENGTHS } from '../utils/validation';
import { logAudit } from '../utils/auditLog';
import { sendLoginUrlEmail } from '../utils/email';

const AUTH_SECRET = process.env.AUTH_SECRET || (process.env.NODE_ENV === 'production' ? '' : 'dev-secret-key');

const upload = multer({ storage: multer.memoryStorage() });

const router = Router();

function requireSuperAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.isAuthenticated || !req.isAuthenticated() || !req.user) {
    res.status(401).json({ error: 'UNAUTHORIZED', message: '管理者セッションがありません' });
    return;
  }
  const user = req.user as Express.User;
  if (user.role !== 'super_admin') {
    res.status(403).json({ error: 'FORBIDDEN', message: 'スーパー管理者権限が必要です' });
    return;
  }
  next();
}

function normalizeClientName(name: string): string {
  return name
    .replace(/株式会社|有限会社|合同会社/g, '')
    .replace(/[㈱㈲]/g, '')
    .replace(/[（\(]株[）\)]/g, '')
    .replace(/[（\(]有[）\)]/g, '')
    .replace(/[（\(]合[）\)]/g, '')
    .replace(/[\s　]+/g, '')
    .toLowerCase()
    .trim();
}

function isEmptyClientName(name: string | undefined | null): boolean {
  if (!name) return true;

  const trimmed = String(name).replace(/[\s　]+/g, '').trim();
  if (trimmed === '') return true;
  if (/^[-ー－―]+$/.test(trimmed)) return true;

  const normalized = normalizeClientName(String(name));
  if (normalized === '') return true;

  return false;
}

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
       LEFT JOIN project_casts pc ON pc.project_id = p.id AND pc.deleted_at IS NULL
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
       LEFT JOIN project_casts pc ON pc.project_id = p.id AND pc.deleted_at IS NULL
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
       LEFT JOIN project_casts pc ON pc.project_id = p.id AND pc.deleted_at IS NULL
       LEFT JOIN staff_master sm_pc ON pc.staff_id = sm_pc.id
       WHERE p.deleted_at IS NULL
       GROUP BY ${groupBy}
       ORDER BY p.work_date DESC, p.created_at DESC
       LIMIT $1 OFFSET $2`;
      const limit = Math.min(Math.max(parseInt(String(req.query.limit)) || 100, 1), 500);
      const offset = Math.max(parseInt(String(req.query.offset)) || 0, 0);
      params = [String(limit), String(offset)];
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
              CASE WHEN sm.email IS NOT NULL AND sm.email != '' THEN sm.email WHEN sm.email = '' THEN NULL ELSE cu.email END as registered_email, cu.id as cast_user_id,
              CASE WHEN cu.pin_hash IS NOT NULL THEN true ELSE false END as has_pin
       FROM staff_master sm
       LEFT JOIN LATERAL (
         SELECT cu0.id, cu0.email, cu0.pin_hash FROM cast_users cu0
         WHERE cu0.staff_id = sm.id AND cu0.deleted_at IS NULL
         ORDER BY cu0.email_verified DESC, cu0.updated_at DESC LIMIT 1
       ) cu ON true
       WHERE sm.deleted_at IS NULL
       UNION ALL
       SELECT cu2.id, cu2.email as display_name_kanji, cu2.email as display_name_kana, cu2.email, cu2.created_at, cu2.updated_at,
              cu2.email as registered_email, cu2.id as cast_user_id,
              true as has_pin
       FROM cast_users cu2
       WHERE cu2.deleted_at IS NULL AND cu2.email_verified = true AND cu2.pin_hash IS NOT NULL
         AND cu2.staff_id IS NULL
       ORDER BY display_name_kana
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
    const kanjiErr = validateStringField(display_name_kanji, '漢字名', MAX_LENGTHS.PERSON_NAME);
    if (kanjiErr) { sendBadRequest(res, kanjiErr); return; }
    const kanaErr = validateStringField(display_name_kana, 'カタカナ名', MAX_LENGTHS.PERSON_NAME);
    if (kanaErr) { sendBadRequest(res, kanaErr); return; }

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
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { display_name_kanji, display_name_kana, email: rawEmail } = req.body;

    if (!display_name_kanji || !display_name_kana) {
      sendBadRequest(res, '漢字名とカタカナ名は必須です');
      return;
    }
    const kanjiErr2 = validateStringField(display_name_kanji, '漢字名', MAX_LENGTHS.PERSON_NAME);
    if (kanjiErr2) { sendBadRequest(res, kanjiErr2); return; }
    const kanaErr2 = validateStringField(display_name_kana, 'カタカナ名', MAX_LENGTHS.PERSON_NAME);
    if (kanaErr2) { sendBadRequest(res, kanaErr2); return; }

    const email = typeof rawEmail === 'string' && rawEmail.trim() !== '' ? rawEmail.trim().toLowerCase() : '';

    if (email && !isValidEmail(email)) {
      sendBadRequest(res, '正しいメールアドレスを入力してください');
      return;
    }

    await client.query('BEGIN');

    const result = await client.query(
      `UPDATE staff_master
       SET display_name_kanji = $1, display_name_kana = $2, email = $3, updated_at = CURRENT_TIMESTAMP
       WHERE id = $4
       RETURNING id, display_name_kanji, display_name_kana, email, updated_at`,
      [display_name_kanji, display_name_kana, email, id]
    );

    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      sendNotFound(res, 'スタッフが見つかりません');
      return;
    }

    if (email) {
      const emailConflict = await client.query(
        `SELECT id FROM cast_users WHERE email = $1 AND deleted_at IS NULL AND staff_id IS DISTINCT FROM $2 LIMIT 1`,
        [email, id]
      );
      if (emailConflict.rows.length > 0) {
        await client.query('ROLLBACK');
        sendBadRequest(res, 'このメールアドレスは既に他のキャストに使用されています');
        return;
      }
      await client.query(
        `UPDATE cast_users SET email = $1, updated_at = CURRENT_TIMESTAMP
         WHERE id = (
           SELECT id FROM cast_users
           WHERE staff_id = $2 AND deleted_at IS NULL
           ORDER BY updated_at DESC LIMIT 1
         )`,
        [email, id]
      );
    }

    await client.query('COMMIT');

    const adminUser = req.user as { email: string };
    logAudit({ req, actorEmail: adminUser.email, action: 'UPDATE_STAFF', targetType: 'staff_master', targetId: id, payload: { display_name_kanji, display_name_kana, email: email || null } });

    res.json({
      staff: result.rows[0]
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    const pgError = error as { code?: string };
    if (pgError.code === '23505') {
      sendBadRequest(res, 'このメールアドレスは既に使用されています');
    } else {
      handleDbError(res, error, 'Staff update');
    }
  } finally {
    client.release();
  }
});

router.post('/staff/:id/clear-pin', requireSuperAdmin, async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;

    await client.query('BEGIN');

    const castUserResult = await client.query(
      `SELECT id FROM cast_users
       WHERE staff_id = $1 AND deleted_at IS NULL
       ORDER BY email_verified DESC, updated_at DESC
       LIMIT 1`,
      [id]
    );

    if (castUserResult.rows.length === 0) {
      await client.query('ROLLBACK');
      sendNotFound(res, '対象キャストユーザーが見つかりません');
      return;
    }

    const castUserId = castUserResult.rows[0].id as string;

    await client.query(
      `UPDATE cast_users
       SET pin_hash = NULL,
           pin_reset_token = NULL,
           pin_reset_token_expires = NULL,
           magic_link_token = NULL,
           magic_link_expires = NULL,
           updated_at = NOW()
       WHERE id = $1`,
      [castUserId]
    );

    const adminUser = req.user as { email: string };
    logAudit({ req, actorEmail: adminUser.email, action: 'CLEAR_CAST_PIN', targetType: 'cast_user', targetId: castUserId, payload: { staff_id: id } });

    await client.query('COMMIT');

    res.json({ ok: true });
  } catch (error) {
    await client.query('ROLLBACK');
    handleDbError(res, error, 'Clear cast pin');
  } finally {
    client.release();
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

    const nameErr = validateStringField(staff_name_kanji, 'スタッフ名', MAX_LENGTHS.PERSON_NAME);
    if (nameErr) { sendBadRequest(res, nameErr); return; }
    const reasonErr = validateStringField(reason, '理由', MAX_LENGTHS.REASON);
    if (reasonErr) { sendBadRequest(res, reasonErr); return; }

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

// POST /api/admin/cast-users/:id/test-token - テスト用キャスト認証トークン発行（管理者限定・TEST_対象限定）
router.post('/cast-users/:id/test-token', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const adminUser = req.user as { email: string };

    const castResult = await pool.query(
      `SELECT cu.id, cu.email, cu.staff_id
       FROM cast_users cu
       WHERE cu.id = $1 AND cu.deleted_at IS NULL`,
      [id]
    );

    if (castResult.rows.length === 0) {
      sendNotFound(res, 'キャストユーザーが見つかりません');
      return;
    }

    const castUser = castResult.rows[0];

    const isTestEmail = castUser.email.toLowerCase().startsWith('test_');

    let isTestClient = false;
    if (castUser.staff_id) {
      const testCheck = await pool.query(
        `SELECT 1 FROM project_casts pc
         JOIN projects p ON pc.project_id = p.id
         JOIN clients c ON p.client_id = c.id
         WHERE pc.staff_id = $1 AND c.name LIKE 'TEST_%' AND p.deleted_at IS NULL
         LIMIT 1`,
        [castUser.staff_id]
      );
      isTestClient = testCheck.rows.length > 0;
    }

    if (!isTestEmail && !isTestClient) {
      sendBadRequest(res, 'TEST_対象のキャストユーザーのみトークン発行可能です');
      return;
    }

    const magicToken = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await pool.query(
      `UPDATE cast_users
       SET magic_link_token = $1, magic_link_expires = $2, email_verified = true, last_login_at = NOW()
       WHERE id = $3`,
      [magicToken, expires, id]
    );

    const jwtToken = jwt.sign(
      { userId: castUser.id, email: castUser.email },
      AUTH_SECRET,
      { expiresIn: '7d' }
    );

    logAudit({
      req,
      actorEmail: adminUser.email,
      action: 'ISSUE_TEST_TOKEN',
      targetType: 'cast_user',
      targetId: id,
      payload: { cast_email: castUser.email, reason: 'E2E test token issuance' }
    });

    res.json({
      ok: true,
      cast_user_id: id,
      cast_email: castUser.email,
      jwt: jwtToken,
      magic_link_token: magicToken,
      expires: expires.toISOString()
    });
  } catch (error) {
    handleDbError(res, error, 'Test token issue');
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

    if (isEmptyClientName(name)) {
      sendBadRequest(res, '会社名は必須です');
      return;
    }
    const clientNameErr = validateStringField(name, '会社名', MAX_LENGTHS.COMPANY_NAME);
    if (clientNameErr) { sendBadRequest(res, clientNameErr); return; }
    const contactNameErr = validateStringField(contact_name, '担当者名', MAX_LENGTHS.PERSON_NAME);
    if (contactNameErr) { sendBadRequest(res, contactNameErr); return; }
    const titleErr = validateStringField(contact_title, '役職', MAX_LENGTHS.CONTACT_TITLE);
    if (titleErr) { sendBadRequest(res, titleErr); return; }
    const addrErr = validateStringField(address, '住所', MAX_LENGTHS.ADDRESS);
    if (addrErr) { sendBadRequest(res, addrErr); return; }

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

    const nameNormalized = normalizeClientName(name);

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

// POST /api/admin/maintenance/cleanup-invalid-clients - 会社名が空/「-」の不正データの論理削除
router.post('/maintenance/cleanup-invalid-clients', requireAdmin, async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    const adminUser = req.user as { email: string };
    await client.query('BEGIN');

    const invalidClients = await client.query(
      `SELECT id, name, name_normalized
       FROM clients
       WHERE deleted_at IS NULL
         AND (
           regexp_replace(name, '[\\s　]+', '', 'g') = ''
           OR regexp_replace(name, '[\\s　]+', '', 'g') ~ '^[-ー－―]+$'
           OR name_normalized = ''
         )
       ORDER BY created_at ASC
       LIMIT 500`
    );

    if (invalidClients.rows.length === 0) {
      await client.query('COMMIT');
      res.json({ ok: true, deleted_clients_count: 0, deleted_projects_count: 0, deleted_reports_count: 0 });
      return;
    }

    const invalidClientIds = invalidClients.rows.map(r => r.id);

    const castDel = await client.query(
      `UPDATE project_casts
       SET deleted_at = NOW()
       WHERE deleted_at IS NULL
         AND project_id IN (
           SELECT id FROM projects WHERE deleted_at IS NULL AND client_id = ANY($1)
         )`,
      [invalidClientIds]
    );

    const reportsDel = await client.query(
      `UPDATE reports
       SET deleted_at = NOW()
       WHERE deleted_at IS NULL
         AND project_id IN (
           SELECT id FROM projects WHERE deleted_at IS NULL AND client_id = ANY($1)
         )`,
      [invalidClientIds]
    );

    const projectsDel = await client.query(
      `UPDATE projects
       SET deleted_at = NOW()
       WHERE deleted_at IS NULL AND client_id = ANY($1)`,
      [invalidClientIds]
    );

    const clientsDel = await client.query(
      `UPDATE clients
       SET deleted_at = NOW()
       WHERE deleted_at IS NULL AND id = ANY($1)`,
      [invalidClientIds]
    );

    await client.query('COMMIT');

    try {
      logAudit({
        req,
        actorEmail: adminUser.email,
        action: 'CLEANUP_INVALID_CLIENTS',
        targetType: 'client',
        targetId: undefined,
        payload: {
          deleted_clients_count: clientsDel.rowCount,
          deleted_projects_count: projectsDel.rowCount,
          deleted_reports_count: reportsDel.rowCount,
          deleted_project_casts_count: castDel.rowCount,
          sample: invalidClients.rows.slice(0, 10)
        }
      });
    } catch {
      // ignore audit log errors
    }

    res.json({
      ok: true,
      deleted_clients_count: clientsDel.rowCount,
      deleted_projects_count: projectsDel.rowCount,
      deleted_reports_count: reportsDel.rowCount,
      deleted_project_casts_count: castDel.rowCount
    });
  } catch (error) {
    await client.query('ROLLBACK');
    handleDbError(res, error, 'Cleanup invalid clients');
  } finally {
    client.release();
  }
});

// POST /api/admin/clients - クライアント登録
router.post('/clients', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { name, emails } = req.body;

    if (isEmptyClientName(name)) {
      sendBadRequest(res, '会社名は必須です');
      return;
    }
    const createClientNameErr = validateStringField(name, '会社名', MAX_LENGTHS.COMPANY_NAME);
    if (createClientNameErr) { sendBadRequest(res, createClientNameErr); return; }

    const emailList: string[] = Array.isArray(emails) ? emails.filter((e: string) => e && typeof e === 'string' && e.trim()) : [];
    const invalidClientEmails = emailList.filter((e: string) => !isValidEmail(String(e)));
    if (invalidClientEmails.length > 0) {
      sendBadRequest(res, '無効なメールアドレスが含まれています', { invalid: invalidClientEmails });
      return;
    }
    const normalizedClientEmails = emailList.map((e: string) => String(e).trim().toLowerCase());

    const nameNormalized = normalizeClientName(name);

    const result = await pool.query(
      `INSERT INTO clients (name, name_normalized, emails, is_active)
       VALUES ($1, $2, $3, true)
       RETURNING id, name, name_normalized, emails, is_active, created_at`,
      [name.trim(), nameNormalized, normalizedClientEmails]
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

    if (isEmptyClientName(client_name_raw)) {
      sendBadRequest(res, '会社名は必須です');
      return;
    }
    const regClientNameErr = validateStringField(client_name_raw, '会社名', MAX_LENGTHS.COMPANY_NAME);
    if (regClientNameErr) { sendBadRequest(res, regClientNameErr); return; }

    const nameNormalized = normalizeClientName(client_name_raw);

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
        'SELECT id, display_name_kanji, deleted_at FROM staff_master WHERE display_name_kana = $1',
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
      } else if (existing.rows[0].deleted_at) {
        // soft-deleted → 復活
        await pool.query(
          'UPDATE staff_master SET display_name_kanji = COALESCE(NULLIF($1, \'\'), display_name_kanji), deleted_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
          [nameKanji, existing.rows[0].id]
        );
        updated++;
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

    const deletedIds = deleteResult.rows.map((r: { id: string }) => r.id);
    const deletedCount = deletedIds.length;

    if (deletedCount > 0) {
      await pool.query(
        `UPDATE project_casts SET deleted_at = NOW() WHERE project_id = ANY($1) AND deleted_at IS NULL`,
        [deletedIds]
      );
    }

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
    const staffNoErr = validateStringField(staff_no, 'staff_no', MAX_LENGTHS.STAFF_NO);
    if (staffNoErr) { sendBadRequest(res, staffNoErr); return; }

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

    const ALLOWED_DELETE_EMAILS = ['atsuhiro@takagi.bz'];
    if (!ALLOWED_DELETE_EMAILS.includes(adminUser.email.toLowerCase())) {
      res.status(403).json({ error: 'FORBIDDEN', message: '報告書の削除権限がありません' });
      return;
    }

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

router.post('/reports/bulk-delete', requireAdmin, async (req: Request, res: Response) => {
  try {
    const adminUser = req.user as { id: string; email: string };

    const ALLOWED_DELETE_EMAILS = ['atsuhiro@takagi.bz'];
    if (!ALLOWED_DELETE_EMAILS.includes(adminUser.email.toLowerCase())) {
      res.status(403).json({ error: 'FORBIDDEN', message: '報告書の削除権限がありません' });
      return;
    }

    const { reportIds } = req.body;
    if (!Array.isArray(reportIds) || reportIds.length === 0) {
      sendBadRequest(res, '削除する報告書IDが必要です');
      return;
    }
    if (reportIds.length > 50) {
      sendBadRequest(res, '一度に削除できるのは50件までです');
      return;
    }

    const current = await pool.query(
      `SELECT r.id, r.project_id, p.work_name, p.work_date, c.name as client_name
       FROM reports r
       JOIN projects p ON r.project_id = p.id
       LEFT JOIN clients c ON p.client_id = c.id
       WHERE r.id = ANY($1) AND r.deleted_at IS NULL`,
      [reportIds]
    );

    for (const row of current.rows) {
      await pool.query(
        `INSERT INTO admin_audit_logs (admin_email, action, target_type, target_id, payload_json)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          adminUser.email,
          'DELETE_REPORT',
          'report',
          row.id,
          JSON.stringify({
            project_id: row.project_id,
            work_name: row.work_name,
            work_date: row.work_date,
            client_name: row.client_name,
            bulk: true
          })
        ]
      );
    }

    const result = await pool.query(
      'UPDATE reports SET deleted_at = NOW() WHERE id = ANY($1) AND deleted_at IS NULL RETURNING id',
      [reportIds]
    );
    res.json({ deleted: true, count: result.rowCount });
  } catch (error) {
    handleDbError(res, error, 'Bulk delete reports');
  }
});

const ensureSettingsTable = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
};

router.get('/settings/pdf-layout', requireAdmin, async (_req: Request, res: Response) => {
  try {
    await ensureSettingsTable();
    const result = await pool.query(
      `SELECT value FROM system_settings WHERE key = 'pdf_layout'`
    );
    const layout = result.rows.length > 0 ? result.rows[0].value : 'classic';
    const designResult = await pool.query(
      `SELECT value FROM system_settings WHERE key = 'pdf_design'`
    );
    const design = designResult.rows.length > 0 ? designResult.rows[0].value : 'A';
    res.json({ layout, design });
  } catch (error) {
    handleDbError(res, error, 'Get PDF layout setting');
  }
});

router.put('/settings/pdf-layout', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { layout, design } = req.body;
    const validLayouts = ['classic', 'handwritten'];
    const validDesigns = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
    if (layout && !validLayouts.includes(layout)) {
      sendBadRequest(res, `レイアウトは ${validLayouts.join(', ')} のいずれかを指定してください`);
      return;
    }
    if (design && !validDesigns.includes(design)) {
      sendBadRequest(res, `デザインは ${validDesigns.join(', ')} のいずれかを指定してください`);
      return;
    }
    await ensureSettingsTable();
    if (layout) {
      await pool.query(
        `INSERT INTO system_settings (key, value, updated_at) VALUES ('pdf_layout', $1, NOW())
         ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
        [layout]
      );
    }
    if (design) {
      await pool.query(
        `INSERT INTO system_settings (key, value, updated_at) VALUES ('pdf_design', $1, NOW())
         ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
        [design]
      );
    }
    const adminUser = req.user as { email: string };
    logAudit({ req, actorEmail: adminUser.email, action: 'UPDATE_PDF_SETTINGS', targetType: 'system_settings', targetId: 'pdf_layout', payload: { layout, design } });
    res.json({ ok: true, layout: layout || undefined, design: design || undefined });
  } catch (error) {
    handleDbError(res, error, 'Update PDF layout setting');
  }
});

router.post('/send-login-url', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { email, staff_id } = req.body;
    const adminUser = req.user as { id: string; email: string };

    let targetEmail: string | null = null;
    let targetName: string | null = null;
    let isRegistered = false;

    if (staff_id) {
      const result = await pool.query(
        `SELECT sm.display_name_kanji as name,
                CASE WHEN sm.email = '' THEN NULL ELSE sm.email END as sm_email,
                cu.email as cu_email
         FROM staff_master sm
         LEFT JOIN cast_users cu ON cu.staff_id = sm.id AND cu.email_verified = true AND cu.deleted_at IS NULL
         WHERE sm.id = $1 AND sm.deleted_at IS NULL`,
        [staff_id]
      );
      if (result.rows.length === 0) {
        sendNotFound(res, 'スタッフが見つかりません');
        return;
      }
      targetName = result.rows[0].name;
      isRegistered = !!result.rows[0].cu_email;

      if (email) {
        const normalizedEmail = String(email).trim().toLowerCase();
        const emailErr = isValidEmail(normalizedEmail) ? null : 'メールアドレスの形式が正しくありません';
        if (emailErr) { sendBadRequest(res, emailErr); return; }
        targetEmail = normalizedEmail;

        await pool.query(
          `UPDATE staff_master SET email = $1, updated_at = CURRENT_TIMESTAMP
           WHERE id = $2 AND (email IS NULL OR email = '')`,
          [normalizedEmail, staff_id]
        );

        const existingCu = await pool.query(
          'SELECT id, staff_id FROM cast_users WHERE email = $1 AND deleted_at IS NULL',
          [normalizedEmail]
        );
        if (existingCu.rows.length > 0) {
          if (!existingCu.rows[0].staff_id) {
            await pool.query(
              'UPDATE cast_users SET staff_id = $1, updated_at = NOW() WHERE id = $2',
              [staff_id, existingCu.rows[0].id]
            );
          }
          isRegistered = true;
        }
      } else {
        targetEmail = result.rows[0].cu_email || result.rows[0].sm_email;
      }
    } else if (email) {
      const normalizedEmail = String(email).trim().toLowerCase();
      const emailErr = isValidEmail(normalizedEmail) ? null : 'メールアドレスの形式が正しくありません';
      if (emailErr) { sendBadRequest(res, emailErr); return; }

      targetEmail = normalizedEmail;
      targetName = null;
      isRegistered = false;
    } else {
      sendBadRequest(res, 'メールアドレスまたはスタッフIDが必要です');
      return;
    }

    if (!targetEmail) {
      sendBadRequest(res, 'このスタッフにはメールアドレスが登録されていません');
      return;
    }

    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const loginUrl = isRegistered
      ? `${protocol}://${host}/cast/login`
      : `${protocol}://${host}/cast/register`;

    const emailResult = await sendLoginUrlEmail(targetEmail, targetName || '', loginUrl, isRegistered);

    if (!emailResult.success) {
      res.status(500).json({ message: 'メール送信に失敗しました', error: emailResult.error });
      return;
    }

    logAudit({ req, actorEmail: adminUser.email, action: 'SEND_LOGIN_URL', targetType: 'cast_user', targetId: targetEmail, payload: { email: targetEmail, name: targetName, staff_id: staff_id || null } });

    res.json({ ok: true, message: `${targetEmail} にアクセスURLを送信しました` });
  } catch (error) {
    handleDbError(res, error, 'Send login URL');
  }
});

router.get('/inquiries', requireAdmin, async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT id, cast_user_id, cast_email, cast_name, category, message, status,
              screenshot_mime_type IS NOT NULL as has_screenshot, created_at
       FROM inquiries ORDER BY created_at DESC`
    );
    res.json({ inquiries: result.rows });
  } catch (error) {
    handleDbError(res, error, 'Fetch inquiries');
  }
});

router.get('/inquiries/:id/screenshot', requireAdmin, async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT screenshot_bytes, screenshot_mime_type FROM inquiries WHERE id = $1`,
      [req.params.id]
    );
    if (result.rows.length === 0 || !result.rows[0].screenshot_bytes) {
      sendNotFound(res, 'スクリーンショットが見つかりません');
      return;
    }
    res.setHeader('Content-Type', result.rows[0].screenshot_mime_type);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(result.rows[0].screenshot_bytes);
  } catch (error) {
    handleDbError(res, error, 'Fetch inquiry screenshot');
  }
});

router.put('/inquiries/:id/status', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { status } = req.body;
    const validStatuses = ['new', 'read', 'resolved'];
    if (!validStatuses.includes(status)) {
      sendBadRequest(res, '無効なステータスです');
      return;
    }
    const result = await pool.query(
      `UPDATE inquiries SET status = $1 WHERE id = $2 RETURNING id`,
      [status, req.params.id]
    );
    if (result.rows.length === 0) {
      sendNotFound(res, '問合せが見つかりません');
      return;
    }
    const adminUser = req.user as { email: string };
    logAudit({ req, actorEmail: adminUser.email, action: 'UPDATE_INQUIRY_STATUS', targetType: 'inquiry', targetId: req.params.id, payload: { status } });
    res.json({ ok: true });
  } catch (error) {
    handleDbError(res, error, 'Update inquiry status');
  }
});

router.post('/bulk-cleanup', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { since_date, delete_casts } = req.body;
    if (!since_date) {
      res.status(400).json({ error: 'since_date is required (YYYY-MM-DD)' });
      return;
    }
    const adminUser = req.user as { email: string };
    const results: Record<string, number> = {};

    const reportsDel = await pool.query(
      `UPDATE reports SET deleted_at = NOW()
       WHERE deleted_at IS NULL AND project_id IN (
         SELECT id FROM projects WHERE work_date >= $1 AND deleted_at IS NULL
       ) RETURNING id`,
      [since_date]
    );
    results.reports_deleted = reportsDel.rowCount || 0;

    const castsDel = await pool.query(
      `UPDATE project_casts SET deleted_at = NOW()
       WHERE deleted_at IS NULL AND project_id IN (
         SELECT id FROM projects WHERE work_date >= $1 AND deleted_at IS NULL
       ) RETURNING id`,
      [since_date]
    );
    results.project_casts_deleted = castsDel.rowCount || 0;

    const projectsDel = await pool.query(
      `UPDATE projects SET deleted_at = NOW()
       WHERE work_date >= $1 AND deleted_at IS NULL RETURNING id`,
      [since_date]
    );
    results.projects_deleted = projectsDel.rowCount || 0;

    if (delete_casts) {
      const staffDel = await pool.query(
        `UPDATE staff_master SET deleted_at = NOW()
         WHERE deleted_at IS NULL RETURNING id`
      );
      results.staff_deleted = staffDel.rowCount || 0;

      const castUsersDel = await pool.query(
        `UPDATE cast_users SET deleted_at = NOW()
         WHERE deleted_at IS NULL RETURNING id`
      );
      results.cast_users_deleted = castUsersDel.rowCount || 0;
    }

    await pool.query(
      `INSERT INTO admin_audit_logs (admin_email, action, target_type, payload_json)
       VALUES ($1, $2, $3, $4)`,
      [adminUser.email, 'BULK_CLEANUP', 'projects', JSON.stringify({ since_date, delete_casts, results })]
    );

    res.json({ ok: true, results });
  } catch (error) {
    handleDbError(res, error, 'Bulk cleanup');
  }
});

export default router;
