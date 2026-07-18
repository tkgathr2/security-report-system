import { Router, Request, Response } from 'express';
import pool from '../db/pool';
import { requireAdmin } from '../middleware/auth';
import { uploadPdfToSlack, sendSlackNotification, SLACK_REPORT_MENTIONS } from '../services/notifications';
import { sendCompanyNotificationEmails, sendWriterAndAdminNotifications, sendEmailWithLog } from '../services/emailSender';
import { logAudit } from '../utils/auditLog';
import { generateReportPdf } from '../services/pdfGenerator';
import type { PdfLayout, PdfDesign } from '../services/pdfGenerator';

const router = Router();

// pdf_generation_status values
const PDF_STATUS = {
  PENDING: 'pending',
  SUCCESS: 'success',
  FAILED: 'failed'
} as const;

const VALID_LAYOUTS: PdfLayout[] = ['classic', 'handwritten'];
const VALID_DESIGNS: PdfDesign[] = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];

// 報告書単位の手動再送のクールダウン（連打による取引先への重複送信を防止）。
// 個別ログ再送（adminEmailLogs.ts）と同じ5分に揃える。
const REPORT_RESEND_COOLDOWN_MS = 5 * 60 * 1000;

/** system_settings のブール値フラグを評価する。取得失敗時は安全側でOFF。 */
async function isSettingEnabled(key: string): Promise<boolean> {
  try {
    const r = await pool.query(`SELECT value FROM system_settings WHERE key = $1`, [key]);
    return r.rows.length > 0 && r.rows[0].value === 'true';
  } catch (err) {
    console.warn(`[RESEND] Failed to check ${key}, defaulting to OFF:`, err);
    return false;
  }
}

