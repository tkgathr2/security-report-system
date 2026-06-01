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
import { isValidEmail } from '../utils/validation';

const router = Router();

// 手動再送の簡易レート制限: 同一email_logへの再送は直近5分に1回まで
const RESEND_COOLDOWN_MS = 5 * 60 * 1000;
const VALID_RECIPIENT_TYPES = ['client', 'writer', 'admin'] as const;

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
      `SELECT el.id, el.report_id, el.project_id, el.company_id, el.recipient_email, el.recipient_type,
              el.status, el.error_message, el.retry_count, el.sent_at, el.created_at,
              c.name as company_name,
              COALESCE(p.work_date, p2.work_date) as work_date,
              COALESCE(p.work_name, p2.work_name) as work_name
       FROM email_logs el
       LEFT JOIN clients c ON el.company_id = c.id
       LEFT JOIN reports r ON el.report_id = r.id
       LEFT JOIN projects p ON r.project_id = p.id
       LEFT JOIN projects p2 ON el.project_id = p2.id
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
       LEFT JOIN reports r ON el.report_id = r.id
       LEFT JOIN projects p ON r.project_id = p.id
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

    // ③ 案件取消: 中止連絡メール(report_id=NULL / recipient_type='cancel')は、
    // 報告書PDFを伴わない別経路のため、この報告書再送画面からは再送しない。
    // 誤った404ではなく、明確な非対応メッセージを返す。
    if (log.recipient_type === 'cancel' || !log.report_id) {
      res.status(400).json({
        error: 'RESEND_NOT_SUPPORTED',
        message: '中止連絡メールはこの画面から再送できません。案件を再度操作してください。'
      });
      return;
    }
    const pdfBuffer: Buffer = log.pdf_bytes;

    if (!pdfBuffer || pdfBuffer.length === 0 || log.pdf_generation_status !== 'success') {
      res.status(400).json({ error: 'BAD_REQUEST', message: 'PDFが生成されていないため再送できません' });
      return;
    }

    // (a) 宛先メールアドレスの検証（不正なら送信せず400）
    if (!isValidEmail(log.recipient_email)) {
      res.status(400).json({ error: 'BAD_REQUEST', message: '宛先メールアドレスの形式が不正なため再送できません' });
      return;
    }

    // (d) recipient_type ホワイトリスト検証
    if (!VALID_RECIPIENT_TYPES.includes(log.recipient_type)) {
      res.status(400).json({ error: 'BAD_REQUEST', message: '宛先種別が不正なため再送できません' });
      return;
    }

    // (c) 簡易レート制限: 同一email_logへの「手動再送」は直近5分に1回まで。
    // updated_at はシステム送信（成功/失敗/retry）でも更新されるため使わず、
    // 手動再送専用の last_manual_resend_at で判定する。
    // NULL = これまで手動再送なし → 即再送可。
    if (log.last_manual_resend_at != null) {
      const lastResend = log.last_manual_resend_at instanceof Date
        ? log.last_manual_resend_at
        : new Date(log.last_manual_resend_at);
      if (!Number.isNaN(lastResend.getTime())) {
        const elapsedMs = Date.now() - lastResend.getTime();
        if (elapsedMs < RESEND_COOLDOWN_MS) {
          const retryAfterSec = Math.ceil((RESEND_COOLDOWN_MS - elapsedMs) / 1000);
          res.status(429).set('Retry-After', String(retryAfterSec)).json({
            error: 'TOO_MANY_REQUESTS',
            message: `この宛先への再送は連続して行えません。約${Math.ceil(retryAfterSec / 60)}分後に再度お試しください。`,
          });
          return;
        }
      }
    }

    // 手動再送の試行時点を記録（成功/失敗を問わず）。次回以降のレート制限判定に使用。
    await pool.query(
      `UPDATE email_logs SET last_manual_resend_at = NOW() WHERE id = $1`,
      [id]
    );

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
      enforceFeatureFlag: true, // (b) 再送でもフィーチャーフラグを評価し、OFFならskip
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
