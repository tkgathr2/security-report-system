/**
 * 会社ごとの通知先メール管理 API
 * GET    /api/admin/companies/:companyId/emails     - 通知先一覧取得
 * POST   /api/admin/companies/:companyId/emails     - 通知先追加
 * DELETE /api/admin/companies/:companyId/emails/:id - 通知先削除（論理削除）
 */
import { Router, Request, Response } from 'express';
import pool from '../db/pool';
import { requireAdmin } from '../middleware/auth';
import { isValidEmail } from '../utils/validation';
import { logAudit } from '../utils/auditLog';
import { handleDbError } from '../utils/errorHandler';

const router = Router();

// GET /api/admin/companies/:companyId/emails
router.get('/:companyId/emails', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { companyId } = req.params;

    // 会社の存在確認
    const companyCheck = await pool.query(
      'SELECT id, name FROM clients WHERE id = $1 AND deleted_at IS NULL',
      [companyId]
    );
    if (companyCheck.rows.length === 0) {
      res.status(404).json({ error: 'NOT_FOUND', message: '会社が見つかりません' });
      return;
    }

    const result = await pool.query(
      `SELECT id, email, label, is_active, created_at, updated_at
       FROM company_emails
       WHERE company_id = $1 AND deleted_at IS NULL
       ORDER BY created_at ASC`,
      [companyId]
    );

    res.json({
      company_id: companyId,
      company_name: companyCheck.rows[0].name,
      emails: result.rows,
      total: result.rows.length,
    });
  } catch (error) {
    handleDbError(res, error, 'Company emails list');
  }
});

// POST /api/admin/companies/:companyId/emails
router.post('/:companyId/emails', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { companyId } = req.params;
    const { email, label } = req.body;

    // バリデーション
    if (!email || typeof email !== 'string') {
      res.status(400).json({ error: 'BAD_REQUEST', message: 'メールアドレスは必須です' });
      return;
    }

    const trimmedEmail = email.trim().toLowerCase();
    if (!isValidEmail(trimmedEmail)) {
      res.status(400).json({ error: 'BAD_REQUEST', message: 'メールアドレスの形式が不正です' });
      return;
    }

    // 会社の存在確認
    const companyCheck = await pool.query(
      'SELECT id, name FROM clients WHERE id = $1 AND deleted_at IS NULL',
      [companyId]
    );
    if (companyCheck.rows.length === 0) {
      res.status(404).json({ error: 'NOT_FOUND', message: '会社が見つかりません' });
      return;
    }

    // 重複チェック（ユニーク制約でも守るが、わかりやすいエラーメッセージのため先にチェック）
    const dupCheck = await pool.query(
      'SELECT id FROM company_emails WHERE company_id = $1 AND email = $2 AND deleted_at IS NULL',
      [companyId, trimmedEmail]
    );
    if (dupCheck.rows.length > 0) {
      res.status(409).json({ error: 'CONFLICT', message: 'このメールアドレスは既に登録されています' });
      return;
    }

    const result = await pool.query(
      `INSERT INTO company_emails (company_id, email, label)
       VALUES ($1, $2, $3)
       RETURNING id, email, label, is_active, created_at`,
      [companyId, trimmedEmail, label?.trim() || null]
    );

    const adminUser = req.user as { email: string };
    logAudit({
      req,
      actorEmail: adminUser.email,
      action: 'ADD_COMPANY_EMAIL',
      targetType: 'company_email',
      targetId: result.rows[0].id,
      payload: { company_id: companyId, email: trimmedEmail, label: label || null },
    });

    res.status(201).json({
      ok: true,
      email: result.rows[0],
    });
  } catch (error) {
    handleDbError(res, error, 'Add company email');
  }
});

// DELETE /api/admin/companies/:companyId/emails/:id
router.delete('/:companyId/emails/:id', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { companyId, id } = req.params;

    const result = await pool.query(
      `UPDATE company_emails
       SET deleted_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL
       RETURNING id, email`,
      [id, companyId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'NOT_FOUND', message: '通知先メールが見つかりません' });
      return;
    }

    const adminUser = req.user as { email: string };
    logAudit({
      req,
      actorEmail: adminUser.email,
      action: 'DELETE_COMPANY_EMAIL',
      targetType: 'company_email',
      targetId: id,
      payload: { company_id: companyId, email: result.rows[0].email },
    });

    res.json({ ok: true, deleted: result.rows[0] });
  } catch (error) {
    handleDbError(res, error, 'Delete company email');
  }
});

export default router;
