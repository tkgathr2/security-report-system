/**
 * ③ 案件取消（現場の中止）API — 仕様書 v1.0
 * POST /api/admin/projects/:projectId/cancel   - 案件を中止（論理削除：status='cancelled'）
 * POST /api/admin/projects/:projectId/restore  - 中止を取り消して復活（status を元に戻す）
 *
 * - 管理者権限のみ（requireAdmin）
 * - 物理削除はしない。中止メタ（理由・中止連絡を受けた日時・操作者）を記録
 * - 中止確定時、取引先（company_emails）へ中止連絡メールを自動送信（非同期・冪等・リトライ）
 * - 監査ログ（admin_audit_logs）に CANCEL_PROJECT / RESTORE_PROJECT を残す
 */
import { Router, Request, Response } from 'express';
import pool from '../db/pool';
import { requireAdmin } from '../middleware/auth';
import { logAudit } from '../utils/auditLog';
import { handleDbError } from '../utils/errorHandler';
import { sendProjectCancellationEmails } from '../services/emailSender';

const router = Router();

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// 中止連絡メールの手動再送のクールダウン（連打による取引先への重複送信を防止）。
// 報告書再送（reports.last_resend_at）・個別ログ再送と同じ5分。
const CANCEL_RESEND_COOLDOWN_MS = 5 * 60 * 1000;

function toDateString(value: unknown): string {
  if (value instanceof Date) return value.toISOString().split('T')[0];
  if (value == null) return '';
  return String(value).split('T')[0];
}

// POST /api/admin/projects/:projectId/cancel
router.post('/:projectId/cancel', requireAdmin, async (req: Request, res: Response) => {
  const projectId = req.params.projectId as string;

  if (!projectId || !UUID_REGEX.test(projectId)) {
    res.status(400).json({ error: 'INVALID_ID', message: '案件IDの形式が不正です' });
    return;
  }

  const reasonRaw = (req.body?.cancel_reason ?? '') as unknown;
  const cancelReason = typeof reasonRaw === 'string' ? reasonRaw.trim().slice(0, 500) : '';
  // 中止連絡を受けた日時（将来のキャンセル料判定用・布石）。未指定なら null。
  const contactedRaw = (req.body?.cancel_contacted_at ?? null) as unknown;
  let cancelContactedAt: string | null = null;
  if (typeof contactedRaw === 'string' && contactedRaw.trim()) {
    let s = contactedRaw.trim();
    // フロントの <input type="datetime-local"> はタイムゾーンを持たない
    // （例: "2026-06-01T14:30"）。サーバがUTC稼働だとローカル=UTC解釈となり
    // JSTで入力した時刻が9時間ずれて保存されるため、TZ無しの形式は日本時間として扱う。
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(s)) {
      s = `${s}+09:00`;
    }
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) {
      res.status(400).json({ error: 'INVALID_DATE', message: '中止連絡を受けた日時の形式が不正です' });
      return;
    }
    cancelContactedAt = d.toISOString();
  }

  try {
    const projectResult = await pool.query(
      `SELECT p.id, p.status, p.work_date, p.work_name, p.work_title_raw, p.location,
              c.id as client_id, c.name as client_name_raw,
              c.contact_name as client_contact_name, c.contact_title as client_contact_title
       FROM projects p
       LEFT JOIN clients c ON p.client_id = c.id
       WHERE p.id = $1 AND p.deleted_at IS NULL`,
      [projectId]
    );

    if (projectResult.rows.length === 0) {
      res.status(404).json({ error: 'NOT_FOUND', message: '案件が見つかりません' });
      return;
    }

    const project = projectResult.rows[0];

    if (project.status === 'cancelled') {
      res.status(409).json({ error: 'ALREADY_CANCELLED', message: 'この案件は既に中止されています' });
      return;
    }

    const adminUser = req.user as { email: string };

    // 中止メタを記録（status_before_cancel に元の status を退避）
    await pool.query(
      `UPDATE projects
       SET status = 'cancelled',
           status_before_cancel = $2,
           cancelled_at = NOW(),
           cancel_reason = $3,
           cancel_contacted_at = $4,
           cancelled_by = $5,
           updated_at = NOW()
       WHERE id = $1`,
      [projectId, project.status, cancelReason || null, cancelContactedAt, adminUser.email]
    );

    logAudit({
      req,
      actorEmail: adminUser.email,
      action: 'CANCEL_PROJECT',
      targetType: 'project',
      targetId: projectId,
      payload: {
        previous_status: project.status,
        cancel_reason: cancelReason || null,
        cancel_contacted_at: cancelContactedAt,
      },
    });

    // 中止連絡メール送信（取引先 company_emails 宛・PDF添付なし・冪等・リトライ）
    let emailResult = { sent: 0, failed: 0, skipped: 0, warnings: [] as string[] };
    try {
      emailResult = await sendProjectCancellationEmails({
        projectId,
        companyId: project.client_id || null,
        companyName: project.client_name_raw || '',
        contactName: project.client_contact_name || '',
        contactTitle: project.client_contact_title || '',
        workDate: toDateString(project.work_date),
        projectName: project.work_title_raw || project.work_name || '',
        location: project.location || '',
      });
    } catch (mailErr) {
      // メール失敗は中止確定をブロックしない
      console.error('[CANCEL] cancellation email error:', mailErr);
      emailResult.warnings.push('中止連絡メールの送信中にエラーが発生しました');
    }

    res.json({
      ok: true,
      status: 'cancelled',
      email: emailResult,
    });
  } catch (error) {
    handleDbError(res, error, 'Cancel project');
  }
});

