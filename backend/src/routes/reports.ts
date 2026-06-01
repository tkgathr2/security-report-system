import { sendCompanyNotificationEmails } from '../services/emailSender';
import { Router, Request, Response } from 'express';
import pool from '../db/pool';
import { sendReportApprovalNotifications, sendSlackNotification, uploadPdfToSlack } from '../services/notifications';
import { generateReportPdf } from '../services/pdfGenerator';
import { authenticateCast, requireAdmin } from '../middleware/auth';
import { AuthenticatedCastRequest } from '../types';
import { sendBadRequest, sendNotFound, sendConflict, sendForbidden, sendExpired, sendInternalError } from '../utils/errorHandler';
import { logAudit } from '../utils/auditLog';
import { validateStringField, validateArrayItems, MAX_LENGTHS, stripHtmlTags } from '../utils/validation';
import { todayJST, toJSTDateString } from '../utils/dateUtil';
import pdfStorage from '../services/pdfStorage';

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

    if (!req.body || typeof req.body !== 'object') {
      sendBadRequest(res, 'リクエストボディはJSON形式で送信してください');
      return;
    }

    const castUser = (req as AuthenticatedCastRequest).castUser;
    const {
      project_unique_url,
      supervisor_name: rawSupervisorName,
      writer_name: rawWriterName,
      weather,
      guard_contents: rawGuardContents,
      guard_other_text: rawGuardOtherText,
      guards: rawGuards,
      has_qualifier,
      qualifier_name: rawQualifierName,
      signature_png_base64,
      notes: rawNotes,
      partner_company_name: rawPartnerCompanyName
    } = req.body;

    const sanitizeStr = <T,>(v: T): T => (typeof v === 'string' ? (stripHtmlTags(v) as unknown as T) : v);

    const supervisor_name: string | undefined = sanitizeStr(rawSupervisorName);
    const writer_name: string | undefined = sanitizeStr(rawWriterName);
    const guard_contents: unknown = Array.isArray(rawGuardContents)
      ? rawGuardContents.map((item: unknown) => (typeof item === 'string' ? stripHtmlTags(item) : item))
      : rawGuardContents;
    const guard_other_text: string | undefined = sanitizeStr(rawGuardOtherText);
    const guards = Array.isArray(rawGuards)
      ? rawGuards.map((g: { name?: string; [k: string]: unknown }) => ({
          ...g,
          name: typeof g?.name === 'string' ? stripHtmlTags(g.name) : g?.name,
        }))
      : rawGuards;
    const qualifier_name: string | string[] | null | undefined = Array.isArray(rawQualifierName)
      ? (rawQualifierName as unknown[]).map((n) => (typeof n === 'string' ? stripHtmlTags(n) : '')).filter(Boolean) as string[]
      : (typeof rawQualifierName === 'string' ? stripHtmlTags(rawQualifierName) : rawQualifierName);
    const notes: string | undefined = sanitizeStr(rawNotes);
    const partner_company_name: string | undefined = sanitizeStr(rawPartnerCompanyName);
    console.log('[APPROVE] Request body parsed, project_unique_url:', project_unique_url);

    if (!signature_png_base64 || typeof signature_png_base64 !== 'string') {
      sendBadRequest(res, '署名は必須です');
      return;
    }

    if (!/^[A-Za-z0-9+/=]+$/.test(signature_png_base64.replace(/^data:image\/[a-z]+;base64,/, ''))) {
      sendBadRequest(res, '署名データの形式が不正です');
      return;
    }

    if (!guard_contents || !Array.isArray(guard_contents) || guard_contents.filter((g: string) => typeof g === 'string' && g.trim() !== '').length === 0) {
      sendBadRequest(res, '警備内容は1件以上必須です');
      return;
    }

    const supervisorErr = validateStringField(supervisor_name, '現場責任者名', MAX_LENGTHS.PERSON_NAME);
    if (supervisorErr) { sendBadRequest(res, supervisorErr); return; }
    const writerErr = validateStringField(writer_name, '報告者名', MAX_LENGTHS.PERSON_NAME);
    if (writerErr) { sendBadRequest(res, writerErr); return; }
    const guardOtherErr = validateStringField(guard_other_text, '警備内容その他', MAX_LENGTHS.GUARD_OTHER_TEXT);
    if (guardOtherErr) { sendBadRequest(res, guardOtherErr); return; }
    const gcErr = validateArrayItems(guard_contents, '警備内容', MAX_LENGTHS.GUARD_CONTENT_ITEM, MAX_LENGTHS.GUARD_CONTENTS_MAX_ITEMS);
    if (gcErr) { sendBadRequest(res, gcErr); return; }
    if (signature_png_base64 && signature_png_base64.length > MAX_LENGTHS.SIGNATURE_BASE64) {
      sendBadRequest(res, '署名データが大きすぎます');
      return;
    }
    if (Array.isArray(guards)) {
      const guardsErr = validateArrayItems(guards.map((g: { name?: string }) => g?.name || ''), '警備員', MAX_LENGTHS.PERSON_NAME, MAX_LENGTHS.GUARDS_MAX_ITEMS);
      if (guardsErr) { sendBadRequest(res, guardsErr); return; }
    }

    if (has_qualifier === true) {
      const qNames = Array.isArray(qualifier_name) ? qualifier_name : (qualifier_name ? [qualifier_name] : []);
      const validQNames = qNames.filter((n: string) => n && n.trim() !== '');
      if (validQNames.length === 0) {
        sendBadRequest(res, '資格者有の場合、資格者氏名は必須です');
        return;
      }
      const qErr = validateArrayItems(validQNames, '資格者氏名', MAX_LENGTHS.PERSON_NAME, MAX_LENGTHS.QUALIFIER_NAME_MAX_ITEMS);
      if (qErr) { sendBadRequest(res, qErr); return; }
    }

    const validWeathers = ['sunny', 'cloudy', 'rainy', 'snowy', 'windy', 'stormy', 'foggy', 'clear', '晴れ', '曇り', '雨', '雪', '風', '嵐', '霧'];
    if (weather && !validWeathers.includes(weather)) {
      sendBadRequest(res, `天候は次のいずれかを指定してください: ${validWeathers.join(', ')}`);
      return;
    }

    if (!project_unique_url) {
      sendBadRequest(res, 'project_unique_urlは必須です');
      return;
    }

    const projectResult = await pool.query(
      `SELECT p.id, p.status, p.url_expires_at, c.id as client_id, c.name as client_name_raw, p.work_date, p.work_title_raw,
              p.location, p.work_name, p.start_time, p.end_time, c.emails as client_emails, c.contact_email,
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

    // ③ 案件取消: 中止された案件には報告書を提出できない（承認時メールの誤発火も併せて防止）
    if (project.status === 'cancelled') {
      sendBadRequest(res, 'この案件は中止されています。報告書は提出できません。');
      return;
    }

    const now = new Date();
    const expiresAt = new Date(project.url_expires_at);
    if (expiresAt < now) {
      sendExpired(res, '期限切れ');
      return;
    }

    const todayJstStr = todayJST();
    const workDate = project.work_date instanceof Date
      ? toJSTDateString(project.work_date)
      : String(project.work_date).split('T')[0];
    if (workDate > todayJstStr) {
      sendBadRequest(res, 'この案件の作業日はまだ到来していません。当日以降に報告してください。');
      return;
    }

    const rawBase64 = signature_png_base64.replace(/^data:image\/[a-z+]+;base64,/, '');
    const signaturePngBuffer = Buffer.from(rawBase64, 'base64');

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
      ? toJSTDateString(project.work_date)
      : String(project.work_date).split('T')[0];

    // レポートを保存（PDF/通知は後で非同期処理）
    // pdf_bytesカラムはNOT NULL制約があるため、初期値としてダミーPDFを使用
    console.log('[APPROVE] Inserting report into database');
    const initialPdfBuffer = generateDummyPdf();
    const writerStaffIdResult = await pool.query<{ staff_id: string | null }>('SELECT staff_id FROM cast_users WHERE id = $1',[castUser.userId]);
    const writerStaffId: string | null = writerStaffIdResult.rows[0]?.staff_id ?? null;

    const client = await pool.connect();
    let reportId: string = '';

    try {
      await client.query('BEGIN');

      const reportResult = await client.query(
        `INSERT INTO reports (
          project_id, cast_user_id, supervisor_name, writer_staff_id, writer_name, weather,
          guard_contents, guard_other_text, overtime_hours, has_qualifier, qualifier_name,
          signature_png, pdf_bytes, status, approved_at, pdf_generation_status, pdf_generated_at, guards_json, notes, partner_company_name
        ) SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20
        WHERE EXISTS (SELECT 1 FROM projects WHERE id = $1 AND url_expires_at > NOW() AND deleted_at IS NULL)
        ON CONFLICT (project_id) WHERE deleted_at IS NULL DO NOTHING
        RETURNING id`,
        [
          project.id,
          castUser.userId,
          supervisor_name || '',
          writerStaffId,
          resolvedWriterName,
          weather || 'sunny',
          guard_contents,
          guard_other_text || null,
          null,
          has_qualifier || false,
          JSON.stringify(Array.isArray(qualifier_name) ? qualifier_name : (qualifier_name ? [qualifier_name] : [])),
          signaturePngBuffer,
          initialPdfBuffer,
          'approved',
          now,
          'pending',
          null,
          Array.isArray(guards) ? JSON.stringify(guards) : null,
          typeof notes === 'string' ? notes.slice(0, 1000) : null,
          typeof partner_company_name === 'string' && partner_company_name.trim() ? partner_company_name.trim().slice(0, 200) : null
        ]
      );

      if (reportResult.rows.length === 0) {
        await client.query('ROLLBACK');
        const dupCheck = await pool.query('SELECT 1 FROM reports WHERE project_id = $1 AND deleted_at IS NULL', [project.id]);
        if (dupCheck.rows.length > 0) {
          sendConflict(res, 'この案件の報告書は既に提出されています');
        } else {
          sendExpired(res, 'この案件のURLは期限切れです');
        }
        return;
      }

      reportId = reportResult.rows[0].id;
      console.log('[APPROVE] Report inserted successfully, id:', reportId);

      await client.query('COMMIT');
    } catch (err: unknown) {
      await client.query('ROLLBACK');
      const pgCode = (err as { code?: string } | null)?.code;
      if (pgCode === '23505') {
        sendConflict(res, 'この案件の報告書は既に提出されています');
        return;
      }
      throw err;
    } finally {
      client.release();
    }

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
      try {
      console.log(`[ASYNC] Starting background processing for report ${reportId}`);

      // PDF設定を取得
      let pdfLayout = 'classic';
      let pdfDesign = 'A';
      try {
        await pool.query(`CREATE TABLE IF NOT EXISTS system_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TIMESTAMPTZ DEFAULT NOW())`);
        const layoutResult = await pool.query(`SELECT value FROM system_settings WHERE key = 'pdf_layout'`);
        if (layoutResult.rows.length > 0) pdfLayout = layoutResult.rows[0].value;
        const designResult = await pool.query(`SELECT value FROM system_settings WHERE key = 'pdf_design'`);
        if (designResult.rows.length > 0) pdfDesign = designResult.rows[0].value;
      } catch (settingsErr) {
        console.warn('[ASYNC] Failed to fetch PDF settings, using defaults:', settingsErr);
      }

      // PDF生成を最初に実行（Slack通知にPDFリンクを含めるため）
      let pdfBuffer: Buffer;
      let pdfGenerationStatus = 'success';
      try {
        let resolvedGuards: { index: number; name: string; start_time: string; end_time: string; early_overtime_hours?: number | null }[] = Array.isArray(guards) ? guards : [];
        if (resolvedGuards.length === 0) {
          try {
            const castsResult = await pool.query(
              `SELECT pc.staff_no, COALESCE(sm.display_name_kanji, 'No.' || pc.staff_no) as cast_name
               FROM project_casts pc
               LEFT JOIN staff_master sm ON pc.staff_id = sm.id AND sm.deleted_at IS NULL
               WHERE pc.project_id = $1 AND pc.deleted_at IS NULL ORDER BY pc.row_index`,
              [project.id]
            );
            if (castsResult.rows.length > 0) {
              resolvedGuards = castsResult.rows.map((c: { cast_name: string }, idx: number) => ({
                index: idx + 1,
                name: c.cast_name,
                start_time: project.start_time || '',
                end_time: project.end_time || '',
                early_overtime_hours: null
              }));
              console.log(`[ASYNC] Fallback: loaded ${resolvedGuards.length} guards from project_casts`);
            }
          } catch (castErr) {
            console.warn('[ASYNC] Failed to fetch project_casts fallback:', castErr);
          }
        }
        pdfBuffer = await generateReportPdf({
          companyName: project.client_name_raw,
          workDate: workDateStr,
          location: project.location,
          workName: project.work_name || project.work_title_raw,
          supervisorName: supervisor_name || '',
          writerName: resolvedWriterName,
          guardContents: guard_contents,
          guardOtherText: guard_other_text,
          guards: resolvedGuards,
          hasQualifier: has_qualifier || false,
          qualifierName: qualifier_name,
          signaturePng: signaturePngBuffer,
          weather: weather || null,
          notes: typeof notes === 'string' ? notes : null,
          partnerCompanyName: typeof partner_company_name === 'string' && partner_company_name.trim() ? partner_company_name.trim() : null,
          layout: pdfLayout as 'classic' | 'handwritten',
          design: pdfDesign as 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I' | 'J',
        });
        console.log(`[ASYNC] Generated PDF: ${pdfBuffer.length} bytes`);
      } catch (pdfError) {
        console.error('[ASYNC] PDF generation failed:', pdfError);
        pdfBuffer = Buffer.alloc(0);
        pdfGenerationStatus = 'failed';
      }

      try {
        await pdfStorage.savePdf(reportId, pdfBuffer, pdfGenerationStatus);
        console.log(`[ASYNC] PDF saved for report ${reportId}`);
      } catch (dbError) {
        console.error(`[ASYNC] PDF save failed for report ${reportId}:`, dbError);
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

      // クライアントメール送信フラグを確認
      let clientEmailEnabled = false;
      try {
        const clientEmailSetting = await pool.query(
          `SELECT value FROM system_settings WHERE key = 'client_email_enabled'`
        );
        if (clientEmailSetting.rows.length > 0 && clientEmailSetting.rows[0].value === 'true') {
          clientEmailEnabled = true;
        }
      } catch (settingErr) {
        console.warn('[ASYNC] Failed to check client_email_enabled setting, defaulting to OFF:', settingErr);
      }

      // 新メール通知機能（company_emails経由）のフラグを確認。
      // ONのときは新経路で取引先へ送るため、旧経路（clientEmails宛）の取引先送信は必ずskipして二重送信を防ぐ（相互排他）。
      let newEmailNotificationEnabled = false;
      try {
        const newFlagSetting = await pool.query(
          `SELECT value FROM system_settings WHERE key = 'email_notification_enabled'`
        );
        if (newFlagSetting.rows.length > 0 && newFlagSetting.rows[0].value === 'true') {
          newEmailNotificationEnabled = true;
        }
      } catch (settingErr) {
        console.warn('[ASYNC] Failed to check email_notification_enabled setting, defaulting to OFF:', settingErr);
      }

      // 新フラグONなら旧クライアント送信を無効化（writer/admin通知は旧経路のまま残す）
      const skipLegacyClientEmail = newEmailNotificationEnabled || !clientEmailEnabled;

      // メール通知（独立したtry-catch）
      try {
        let clientEmails: string[] = Array.isArray(project.client_emails) ? project.client_emails : [];
        if (clientEmails.length === 0 && project.contact_email) {
          clientEmails = [project.contact_email];
        }
        const castEmail = castUser.email;
        const displayWriterName = resolvedWriterName;

        if (skipLegacyClientEmail) {
          if (newEmailNotificationEnabled) {
            console.log(`[ASYNC] New email notification (company_emails) is ENABLED. Skipping legacy client email to avoid duplicate send for report ${reportId}`);
          } else {
            console.log(`[ASYNC] Client email is DISABLED (system_settings). Skipping client email for report ${reportId}`);
          }
        }

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
          skipSlack: true,
          skipClientEmail: skipLegacyClientEmail
        });

        console.log(`[ASYNC] Email notifications sent for report ${reportId}:`, notificationResult);
      } catch (emailError) {
        console.error(`[ASYNC] Email notification failed for report ${reportId}:`, emailError);
      }

      // 新機能: company_emails経由での取引先メール送信（冪等性・リトライ・ログ記録付き）
      try {
        if (project.client_id) {
          const companyEmailResult = await sendCompanyNotificationEmails({
            reportId,
            companyId: project.client_id,
            companyName: project.client_name_raw || '',
            contactName: project.client_contact_name || '',
            contactTitle: project.client_contact_title || '',
            clientAddress: project.client_address || '',
            workDate: workDateStr,
            projectName: project.work_title_raw || project.work_name || '',
            writerName: resolvedWriterName,
            supervisorName: supervisor_name || '',
            location: project.location || '',
            pdfBuffer,
          });
          console.log(`[ASYNC] Company notification emails for report ${reportId}:`, companyEmailResult);
        }
      } catch (companyEmailErr) {
        console.error(`[ASYNC] Company notification email failed for report ${reportId}:`, companyEmailErr);
      }
      } catch (asyncError) {
        console.error(`[ASYNC] Unhandled error in background processing for report ${reportId}:`, asyncError);
      }
    });

  } catch (error) {
    console.error('Approve error:', error);
    sendInternalError(res, '承認処理中にエラーが発生しました');
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
    // Authorization check for cast users: only allow access to reports they're involved in
    const castUser = (req as AuthenticatedCastRequest).castUser;
    if (castUser && !(req.isAuthenticated && req.isAuthenticated())) {
      const ownerCheck = await pool.query(
        `SELECT 1 FROM reports r
         LEFT JOIN cast_users cu ON cu.id = $2
         LEFT JOIN project_casts pc ON pc.project_id = r.project_id AND pc.deleted_at IS NULL
         WHERE r.id = $1 AND r.deleted_at IS NULL
           AND (r.cast_user_id = $2 OR (cu.staff_id IS NOT NULL AND pc.staff_id = cu.staff_id))
         LIMIT 1`,
        [reportId, castUser.userId]
      );
      if (ownerCheck.rows.length === 0) {
        res.status(403).json({ error: 'FORBIDDEN', message: 'この報告書を閲覧する権限がありません' });
        return;
      }
    }

    const pdf = await pdfStorage.getPdf(reportId);
    if (!pdf) {
      res.status(404).json({ error: 'PDF_NOT_READY', message: 'PDFが見つからないか、まだ生成されていません' });
      return;
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="report-${reportId}.pdf"`);
    res.send(pdf.buffer);
  } catch (error) {
    console.error('[PDF] Download error:', error);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: 'サーバーエラーが発生しました' });
  }
});

export default router;
