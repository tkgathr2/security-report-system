import { Router, Request, Response } from 'express';
import pool from '../db/pool';
import { sendReportApprovalNotifications } from '../services/notifications';
import { generateReportPdf } from '../services/pdfGenerator';
import { authenticateCast } from '../middleware/auth';
import { AuthenticatedCastRequest } from '../types';
import { sendBadRequest, sendNotFound, sendConflict, sendForbidden, sendExpired, sendInternalError } from '../utils/errorHandler';

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
      `SELECT p.id, p.status, p.url_expires_at, p.client_name_raw, p.work_date, p.work_title_raw,
              p.location, p.work_name, c.emails as client_emails
       FROM projects p
       LEFT JOIN clients c ON p.client_id = c.id
       WHERE p.unique_url = $1`,
      [project_unique_url]
    );

    if (projectResult.rows.length === 0) {
      sendNotFound(res, '案件が見つかりません');
      return;
    }

    const project = projectResult.rows[0];

    // Check if report already exists for this project
    const existingReportResult = await pool.query(
      'SELECT id FROM reports WHERE project_id = $1',
      [project.id]
    );

    if (existingReportResult.rows.length > 0) {
      sendConflict(res, 'この案件の報告書は既に提出されています');
      return;
    }

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
        `SELECT cu.selected_name_kanji, sm.display_name_kanji
         FROM cast_users cu
         LEFT JOIN staff_master sm ON cu.staff_id = sm.id
         WHERE cu.id = $1`,
        [castUser.userId]
      );
      if (castUserResult.rows.length > 0) {
        resolvedWriterName = castUserResult.rows[0].selected_name_kanji || castUserResult.rows[0].display_name_kanji || castUser.email;
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
    const reportResult = await pool.query(
      `INSERT INTO reports (
        project_id, cast_user_id, supervisor_name, writer_name, weather,
        guard_contents, guard_other_text, overtime_hours, has_qualifier, qualifier_name,
        signature_png, pdf_bytes, status, approved_at, pdf_generation_status, pdf_generated_at, guards_json
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
      RETURNING id`,
      [
        project.id,
        castUser.userId,
        supervisor_name || '',
        resolvedWriterName,
        weather || 'sunny',
        guard_contents,
        guard_other_text || null,
        null,
        has_qualifier || false,
        Array.isArray(qualifier_name) ? JSON.stringify(qualifier_name) : (qualifier_name || null),
        signaturePngBuffer,
        initialPdfBuffer, // ダミーPDF（後で実際のPDFに更新）
        'approved',
        now,
        'pending', // PDF generation pending
        null,
        Array.isArray(guards) ? JSON.stringify(guards) : null
      ]
    );

    const reportId = reportResult.rows[0].id;
    console.log('[APPROVE] Report inserted successfully, id:', reportId);

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
      try {
        console.log(`[ASYNC] Starting background processing for report ${reportId}`);
        
        // PDF生成
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

        // PDFをDBに保存
        await pool.query(
          `UPDATE reports SET pdf_bytes = $1, pdf_generation_status = $2, pdf_generated_at = $3 WHERE id = $4`,
          [pdfBuffer, pdfGenerationStatus, new Date(), reportId]
        );
        console.log(`[ASYNC] PDF saved to database for report ${reportId}`);

        // 通知送信
        const clientEmails = project.client_emails || [];
        const castEmail = castUser.email;
        const displayWriterName = resolvedWriterName;

        // CSV生成
        const rows: string[] = [];
        const headers = [
          '記入者','報告日','天気','案件名','案件住所','作業内容','協力会社名',
          '警備内容1','警備内容2','警備内容3','警備内容4','警備内容5','警備内容6','警備内容7','警備内容8',
          '警備員番号','氏名','勤務開始','勤務終了','早出残業(h)','資格有無','資格者氏名','備考'
        ];
        const weatherMap: Record<string,string> = { sunny: '晴', cloudy: '曇', rainy: '雨', snowy: '雪' };
        const guardFlags = (['traffic','pedestrian','construction','worker_safety','property_safety','detour','alternating','other'] as const)
          .map(code => (guard_contents || []).includes(code as string) ? '1' : '0');
        const guardsArr = Array.isArray(guards) ? guards : [];
        if (guardsArr.length === 0) {
          rows.push([
            resolvedWriterName, workDateStr, weatherMap[weather] || weather,
            (project.work_name || project.work_title_raw || ''), project.location || '', project.work_name || project.work_title_raw || '', project.client_name_raw || '',
            ...guardFlags,
            '', '', '', '', '', (has_qualifier ? '有' : '無'), (Array.isArray(qualifier_name) ? qualifier_name.join('、') : (qualifier_name || '')), ''
          ].map(v => typeof v === 'string' ? `"${v.replace(/"/g,'""')}"` : String(v)).join(','));
        } else {
          for (const g of guardsArr) {
            rows.push([
              resolvedWriterName, workDateStr, weatherMap[weather] || weather,
              (project.work_name || project.work_title_raw || ''), project.location || '', project.work_name || project.work_title_raw || '', project.client_name_raw || '',
              ...guardFlags,
              g.index ?? '', g.name || '', g.start_time || '', g.end_time || '', (g.early_overtime_hours ?? ''), (has_qualifier ? '有' : '無'), (Array.isArray(qualifier_name) ? qualifier_name.join('、') : (qualifier_name || '')), ''
            ].map(v => typeof v === 'string' ? `"${v.replace(/"/g,'""')}"` : String(v)).join(','));
          }
        }
        const csvContent = [headers.join(','), ...rows].join('\n');

        const notificationResult = await sendReportApprovalNotifications({
          reportId,
          companyName: project.client_name_raw,
          workDate: workDateStr,
          projectName: project.work_title_raw,
          clientEmails,
          writerEmail: castEmail,
          writerName: displayWriterName,
          supervisorName: supervisor_name || '',
          location: project.location || '',
          pdfBytes: pdfBuffer,
          csvBytes: Buffer.from(csvContent, 'utf-8')
        });

        console.log(`[ASYNC] Notifications sent for report ${reportId}:`, notificationResult);
      } catch (asyncError) {
        console.error(`[ASYNC] Background processing failed for report ${reportId}:`, asyncError);
      }
    });

  } catch (error) {
    console.error('Approve error:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    sendInternalError(res, `承認処理中にエラーが発生しました: ${errorMessage}`);
  }
});

export default router;