// POST /api/admin/reports/:reportId/pdf/generate
router.post('/:reportId/pdf/generate', requireAdmin, async (req: Request, res: Response) => {
  const { reportId } = req.params;

  try {
    // Get report data
    const reportResult = await pool.query(
      'SELECT * FROM reports WHERE id = $1 AND deleted_at IS NULL',
      [reportId]
    );

    if (reportResult.rows.length === 0) {
      res.status(404).json({
        error: 'NOT_FOUND',
        message: '指定された報告書が見つかりません',
        details: {}
      });
      return;
    }

    const report = reportResult.rows[0];

    const projectResult = await pool.query(
      `SELECT p.project_key, c.name as client_name_raw, p.work_date, p.work_name, p.work_title_raw, p.location, p.start_time, p.end_time
       FROM projects p
       LEFT JOIN clients c ON p.client_id = c.id
       WHERE p.id = $1`,
      [report.project_id]
    );

    if (projectResult.rows.length === 0) {
      res.status(404).json({
        error: 'NOT_FOUND',
        message: '関連する案件が見つかりません',
        details: {}
      });
      return;
    }

    const project = projectResult.rows[0];

    const reqDesign = req.body?.design as string | undefined;
    const reqLayout = req.body?.layout as string | undefined;

    let pdfLayout: PdfLayout = 'classic';
    let pdfDesign: PdfDesign = 'A';

    if (reqLayout && VALID_LAYOUTS.includes(reqLayout as PdfLayout)) {
      pdfLayout = reqLayout as PdfLayout;
    }
    if (reqDesign && VALID_DESIGNS.includes(reqDesign as PdfDesign)) {
      pdfDesign = reqDesign as PdfDesign;
    }

    if (!reqLayout || !reqDesign) {
      try {
        await pool.query(`CREATE TABLE IF NOT EXISTS system_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TIMESTAMPTZ DEFAULT NOW())`);
        if (!reqLayout) {
          const layoutResult = await pool.query(`SELECT value FROM system_settings WHERE key = 'pdf_layout'`);
          if (layoutResult.rows.length > 0 && VALID_LAYOUTS.includes(layoutResult.rows[0].value as PdfLayout)) {
            pdfLayout = layoutResult.rows[0].value as PdfLayout;
          }
        }
        if (!reqDesign) {
          const designResult = await pool.query(`SELECT value FROM system_settings WHERE key = 'pdf_design'`);
          if (designResult.rows.length > 0 && VALID_DESIGNS.includes(designResult.rows[0].value as PdfDesign)) {
            pdfDesign = designResult.rows[0].value as PdfDesign;
          }
        }
      } catch (settingsErr) {
        console.warn('[REGEN] Failed to fetch PDF settings, using defaults:', settingsErr);
      }
    }

    await pool.query(
      'UPDATE reports SET pdf_generation_status = $1 WHERE id = $2',
      [PDF_STATUS.PENDING, reportId]
    );

    const workDateStr = project.work_date instanceof Date
      ? project.work_date.toISOString().split('T')[0]
      : String(project.work_date).split('T')[0];

    const writerName = report.writer_name || '';
    const guardContents: string[] = Array.isArray(report.guard_contents) ? report.guard_contents : [];
    let guards: { index: number; name: string; start_time: string; end_time: string; early_overtime_hours?: number | null }[] =
      Array.isArray(report.guards_json) ? report.guards_json : [];
    if (guards.length === 0) {
      try {
        const castsResult = await pool.query(
          `SELECT pc.staff_no, COALESCE(sm.display_name_kanji, 'No.' || pc.staff_no) as cast_name
           FROM project_casts pc
           LEFT JOIN staff_master sm ON pc.staff_id = sm.id AND sm.deleted_at IS NULL
           WHERE pc.project_id = $1 AND pc.deleted_at IS NULL ORDER BY pc.row_index`,
          [report.project_id]
        );
        if (castsResult.rows.length > 0) {
          guards = castsResult.rows.map((c: { cast_name: string }, idx: number) => ({
            index: idx + 1,
            name: c.cast_name,
            start_time: project.start_time || '',
            end_time: project.end_time || '',
            early_overtime_hours: null
          }));
          console.log(`[REGEN] Fallback: loaded ${guards.length} guards from project_casts`);
        }
      } catch (castErr) {
        console.warn('[REGEN] Failed to fetch project_casts fallback:', castErr);
      }
    }
    const signaturePng: Buffer | null = report.signature_png && report.signature_png.length > 0 ? report.signature_png : null;

    try {
      const pdfBuffer = await generateReportPdf({
        companyName: project.client_name_raw || '',
        workDate: workDateStr,
        location: project.location || '',
        workName: project.work_name || project.work_title_raw || '',
        supervisorName: report.supervisor_name || '',
        writerName,
        guardContents,
        guardOtherText: report.guard_other_text,
        guards,
        hasQualifier: report.has_qualifier || false,
        qualifierName: report.qualifier_name,
        signaturePng: signaturePng,
        weather: report.weather || null,
        notes: report.notes || null,
        partnerCompanyName: report.partner_company_name || null,
        layout: pdfLayout,
        design: pdfDesign,
      });

      // Update report with PDF data
      await pool.query(
        `UPDATE reports 
         SET pdf_bytes = $1, 
             pdf_generation_status = $2, 
             pdf_generated_at = CURRENT_TIMESTAMP 
         WHERE id = $3`,
        [pdfBuffer, PDF_STATUS.SUCCESS, reportId]
      );

      const adminUser = req.user as { email: string };
      logAudit({ req, actorEmail: adminUser.email, action: 'REGENERATE_PDF', targetType: 'report', targetId: reportId, payload: { pdf_size: pdfBuffer.length } });

      res.status(200).json({
        message: 'PDF生成が完了しました',
        reportId: reportId,
        pdf_generation_status: PDF_STATUS.SUCCESS,
        pdf_size: pdfBuffer.length
      });
    } catch (pdfError) {
      // Update status to failed
      await pool.query(
        'UPDATE reports SET pdf_generation_status = $1 WHERE id = $2',
        [PDF_STATUS.FAILED, reportId]
      );

      console.error('PDF generation error:', pdfError);
      res.status(500).json({
        error: 'PDF_GENERATION_FAILED',
        message: 'PDF生成に失敗しました',
        details: {}
      });
    }
  } catch (error) {
    console.error('Database error:', error);
    res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'データベースエラーが発生しました',
      details: {}
    });
  }
});

