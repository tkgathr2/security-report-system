import { Router, Request, Response } from 'express';
import pool from '../db/pool';
import { sendReportApprovalNotifications, sendSlackNotification, uploadPdfToSlack } from '../services/notifications';
import { generateReportPdf } from '../services/pdfGenerator';
import { authenticateCast, requireAdmin } from '../middleware/auth';
import { AuthenticatedCastRequest } from '../types';
import { sendBadRequest, sendNotFound, sendConflict, sendForbidden, sendExpired, sendInternalError } from '../utils/errorHandler';
import { logAudit } from '../utils/auditLog';

const router = Router();

function generateDummyPdf(): Buffer {
  const pdfContent = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>
endobj
4 0 obj
<< /Length 44 >>
stream
BT
/F1 12 Tf
100 700 Td
(Dummy PDF) Tj
ET
endstream
endobj
xref
0 5
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000206 00000 n 
trailer
<< /Size 5 /Root 1 0 R >>
startxref
300
%%EOF`;
  return Buffer.from(pdfContent, 'utf-8');
}

router.post('/approve', authenticateCast, async (req: Request, res: Response) => {
  try {
    console.log('[APPROVE] Starting approval process');
    const castUser = (req as AuthenticatedCastRequest).castUser;
    const {
      project_unique_url,
      supervisor_name,
      writer_name,
      weather,
      guard_contents,
      guard_other_text,
      guards,
      has_qualifier,
      qualifier_name,
      signature_png_base64
    } = req.body;
    console.log('[APPROVE] Request body parsed, project_unique_url:', project_unique_url);

    if (!signature_png_base64) {
      sendBadRequest(res, '署名は必須です');
      return;
    }

    if (!guard_contents || !Array.isArray(guard_contents) || guard_contents.length === 0) {
      sendBadRequest(res, '警備内容は1件以上必須です');
      return;
    }

    if (has_qualifier === true) {
      const qNames = Array.isArray(qualifier_name) ? qualifier_name : (qualifier_name ? [qualifier_name] : []);
      const validQNames = qNames.filter((n: string) => n && n.trim() !== '');
      if (validQNames.length === 0) {
        sendBadRequest(res, '資格者有の場合、資格者氏名は必須です');
        return;
      }
    }

    if (!project_unique_url) {
      sendBadRequest(res, 'project_unique_urlは必須です');
      return;
    }

    const projectResult = await pool.query(
      `SELECT p.id, p.status, p.url_expires_at, c.name as client_name_raw, p.work_date, p.work_title_raw,
              p.location, p.work_name, c.emails as client_emails, c.contact_email,
              c.contact_name as client_contact_name, c.contact_title as client_contact_title,
              c.address as client_address
       FROM projects p
       LEFT JOIN clients c ON p.client_id = c.id
       WHERE p.unique_url = $1 AND p.deleted_at IS NULL`,
      [project_unique_url]
    );

    if (projectResult.rows.length === 0) {
      sendNotFound(res, '案件が見つかりません');
      return;
    }

    const project = projectResult.rows[0];

    const now = new Date();
    const expiresAt = new Date(project.url_expires_at);
    if (expiresAt < now) {
      sendExpired(res, '期限切れ');
      return;
    }

    const signaturePngBuffer = Buffer.from(signature_png_base64, 'base64');

    let resolvedWriterName = writer_name || '';
    if (!resolvedWriterName) {
      const castUserResult = await pool.query(
        `SELECT sm.display_name_kanji
         FROM cast_users cu
         LEFT JOIN staff_master sm ON cu.staff_id = sm.id
         WHERE cu.id = $1`,
        [castUser.userId]
      );
      if (castUserResult.rows.length > 0) {
        resolvedWriterName = castUserResult.rows[0].display_name_kanji || castUser.email;
      } else {
        resolvedWriterName = castUser.email;
      }
    }
    
    const workDateStr = project.work_date instanceof Date 
      ? project.work_date.toISOString().split('T')[0]
      : String(project.work_date).split('T')[0];

    // レポートを保存（PDF/通知は後で非同期処理）
    // pdf_bytesカラムはNOT NULL制約があるため、初期値としてダミーPDFを使用
    console.log('[APPROVE] Inserting report into database');
    const initialPdfBuffer = generateDummyPdf();
    const writerStaffIdResult = await pool.query('SELECT staff_id FROM cast_users WHERE id = $1',[castUser.userId]);
    const writerStaffId = writerStaffIdResult.rows[0]?.staff_id || null;

    const reportResult = await pool.query(
      `INSERT INTO reports (
        project_id, cast_user_id, supervisor_name, writer_staff_id, weather,
        guard_contents, guard_other_text, overtime_hours, has_qualifier, qualifier_name,
        signature_png, pdf_bytes, status, approved_at, pdf_generation_status, pdf_generated_at, guards_json
      ) SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17
      WHERE NOT EXISTS (SELECT 1 FROM reports WHERE project_id = $1 AND deleted_at IS NULL)
      RETURNING id`,
      [
        project.id,
        castUser.userId,
        supervisor_name || '',
        writerStaffId,
        weather || 'sunny',
        guard_contents,
        guard_other_text || null,
        null,
        has_qualifier || false,
        Array.isArray(qualifier_name) ? JSON.stringify(qualifier_name) : (qualifier_name || null),
        signaturePngBuffer,
        initialPdfBuffer,
        'approved',
        now,
        'pending',
        null,
        Array.isArray(guards) ? JSON.stringify(guards) : null
      ]
    );

    if (reportResult.rows.length === 0) {
      sendConflict(res, 'この案件の報告書は既に提出されています');
      return;
    }

    const reportId = reportResult.rows[0].id;
    console.log('[APPROVE] Report inserted successfully, id:', reportId);

    logAudit({ req, actorEmail: castUser.email, actorType: 'cast', action: 'APPROVE_REPORT', targetType: 'report', targetId: reportId, payload: { project_id: project.id, supervisor_name: supervisor_name || '' } });

    // 即座にレスポンスを返す（高速化）
    res.status(201).json({
      ok: true,
      report_id: reportId,
      pdf_saved: false,
      signature_saved: true,
      notifications: {
        email_sent: false,
        slack_sent: false
      },
      async_processing: true
    });

    // 以下は非同期で実行（レスポンス後にバックグラウンドで処理）
    setImmediate(async () => {
      console.log(`[ASYNC] Starting background processing for report ${reportId}`);

      // PDF生成を最初に実行（Slack通知にPDFリンクを含めるため）
      let pdfBuffer: Buffer;
      let pdfGenerationStatus = 'success';
      try {
        pdfBuffer = await generateReportPdf({
          companyName: project.client_name_raw,
          workDate: workDateStr,
          location: project.location,
          workName: project.work_name || project.work_title_raw,
          supervisorName: supervisor_name || '',
          writerName: resolvedWriterName,
          guardContents: guard_contents,
          guardOtherText: guard_other_text,
          guards: Array.isArray(guards) ? guards : [],
          hasQualifier: has_qualifier || false,
          qualifierName: qualifier_name,
          signaturePng: signaturePngBuffer
        });
        console.log(`[ASYNC] Generated PDF: ${pdfBuffer.length} bytes`);
      } catch (pdfError) {
        console.error('[ASYNC] PDF generation failed, using dummy PDF:', pdfError);
        pdfBuffer = generateDummyPdf();
        pdfGenerationStatus = 'failed';
      }

      // PDFをDBに保存（独立したtry-catch：失敗してもメール送信は続行）
      try {
        await pool.query(
          `UPDATE reports SET pdf_bytes = $1, pdf_generation_status = $2, pdf_generated_at = $3 WHERE id = $4`,
          [pdfBuffer, pdfGenerationStatus, new Date(), reportId]
        );
        console.log(`[ASYNC] PDF saved to database for report ${reportId}`);
      } catch (dbError) {
        console.error(`[ASYNC] PDF save to DB failed for report ${reportId}:`, dbError);
      }

      // Slack通知（PDF添付と通知テキストを1メッセージに統合）
      try {
        const baseUrl = process.env.RAILWAY_PUBLIC_DOMAIN
          ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
          : 'https://security-report.up.railway.app';
        const pdfUrl = pdfGenerationStatus === 'success' ? `${baseUrl}/api/reports/${reportId}/pdf` : undefined;
        const projectName = project.work_title_raw || project.work_name || '';
                const slackText = `<!channel>\n【デジタル警備報告書システム ほうこちゃん】報告書承認通知\n\n` +
                  `会社名: ${project.client_name_raw}\n` +
                  `実施日: ${workDateStr}\n` +
                  `作業名称: ${projectName}\n`+
          (project.location ? `実施場所: ${project.location}\n` : '') +
          (resolvedWriterName ? `報告者: ${resolvedWriterName}\n` : '') +
          `報告書ID: ${reportId}` +
          (pdfUrl ? `\n\n:page_facing_up: <${pdfUrl}|報告書PDFをダウンロード>` : '');

        if (pdfGenerationStatus === 'success') {
          const pdfUploadResult = await uploadPdfToSlack({
            pdfBuffer,
            filename: `report_${workDateStr}.pdf`,
            reportId,
            title: `警備報告書 ${projectName} (${workDateStr})`,
            initialComment: slackText
          });
          console.log(`[ASYNC] Slack PDF upload result for report ${reportId}:`, pdfUploadResult);
          if (!pdfUploadResult.success) {
            const slackResult = await sendSlackNotification({
              companyName: project.client_name_raw,
              workDate: workDateStr,
              projectName,
              reportId,
              writerName: resolvedWriterName,
              location: project.location || '',
              pdfUrl
            });
            console.log(`[ASYNC] Slack webhook fallback result for report ${reportId}:`, slackResult);
          }
        } else {
          const slackResult = await sendSlackNotification({
            companyName: project.client_name_raw,
            workDate: workDateStr,
            projectName,
            reportId,
            writerName: resolvedWriterName,
            location: project.location || '',
            pdfUrl
          });
          console.log(`[ASYNC] Slack notification result for report ${reportId}:`, slackResult);
        }
      } catch (slackError) {
        console.error(`[ASYNC] Slack notification failed for report ${reportId}:`, slackError);
      }

      // メール通知（独立したtry-catch）
      try {
        let clientEmails: string[] = Array.isArray(project.client_emails) ? project.client_emails : [];
        if (clientEmails.length === 0 && project.contact_email) {
          clientEmails = [project.contact_email];
        }
        const castEmail = castUser.email;
        const displayWriterName = resolvedWriterName;

        const notificationResult = await sendReportApprovalNotifications({
          reportId,
          companyName: project.client_name_raw,
          contactName: project.client_contact_name || '',
          contactTitle: project.client_contact_title || '',
          clientAddress: project.client_address || '',
          workDate: workDateStr,
          projectName: project.work_title_raw || project.work_name || '',
          clientEmails,
          writerEmail: castEmail,
          writerName: displayWriterName,
          supervisorName: supervisor_name || '',
          location: project.location || '',
          pdfBytes: pdfBuffer,
          skipSlack: true
        });

        console.log(`[ASYNC] Email notifications sent for report ${reportId}:`, notificationResult);
      } catch (emailError) {
        console.error(`[ASYNC] Email notification failed for report ${reportId}:`, emailError);
      }
    });

  } catch (error) {
    console.error('Approve error:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    sendInternalError(res, `承認処理中にエラーが発生しました: ${errorMessage}`);
  }
});

router.get('/:reportId/pdf', (req: Request, res: Response, next: () => void) => {
  if (req.isAuthenticated && req.isAuthenticated()) {
    return next();
  }
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authenticateCast(req, res, next);
  }
  res.status(401).json({ error: 'UNAUTHORIZED', message: '認証が必要です' });
}, async (req: Request, res: Response) => {
  const reportId = req.params.reportId as string;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(reportId)) {
    res.status(400).json({ error: 'INVALID_ID', message: '報告書IDの形式が不正です' });
    return;
  }
  try {
    const result = await pool.query(
      'SELECT pdf_bytes, pdf_generation_status FROM reports WHERE id = $1 AND deleted_at IS NULL',
      [reportId]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'NOT_FOUND', message: '報告書が見つかりません' });
      return;
    }
    const { pdf_bytes, pdf_generation_status } = result.rows[0];
    if (!pdf_bytes || pdf_bytes.length === 0 || pdf_generation_status !== 'success') {
      res.status(404).json({ error: 'PDF_NOT_READY', message: 'PDFがまだ生成されていません' });
      return;
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="report-${reportId}.pdf"`);
    res.send(pdf_bytes);
  } catch (error) {
    console.error('[PDF] Download error:', error);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: 'サーバーエラーが発生しました' });
  }
});

export default router;
