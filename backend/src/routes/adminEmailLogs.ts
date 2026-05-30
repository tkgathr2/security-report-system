/**
 * 送信ログ管理 API
 * GET  /api/admin/email-logs              - 送信ログ一覧
 * GET  /api/admin/email-logs/report/:id   - 報告書単位の送信ログ
 * POST /api/admin/email-logs/:id/resend   - 手動再送
 */
import { Router, Request, Response } from 'express';
import pool from '../db/pool';
import { requireAdmin } from '../middleware/auth';
import { logAudit } from '../utils/auditLog';
import { handleDbError } from '../utils/errorHandler';
import { sendEmailWithLog } from '../services/emailSender';

const router = Router();

// GET /api/admin/email-logs
router.get('/', requireAdmin, async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const offset = parseInt(req.query.offset as string) || 0;
    const status = req.query.status as string;

    let whereClause = '';
    const params: (string | number)[] = [];
    let paramIdx = 1;

    if (status && ['sent', 'failed', 'pending', 'skipped'].includes(status)) {
      whereClause = `WHERE el.status = $${paramIdx++}`;
      params.push(status);
    }

    params.push(limit, offset);

    const result = await pool.query(
      `SELECT el.id, el.report_id, el.company_id, el.recipient_email, el.recipient_type,
              el.status, el.error_message, el.retry_count, el.sent_at, el.created_at,
              c.name as company_name,
              p.work_date, p.work_name
       FROM email_logs el
       LEFT JOIN clients c ON el.company_id = c.id
       LEFT JOIN reports r ON el.report_id = r.id
       LEFT JOIN projects p ON r.project_id = p.id
       ${whereClause}
       ORDER BY el.created_at DESC
       LIMIT $${paramIdx++} OFFSET $${paramIdx}`,
      params
    );

    const countResult = await pool.query(
      `SELECT COUNT(*) as total FROM email_logs el ${whereClause}`,
      status ? [status] : []
    );

    res.json({
      logs: result.rows,
      total: parseInt(countResult.rows[0].total, 10),
      limit,
      offset,
    });
  } catch (error) {
    handleDbError(res, error, 'Email logs list');
  }
});

// GET /api/admin/email-logs/report/:reportId
router.get('/report/:reportId', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { reportId } = req.params;

    const result = await pool.query(
      `SELECT el.id, el.recipient_email, el.recipient_type, el.status,
              el.error_message, el.retry_count, el.sent_at, el.created_at,
              c.name as company_name
       FROM email_logs el
       LEFT JOIN clients c ON el.company_id = c.id
       WHERE el.report_id = $1
       ORDER BY el.created_at ASC`,
      [reportId]
    );

    res.json({ logs: result.rows, total: result.rows.length });
  } catch (error) {
    handleDbError(res, error, 'Report email logs');
  }
});

// POST /api/admin/email-logs/:id/resend
router.post('/:id/resend', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // ログの取得
    const logResult = await pool.query(
      `SELECT el.*, r.pdf_bytes, r.pdf_generation_status,
              p.work_date, p.work_name, p.work_title_raw, p.location,
              c.name as company_name, c.contact_name, c.contact_title, c.address as client_address,
              sm.display_name_kanji as writer_name,
              COALESCE(NULLIF(r.supervisor_name, ''), p.supervisor_name, '') as supervisor_name
       FROM email_logs el
       JOIN reports r ON el.report_id = r.id
       JOIN projects p ON r.project_id = p.id
       LEFT JOIN clients c ON p.client_id = c.id
       LEFT JOIN staff_master sm ON r.writer_staff_id = sm.id
       WHERE el.id = $1`,
      [id]
    );

    if (logResult.rows.length === 0) {
      res.status(404).json({ error: 'NOT_FOUND', message: '送信ログが見つかりません' });
      return;
    }

    const log = logResult.rows[0];
    const pdfBuffer: Buffer = log.pdf_bytes;

    if (!pdfBuffer || pdfBuffer.length === 0 || log.pdf_generation_status !== 'success') {
      res.status(400).json({ error: 'BAD_REQUEST', message: 'PDFが生成されていないため再送できません' });
      return;
    }

    const workDateStr = log.work_date instanceof Date
      ? log.work_date.toISOString().split('T')[0]
      : String(log.work_date).split('T')[0];
    const projectName = log.work_title_raw || log.work_name || '';

    // 再送用に新しいidempotency_keyを生成（手動再送は冪等性チェックをバイパス）
    const resendResult = await sendEmailWithLog({
      reportId: log.report_id,
      companyId: log.company_id,
      recipientEmail: log.recipient_email,
      recipientType: log.recipient_type,
      companyName: log.company_name || '',
      contactName: log.contact_name || '',
      contactTitle: log.contact_title || '',
      clientAddress: log.client_address || '',
      workDate: workDateStr,
      projectName,
      writerName: log.writer_name || '',
      supervisorName: log.supervisor_name || '',
      location: log.location || '',
      pdfBuffer,
      isResend: true,
    });

    const adminUser = req.user as { email: string };
    logAudit({
      req,
      actorEmail: adminUser.email,
      action: 'RESEND_EMAIL',
      targetType: 'email_log',
      targetId: id,
      payload: { recipient: log.recipient_email, success: resendResult.success },
    });

    res.json({
      ok: true,
      success: resendResult.success,
      error: resendResult.error || null,
    });
  } catch (error) {
    handleDbError(res, error, 'Resend email');
  }
});

export default router;