// POST /api/admin/projects/:projectId/cancel/resend
// 中止済み案件の「中止連絡メール」を取引先（company_emails）へ手動で再送する。
// メールログ画面では中止メールを再送できない（報告書PDF前提のため）ので、案件側に専用の再送口を用意する。
router.post('/:projectId/cancel/resend', requireAdmin, async (req: Request, res: Response) => {
  const projectId = req.params.projectId as string;

  if (!projectId || !UUID_REGEX.test(projectId)) {
    res.status(400).json({ error: 'INVALID_ID', message: '案件IDの形式が不正です' });
    return;
  }

  try {
    const projectResult = await pool.query(
      `SELECT p.id, p.status, p.work_date, p.work_name, p.work_title_raw, p.location,
              p.last_cancel_resend_at,
              c.id as client_id, c.name as client_name_raw,
              c.contact_name as client_contact_name, c.contact_title as client_contact_title
       FROM projects p
       LEFT JOIN clients c ON p.client_id = c.id
       WHERE p.id = $1 AND p.deleted_at IS NULL`,
      [projectId]
    );

    if (projectResult.rows.length === 0) {
      res.status(404).json({ error: 'NOT_FOUND', message: '案件が見つかりません' });
      return;
    }

    const project = projectResult.rows[0];

    if (project.status !== 'cancelled') {
      res.status(409).json({ error: 'NOT_CANCELLED', message: 'この案件は中止されていません。中止連絡メールは中止済みの案件のみ再送できます。' });
      return;
    }

    // クールダウン（アトミック・送信前に slot を確保）。
    // isResend は冪等性キーをバイパスするため、このクールダウンが唯一の重複送信防御線。
    const cooldownClaim = await pool.query(
      `UPDATE projects SET last_cancel_resend_at = NOW()
       WHERE id = $1 AND status = 'cancelled'
         AND (last_cancel_resend_at IS NULL OR last_cancel_resend_at < NOW() - ($2::bigint * INTERVAL '1 millisecond'))
       RETURNING id`,
      [projectId, CANCEL_RESEND_COOLDOWN_MS]
    );

    if (cooldownClaim.rowCount === 0) {
      let retryAfterSec = Math.ceil(CANCEL_RESEND_COOLDOWN_MS / 1000);
      if (project.last_cancel_resend_at != null) {
        const lastResend = project.last_cancel_resend_at instanceof Date
          ? project.last_cancel_resend_at
          : new Date(project.last_cancel_resend_at);
        if (!Number.isNaN(lastResend.getTime())) {
          const remainSec = Math.ceil((CANCEL_RESEND_COOLDOWN_MS - (Date.now() - lastResend.getTime())) / 1000);
          if (remainSec > 0) retryAfterSec = remainSec;
        }
      }
      res.status(429).set('Retry-After', String(retryAfterSec)).json({
        error: 'TOO_MANY_REQUESTS',
        message: `中止連絡メールの再送は連続して行えません。約${Math.ceil(retryAfterSec / 60)}分後に再度お試しください。`,
      });
      return;
    }

    const adminUser = req.user as { email: string };

    let emailResult = { sent: 0, failed: 0, skipped: 0, warnings: [] as string[] };
    try {
      emailResult = await sendProjectCancellationEmails({
        projectId,
        companyId: project.client_id || null,
        companyName: project.client_name_raw || '',
        contactName: project.client_contact_name || '',
        contactTitle: project.client_contact_title || '',
        workDate: toDateString(project.work_date),
        projectName: project.work_title_raw || project.work_name || '',
        location: project.location || '',
        isResend: true,
      });
    } catch (mailErr) {
      console.error('[CANCEL-RESEND] cancellation email error:', mailErr);
      emailResult.warnings.push('中止連絡メールの再送中にエラーが発生しました');
    }

    logAudit({
      req,
      actorEmail: adminUser.email,
      action: 'RESEND_CANCELLATION_EMAIL',
      targetType: 'project',
      targetId: projectId,
      payload: { sent: emailResult.sent, failed: emailResult.failed, skipped: emailResult.skipped },
    });

    res.json({ ok: true, email: emailResult });
  } catch (error) {
    handleDbError(res, error, 'Resend cancellation email');
  }
});

// POST /api/admin/projects/:projectId/restore
router.post('/:projectId/restore', requireAdmin, async (req: Request, res: Response) => {
  const projectId = req.params.projectId as string;

  if (!projectId || !UUID_REGEX.test(projectId)) {
    res.status(400).json({ error: 'INVALID_ID', message: '案件IDの形式が不正です' });
    return;
  }

  try {
    const projectResult = await pool.query(
      `SELECT id, status, status_before_cancel FROM projects WHERE id = $1 AND deleted_at IS NULL`,
      [projectId]
    );

    if (projectResult.rows.length === 0) {
      res.status(404).json({ error: 'NOT_FOUND', message: '案件が見つかりません' });
      return;
    }

    const project = projectResult.rows[0];

    if (project.status !== 'cancelled') {
      res.status(409).json({ error: 'NOT_CANCELLED', message: 'この案件は中止されていません' });
      return;
    }

    const restoredStatus = project.status_before_cancel || 'active';

    await pool.query(
      `UPDATE projects
       SET status = $2,
           status_before_cancel = NULL,
           cancelled_at = NULL,
           cancel_reason = NULL,
           cancel_contacted_at = NULL,
           cancelled_by = NULL,
           updated_at = NOW()
       WHERE id = $1`,
      [projectId, restoredStatus]
    );

    const adminUser = req.user as { email: string };
    logAudit({
      req,
      actorEmail: adminUser.email,
      action: 'RESTORE_PROJECT',
      targetType: 'project',
      targetId: projectId,
      payload: { restored_status: restoredStatus },
    });

    res.json({ ok: true, status: restoredStatus });
  } catch (error) {
    handleDbError(res, error, 'Restore project');
  }
});

export default router;