// GET /api/admin/reports/:reportId/pdf
router.get('/:reportId/pdf', requireAdmin, async (req: Request, res: Response) => {
  const { reportId } = req.params;

  try {
    const result = await pool.query(
      'SELECT pdf_bytes, pdf_generation_status FROM reports WHERE id = $1 AND deleted_at IS NULL',
      [reportId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({
        error: 'NOT_FOUND',
        message: '指定された報告書が見つかりません',
        details: {}
      });
      return;
    }

    const { pdf_bytes, pdf_generation_status } = result.rows[0];

    // Check if PDF has been generated
    if (!pdf_bytes || pdf_bytes.length === 0 || pdf_generation_status !== PDF_STATUS.SUCCESS) {
      res.status(404).json({
        error: 'PDF_NOT_GENERATED',
        message: 'PDFがまだ生成されていません',
        details: {
          pdf_generation_status: pdf_generation_status
        }
      });
      return;
    }

    // Return PDF
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="report-${reportId}.pdf"`);
    res.send(pdf_bytes);
  } catch (error) {
    console.error('Database error:', error);
    res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'データベースエラーが発生しました',
      details: {}
    });
  }
});

router.post('/:reportId/resend', requireAdmin, async (req: Request, res: Response) => {
  const reportId = req.params.reportId as string;

  try {
    const reportResult = await pool.query(
      `SELECT r.*, c.id as client_id, c.name as client_name_raw, p.work_date, p.work_name, p.work_title_raw, p.location, c.emails as client_emails,
              c.contact_name as client_contact_name, c.contact_title as client_contact_title, c.address as client_address,
              sm.display_name_kanji as writer_name
       FROM reports r 
       JOIN projects p ON r.project_id = p.id 
       LEFT JOIN clients c ON p.client_id = c.id 
       LEFT JOIN staff_master sm ON r.writer_staff_id = sm.id
       WHERE r.id = $1 AND r.deleted_at IS NULL`,
      [reportId]
    );

    if (reportResult.rows.length === 0) {
      res.status(404).json({ error: 'NOT_FOUND', message: '報告書が見つかりません' });
      return;
    }

    const report = reportResult.rows[0];

    // クールダウン（アトミック・送信前に slot を確保）:
    // 同一報告書の手動再送は直近5分に1回まで。判定と記録を単一の条件付きUPDATEで行うことで、
    // check-then-act の競合（送信中の連打・同時2リクエスト）による取引先への重複送信を防ぐ。
    // isResend は冪等性キーをバイパスするため、このクールダウンが唯一の重複送信防御線。
    // 個別ログ再送（adminEmailLogs.ts）と同じ5分に揃える。
    const cooldownClaim = await pool.query(
      `UPDATE reports SET last_resend_at = NOW()
       WHERE id = $1
         AND (last_resend_at IS NULL OR last_resend_at < NOW() - ($2::bigint * INTERVAL '1 millisecond'))
       RETURNING id`,
      [reportId, REPORT_RESEND_COOLDOWN_MS]
    );
    if (cooldownClaim.rowCount === 0) {
      // 直近に再送済み。残り時間は読み込み済みの last_resend_at から概算（無ければ満了分を返す）。
      let retryAfterSec = Math.ceil(REPORT_RESEND_COOLDOWN_MS / 1000);
      if (report.last_resend_at != null) {
        const lastResend = report.last_resend_at instanceof Date
          ? report.last_resend_at
          : new Date(report.last_resend_at);
        if (!Number.isNaN(lastResend.getTime())) {
          const remainSec = Math.ceil((REPORT_RESEND_COOLDOWN_MS - (Date.now() - lastResend.getTime())) / 1000);
          if (remainSec > 0) retryAfterSec = remainSec;
        }
      }
      res.status(429).set('Retry-After', String(retryAfterSec)).json({
        error: 'TOO_MANY_REQUESTS',
        message: `この報告書の再送は連続して行えません。約${Math.ceil(retryAfterSec / 60)}分後に再度お試しください。`,
      });
      return;
    }

    const workDateStr = report.work_date instanceof Date
      ? report.work_date.toISOString().split('T')[0]
      : String(report.work_date).split('T')[0];
    const projectName = report.work_title_raw || report.work_name || '';
    const pdfBuffer: Buffer = report.pdf_bytes;
    const pdfOk = pdfBuffer && pdfBuffer.length > 0 && report.pdf_generation_status === 'success';

    const castResult = await pool.query('SELECT email FROM cast_users WHERE id = $1', [report.cast_user_id]);
    const writerEmail = castResult.rows.length > 0 ? castResult.rows[0].email : '';

    let slackSent = false;
    if (pdfOk) {
      const baseUrl = process.env.RAILWAY_PUBLIC_DOMAIN
        ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
        : 'https://security-report.up.railway.app';
      const pdfUrl = `${baseUrl}/api/reports/${reportId}/pdf`;
            const slackText = `${SLACK_REPORT_MENTIONS}\n【デジタル警備報告書システム ほうこちゃん】報告書再送信\n\n` +
              `会社名: ${report.client_name_raw}\n` +
              `実施日: ${workDateStr}\n` +
              `作業名称: ${projectName}\n`+
        (report.location ? `実施場所: ${report.location}\n` : '') +
        (report.writer_name ? `報告者: ${report.writer_name}\n` : '') +
        `報告書ID: ${reportId}` +
        `\n\n:page_facing_up: <${pdfUrl}|報告書PDFをダウンロード>`;

      const pdfUploadResult = await uploadPdfToSlack({
        pdfBuffer,
        filename: `report_${workDateStr}.pdf`,
        reportId,
        title: `警備報告書 ${projectName} (${workDateStr})`,
        initialComment: slackText
      });
      slackSent = pdfUploadResult.success;
      if (!pdfUploadResult.success) {
        const fallback = await sendSlackNotification({
          companyName: report.client_name_raw,
          workDate: workDateStr,
          projectName,
          reportId,
          writerName: report.writer_name || '',
          location: report.location || '',
          pdfUrl
        });
        slackSent = fallback.success;
      }
    }

    let writerSent = false;
    let adminSent = false;
    let emailWarnings: string[] = [];
    let companyEmailWarnings: string[] = [];
    if (pdfOk) {
      // 承認時と同じフラグ分岐に揃える（再送がフラグを無視して旧経路へ流れる不整合を解消）
      const clientEmailEnabled = await isSettingEnabled('client_email_enabled');
      const newEmailNotificationEnabled = await isSettingEnabled('email_notification_enabled');
      // 新フラグONなら旧クライアント送信を無効化（writer/admin通知は emailSender 経由・二重送信防止）
      const skipLegacyClientEmail = newEmailNotificationEnabled || !clientEmailEnabled;

      // writer/admin は emailSender 経由で email_logs に記録（田所Critical#3対策）
      const writerAdminResult = await sendWriterAndAdminNotifications({
        reportId,
        companyId: report.client_id || null,
        companyName: report.client_name_raw,
        contactName: report.client_contact_name || '',
        contactTitle: report.client_contact_title || '',
        clientAddress: report.client_address || '',
        workDate: workDateStr,
        projectName,
        writerEmail,
        writerName: report.writer_name || '',
        supervisorName: report.supervisor_name || '',
        location: report.location || '',
        pdfBuffer,
        isResend: true,
      });
      writerSent = writerAdminResult.writerSent;
      adminSent = writerAdminResult.adminSent;
      emailWarnings = writerAdminResult.warnings;

      // 旧クライアントメール経路を使うケース（新フラグOFF かつ client_email_enabled=ON）。
      // 既存挙動維持のため legacy path も残すが、emailSender 経由で client 送信に切替える。
      if (!skipLegacyClientEmail) {
        const clientList: string[] = Array.isArray(report.client_emails) ? report.client_emails : [];
        for (const addr of clientList) {
          try {
            const r = await sendEmailWithLog({
              reportId,
              companyId: report.client_id || null,
              recipientEmail: addr,
              recipientType: 'client',
              companyName: report.client_name_raw,
              contactName: report.client_contact_name || '',
              contactTitle: report.client_contact_title || '',
              clientAddress: report.client_address || '',
              workDate: workDateStr,
              projectName,
              writerName: report.writer_name || '',
              supervisorName: report.supervisor_name || '',
              location: report.location || '',
              pdfBuffer,
              isResend: true,
              enforceFeatureFlag: false,
            });
            if (!r.success) {
              emailWarnings.push(`クライアントメール送信失敗: ${r.error}`);
            }
          } catch (clientErr) {
            console.error('[RESEND] Legacy client email failed:', clientErr);
            emailWarnings.push('クライアントメール送信失敗（例外）');
          }
        }
      }

      // 新経路ONなら取引先へは company_emails 経由で再送（冪等性キーに resend サフィックス付き）
      if (newEmailNotificationEnabled && report.client_id) {
        try {
          const companyResult = await sendCompanyNotificationEmails({
            reportId,
            companyId: report.client_id,
            companyName: report.client_name_raw || '',
            contactName: report.client_contact_name || '',
            contactTitle: report.client_contact_title || '',
            clientAddress: report.client_address || '',
            workDate: workDateStr,
            projectName,
            writerName: report.writer_name || '',
            supervisorName: report.supervisor_name || '',
            location: report.location || '',
            pdfBuffer,
            isResend: true
          });
          companyEmailWarnings = companyResult.warnings;
        } catch (companyErr) {
          console.error('[RESEND] Company notification resend failed:', companyErr);
          companyEmailWarnings = ['取引先への再送に失敗しました'];
        }
      }
    }

    const adminUser = req.user as { email: string };
    logAudit({ req, actorEmail: adminUser.email, action: 'RESEND_REPORT', targetType: 'report', targetId: reportId, payload: { slack_sent: slackSent, writer_sent: writerSent, admin_sent: adminSent } });

    res.json({
      ok: true,
      slackSent,
      // 旧フィールド名と互換: emailSent は「取引先（client）メール送信」相当として扱われていたが、
      // 切替後は writer/admin が emailSender 経由・client は company_emails 経由のため、
      // 後方互換のため writerSent をそのまま返す（管理画面側は新名も読めるよう両方返す）。
      emailSent: writerSent,
      castEmailSent: writerSent,
      adminEmailSent: adminSent,
      writerSent,
      adminSent,
      warnings: [...emailWarnings, ...companyEmailWarnings]
    });
  } catch (error) {
    console.error('[RESEND] Error:', error);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: '再送信に失敗しました' });
  }
});

export default router;
