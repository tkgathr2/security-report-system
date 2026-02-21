import { Router, Request, Response } from 'express';
import pool from '../db/pool';
import { requireAdmin } from '../middleware/auth';
import { sendReportApprovalNotifications, uploadPdfToSlack, sendSlackNotification } from '../services/notifications';
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
    const guards: { index: number; name: string; start_time: string; end_time: string; early_overtime_hours?: number | null }[] =
      Array.isArray(report.guards_json) ? report.guards_json : [];
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
      `SELECT r.*, c.name as client_name_raw, p.work_date, p.work_name, p.work_title_raw, p.location, c.emails as client_emails,
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
            const slackText = `<!channel>\n【デジタル警備報告書システム ほうこちゃん】報告書再送信\n\n` +
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

    let emailResult = { emailSent: false, castEmailSent: false, adminEmailSent: false, warnings: [] as string[] };
    if (pdfOk) {
      emailResult = await sendReportApprovalNotifications({
        reportId,
        companyName: report.client_name_raw,
        contactName: report.client_contact_name || '',
        contactTitle: report.client_contact_title || '',
        clientAddress: report.client_address || '',
        workDate: workDateStr,
        projectName,
        clientEmails: report.client_emails || [],
        writerEmail,
        writerName: report.writer_name || '',
        supervisorName: report.supervisor_name || '',
        location: report.location || '',
        pdfBytes: pdfBuffer,
        skipSlack: true
      });
    }

    const adminUser = req.user as { email: string };
    logAudit({ req, actorEmail: adminUser.email, action: 'RESEND_REPORT', targetType: 'report', targetId: reportId, payload: { slack_sent: slackSent, email_sent: emailResult.emailSent } });

    res.json({
      ok: true,
      slackSent,
      emailSent: emailResult.emailSent,
      castEmailSent: emailResult.castEmailSent,
      adminEmailSent: emailResult.adminEmailSent,
      warnings: emailResult.warnings
    });
  } catch (error) {
    console.error('[RESEND] Error:', error);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: '再送信に失敗しました' });
  }
});

export default router;
