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

// 1社あたりの通知先メール登録上限
const MAX_EMAILS_PER_COMPANY = 20;
// Postgres UNIQUE制約違反のエラーコード
const PG_UNIQUE_VIOLATION = '23505';

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

    // 件数上限チェック（1社あたり MAX_EMAILS_PER_COMPANY 件まで）
    const countCheck = await pool.query(
      'SELECT COUNT(*)::int AS cnt FROM company_emails WHERE company_id = $1 AND deleted_at IS NULL',
      [companyId]
    );
    if (countCheck.rows[0].cnt >= MAX_EMAILS_PER_COMPANY) {
      res.status(400).json({
        error: 'BAD_REQUEST',
        message: `通知先メールは1社あたり${MAX_EMAILS_PER_COMPANY}件までです`,
      });
      return;
    }

    let result;
    try {
      result = await pool.query(
        `INSERT INTO company_emails (company_id, email, label)
         VALUES ($1, $2, $3)
         RETURNING id, email, label, is_active, created_at`,
        [companyId, trimmedEmail, label?.trim() || null]
      );
    } catch (insertErr) {
      // 並行リクエストでUNIQUE制約違反になった場合は409 CONFLICTを返す（500にしない）
      if ((insertErr as { code?: string }).code === PG_UNIQUE_VIOLATION) {
        res.status(409).json({ error: 'CONFLICT', message: 'このメールアドレスは既に登録されています' });
        return;
      }
      throw insertErr;
    }

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

// PATCH /api/admin/companies/:companyId/emails/:emailId
// is_active トグル / label・email 編集
router.patch('/:companyId/emails/:emailId', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { companyId, emailId } = req.params;
    const { email, label, is_active } = req.body as {
      email?: unknown;
      label?: unknown;
      is_active?: unknown;
    };

    // 少なくとも1つの更新項目が必要
    if (email === undefined && label === undefined && is_active === undefined) {
      res.status(400).json({ error: 'BAD_REQUEST', message: '更新する項目がありません' });
      return;
    }

    // 対象の存在確認
    const existing = await pool.query(
      'SELECT id, email FROM company_emails WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL',
      [emailId, companyId]
    );
    if (existing.rows.length === 0) {
      res.status(404).json({ error: 'NOT_FOUND', message: '通知先メールが見つかりません' });
      return;
    }

    const sets: string[] = [];
    const values: (string | boolean | null)[] = [];
    let idx = 1;

    if (email !== undefined) {
      if (typeof email !== 'string') {
        res.status(400).json({ error: 'BAD_REQUEST', message: 'メールアドレスの形式が不正です' });
        return;
      }
      const trimmedEmail = email.trim().toLowerCase();
      if (!isValidEmail(trimmedEmail)) {
        res.status(400).json({ error: 'BAD_REQUEST', message: 'メールアドレスの形式が不正です' });
        return;
      }
      // 重複チェック（自分自身は除外）
      const dupCheck = await pool.query(
        'SELECT id FROM company_emails WHERE company_id = $1 AND email = $2 AND id <> $3 AND deleted_at IS NULL',
        [companyId, trimmedEmail, emailId]
      );
      if (dupCheck.rows.length > 0) {
        res.status(409).json({ error: 'CONFLICT', message: 'このメールアドレスは既に登録されています' });
        return;
      }
      sets.push(`email = $${idx++}`);
      values.push(trimmedEmail);
    }

    if (label !== undefined) {
      if (label !== null && typeof label !== 'string') {
        res.status(400).json({ error: 'BAD_REQUEST', message: 'ラベルの形式が不正です' });
        return;
      }
      sets.push(`label = $${idx++}`);
      values.push((typeof label === 'string' ? label.trim() : '') || null);
    }

    if (is_active !== undefined) {
      if (typeof is_active !== 'boolean') {
        res.status(400).json({ error: 'BAD_REQUEST', message: 'is_active は真偽値で指定してください' });
        return;
      }
      sets.push(`is_active = $${idx++}`);
      values.push(is_active);
    }

    sets.push('updated_at = NOW()');
    values.push(String(emailId));
    const emailIdParam = idx++;
    values.push(String(companyId));
    const companyIdParam = idx;

    let result;
    try {
      result = await pool.query(
        `UPDATE company_emails
         SET ${sets.join(', ')}
         WHERE id = $${emailIdParam} AND company_id = $${companyIdParam} AND deleted_at IS NULL
         RETURNING id, email, label, is_active, created_at, updated_at`,
        values
      );
    } catch (updateErr) {
      if ((updateErr as { code?: string }).code === PG_UNIQUE_VIOLATION) {
        res.status(409).json({ error: 'CONFLICT', message: 'このメールアドレスは既に登録されています' });
        return;
      }
      throw updateErr;
    }

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'NOT_FOUND', message: '通知先メールが見つかりません' });
      return;
    }

    const adminUser = req.user as { email: string };
    logAudit({
      req,
      actorEmail: adminUser.email,
      action: 'UPDATE_COMPANY_EMAIL',
      targetType: 'company_email',
      targetId: emailId,
      payload: {
        company_id: companyId,
        ...(email !== undefined ? { email: result.rows[0].email } : {}),
        ...(label !== undefined ? { label: result.rows[0].label } : {}),
        ...(is_active !== undefined ? { is_active: result.rows[0].is_active } : {}),
      },
    });

    res.json({
      ok: true,
      email: result.rows[0],
    });
  } catch (error) {
    handleDbError(res, error, 'Update company email');
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
