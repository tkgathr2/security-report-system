/**
 * emailSender.ts — 冪等性保証付きメール送信サービス
 *
 * 仕様書 v1.0 準拠:
 * - F-2: 承認時にPDF付きメール自動送信
 * - F-4: 送信結果記録
 * - F-5: 手動再送
 * - 冪等性: report_id + recipient_email + recipient_type でユニーク
 * - リトライ: 最大3回（指数バックオフ）
 * - ログ: email_logs テーブルに全送信を記録
 */
import { Resend } from 'resend';
import pool from '../db/pool';

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const EMAIL_FROM = process.env.SMTP_FROM || 'noreply@takagi.bz';

const MAX_RETRIES = 3;
const RETRY_BASE_MS = 1000; // 指数バックオフ: 1s, 2s, 4s

interface SendEmailWithLogParams {
  reportId: string;
  companyId: string | null;
  recipientEmail: string;
  recipientType: 'client' | 'writer' | 'admin';
  companyName: string;
  contactName: string;
  contactTitle: string;
  clientAddress: string;
  workDate: string;
  projectName: string;
  writerName: string;
  supervisorName: string;
  location: string;
  pdfBuffer: Buffer;
  isResend?: boolean;
}

interface SendResult {
  success: boolean;
  error?: string;
  logId?: string;
}

/**
 * 冪等性チェック付きでメールを送信し、email_logsに記録する
 */
export async function sendEmailWithLog(params: SendEmailWithLogParams): Promise<SendResult> {
  const {
    reportId, companyId, recipientEmail, recipientType,
    companyName, contactName, contactTitle, clientAddress,
    workDate, projectName, writerName, supervisorName, location,
    pdfBuffer, isResend,
  } = params;

  // 冪等性キー生成
  const baseKey = `${reportId}:${recipientEmail}:${recipientType}`;
  const idempotencyKey = isResend ? `${baseKey}:resend:${Date.now()}` : baseKey;

  // 冪等性チェック（再送でない場合）
  if (!isResend) {
    try {
      const existing = await pool.query(
        `SELECT id, status FROM email_logs WHERE idempotency_key = $1`,
        [idempotencyKey]
      );
      if (existing.rows.length > 0 && existing.rows[0].status === 'sent') {
        console.log(`[EMAIL-SENDER] Idempotency hit: already sent for key=${idempotencyKey}`);
        return { success: true, logId: existing.rows[0].id };
      }
    } catch (err) {
      console.error('[EMAIL-SENDER] Idempotency check failed:', err);
    }
  }

  // ログレコード作成（pending状態）
  let logId: string;
  try {
    const logResult = await pool.query(
      `INSERT INTO email_logs (report_id, company_id, recipient_email, recipient_type, status, idempotency_key)
       VALUES ($1, $2, $3, $4, 'pending', $5)
       ON CONFLICT (idempotency_key) DO UPDATE SET
         status = 'pending',
         retry_count = email_logs.retry_count + 1,
         updated_at = NOW()
       RETURNING id`,
      [reportId, companyId, recipientEmail, recipientType, idempotencyKey]
    );
    logId = logResult.rows[0].id;
  } catch (err) {
    console.error('[EMAIL-SENDER] Failed to create log record:', err);
    return { success: false, error: 'ログレコード作成失敗' };
  }

  // Resend未設定チェック
  if (!resend) {
    console.log('[EMAIL-SENDER] RESEND_API_KEY not configured, marking as skipped');
    await updateLogStatus(logId, 'skipped', 'Resend API not configured');
    return { success: false, error: 'Resend API not configured', logId };
  }

  // メール本文生成
  const { subject, text, html } = buildEmailContent(recipientType, {
    companyName, contactName, contactTitle, clientAddress,
    workDate, projectName, writerName, supervisorName, location,
    reportId,
  });

  // リトライ付き送信
  let lastError = '';
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      if (attempt > 0) {
        const delay = RETRY_BASE_MS * Math.pow(2, attempt - 1);
        console.log(`[EMAIL-SENDER] Retry ${attempt}/${MAX_RETRIES} after ${delay}ms for ${recipientEmail}`);
        await sleep(delay);
      }

      console.log(`[EMAIL-SENDER] Sending to ${recipientEmail} (attempt ${attempt + 1}/${MAX_RETRIES})`);

      const attachments = (pdfBuffer && pdfBuffer.length > 0) ? [{
        filename: `report_${workDate}.pdf`,
        content: pdfBuffer.toString('base64'),
      }] : [];

      const { data, error } = await resend.emails.send({
        from: EMAIL_FROM,
        to: [recipientEmail],
        subject,
        text,
        html,
        attachments,
      });

      if (error) {
        lastError = error.message;
        console.error(`[EMAIL-SENDER] Resend API error (attempt ${attempt + 1}):`, error);
        await pool.query(
          `UPDATE email_logs SET retry_count = $1, error_message = $2, updated_at = NOW() WHERE id = $3`,
          [attempt + 1, lastError, logId]
        );
        continue;
      }

      // 成功
      const messageId = (data as { id?: string })?.id || null;
      await pool.query(
        `UPDATE email_logs SET status = 'sent', resend_message_id = $1, sent_at = NOW(), retry_count = $2, error_message = NULL, updated_at = NOW()
         WHERE id = $3`,
        [messageId, attempt + 1, logId]
      );
      console.log(`[EMAIL-SENDER] Sent successfully to ${recipientEmail}, messageId=${messageId}`);
      return { success: true, logId };

    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      console.error(`[EMAIL-SENDER] Exception (attempt ${attempt + 1}):`, lastError);
      await pool.query(
        `UPDATE email_logs SET retry_count = $1, error_message = $2, updated_at = NOW() WHERE id = $3`,
        [attempt + 1, lastError, logId]
      ).catch(() => {});
    }
  }

  // 全リトライ失敗
  await updateLogStatus(logId, 'failed', lastError);
  console.error(`[EMAIL-SENDER] All ${MAX_RETRIES} attempts failed for ${recipientEmail}: ${lastError}`);
  return { success: false, error: lastError, logId };
}

/**
 * 承認時に会社の通知先メールを解決して一括送信する
 */
export async function sendCompanyNotificationEmails(params: {
  reportId: string;
  companyId: string;
  companyName: string;
  contactName: string;
  contactTitle: string;
  clientAddress: string;
  workDate: string;
  projectName: string;
  writerName: string;
  supervisorName: string;
  location: string;
  pdfBuffer: Buffer;
}): Promise<{ sent: number; failed: number; skipped: number; warnings: string[] }> {
  const warnings: string[] = [];
  let sent = 0;
  let failed = 0;
  let skipped = 0;

  // フィーチャーフラグ確認
  let emailNotificationEnabled = false;
  try {
    const flagResult = await pool.query(
      `SELECT value FROM system_settings WHERE key = 'email_notification_enabled'`
    );
    if (flagResult.rows.length > 0 && flagResult.rows[0].value === 'true') {
      emailNotificationEnabled = true;
    }
  } catch (err) {
    console.warn('[EMAIL-SENDER] Failed to check feature flag, defaulting to OFF:', err);
  }

  if (!emailNotificationEnabled) {
    console.log('[EMAIL-SENDER] email_notification_enabled is OFF. Skipping company notification emails.');
    return { sent: 0, failed: 0, skipped: 1, warnings: ['メール通知機能が無効です（フィーチャーフラグ: email_notification_enabled）'] };
  }

  // company_emailsから通知先を取得
  try {
    const emailsResult = await pool.query(
      `SELECT id, email, label FROM company_emails
       WHERE company_id = $1 AND is_active = true AND deleted_at IS NULL`,
      [params.companyId]
    );

    if (emailsResult.rows.length === 0) {
      console.log(`[EMAIL-SENDER] No notification emails configured for company ${params.companyId}`);
      warnings.push(`会社「${params.companyName}」にメール通知先が未設定です`);
      return { sent: 0, failed: 0, skipped: 1, warnings };
    }

    console.log(`[EMAIL-SENDER] Found ${emailsResult.rows.length} notification email(s) for company ${params.companyName}`);

    // 各宛先に送信
    for (const row of emailsResult.rows) {
      const result = await sendEmailWithLog({
        reportId: params.reportId,
        companyId: params.companyId,
        recipientEmail: row.email,
        recipientType: 'client',
        companyName: params.companyName,
        contactName: params.contactName,
        contactTitle: params.contactTitle,
        clientAddress: params.clientAddress,
        workDate: params.workDate,
        projectName: params.projectName,
        writerName: params.writerName,
        supervisorName: params.supervisorName,
        location: params.location,
        pdfBuffer: params.pdfBuffer,
      });

      if (result.success) {
        sent++;
      } else {
        failed++;
        warnings.push(`メール送信失敗 (${row.email}): ${result.error}`);
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[EMAIL-SENDER] Error resolving company emails:', msg);
    warnings.push(`会社メール解決エラー: ${msg}`);
    failed++;
  }

  return { sent, failed, skipped, warnings };
}

// --- ヘルパー関数 ---

function buildEmailContent(
  recipientType: 'client' | 'writer' | 'admin',
  data: {
    companyName: string;
    contactName: string;
    contactTitle: string;
    clientAddress: string;
    workDate: string;
    projectName: string;
    writerName: string;
    supervisorName: string;
    location: string;
    reportId: string;
  }
): { subject: string; text: string; html: string } {
  const detailItems: string[] = [
    `実施日: ${data.workDate}`,
  ];
  if (data.location) detailItems.push(`実施場所: ${data.location}`);
  if (data.clientAddress) detailItems.push(`住所: ${data.clientAddress}`);
  detailItems.push(`作業名称: ${data.projectName}`);

  if (recipientType === 'client') {
    const contactParts: string[] = [];
    if (data.contactName) contactParts.push(data.contactName);
    if (data.contactTitle) contactParts.push(data.contactTitle);
    const contactLine = contactParts.length > 0 ? contactParts.join(' ') : '';

    return {
      subject: `【デジタル警備報告書システム ほうこちゃん】警備報告書 ${data.projectName} (${data.workDate})`,
      text: `${data.companyName}\n${contactLine ? contactLine + ' ' : ''}様\n\n` +
        `デジタル警備報告書システム【ほうこちゃん】より警備報告書をお送りいたします。\n\n` +
        detailItems.join('\n') + `\n\n` +
        `添付のPDFファイルをご確認ください。`,
      html: `<p>${data.companyName}<br>${contactLine ? contactLine + ' ' : ''}様</p>` +
        `<p>デジタル警備報告書システム【ほうこちゃん】より警備報告書をお送りいたします。</p>` +
        `<ul>${detailItems.map(item => `<li>${item}</li>`).join('')}</ul>` +
        `<p>添付のPDFファイルをご確認ください。</p>`,
    };
  }

  if (recipientType === 'writer') {
    return {
      subject: `【デジタル警備報告書システム ほうこちゃん】お仕事お疲れ様でした - ${data.projectName} (${data.workDate})`,
      text: `${data.writerName} 様\n\nお仕事お疲れ様でした。\n報告書が正常に送信されました。\n\n` +
        `作業名称: ${data.projectName}\n実施日: ${data.workDate}\n実施場所: ${data.location}\n監督者: ${data.supervisorName}\n\n` +
        `添付のPDFファイルをご確認ください。`,
      html: `<p>${data.writerName} 様</p>` +
        `<p><strong>お仕事お疲れ様でした。</strong></p>` +
        `<p>報告書が正常に送信されました。</p>` +
        `<ul><li>作業名称: ${data.projectName}</li><li>実施日: ${data.workDate}</li>` +
        `<li>実施場所: ${data.location}</li><li>監督者: ${data.supervisorName}</li></ul>` +
        `<p>添付のPDFファイルをご確認ください。</p>`,
    };
  }

  // admin
  return {
    subject: `【デジタル警備報告書システム ほうこちゃん・管理者通知】報告書承認 ${data.projectName} (${data.workDate})`,
    text: `管理者様\n\n新しい報告書が承認されました。\n\n` +
      `会社名: ${data.companyName}\n作業名称: ${data.projectName}\n実施日: ${data.workDate}\n` +
      `実施場所: ${data.location}\n監督者: ${data.supervisorName}\n記入者: ${data.writerName}\n` +
      `報告書ID: ${data.reportId}\n\n添付のPDFファイルをご確認ください。`,
    html: `<p>管理者様</p>` +
      `<p><strong>新しい報告書が承認されました。</strong></p>` +
      `<ul><li>会社名: ${data.companyName}</li><li>作業名称: ${data.projectName}</li>` +
      `<li>実施日: ${data.workDate}</li><li>実施場所: ${data.location}</li>` +
      `<li>監督者: ${data.supervisorName}</li><li>記入者: ${data.writerName}</li>` +
      `<li>報告書ID: ${data.reportId}</li></ul>` +
      `<p>添付のPDFファイルをご確認ください。</p>`,
  };
}

async function updateLogStatus(logId: string, status: string, errorMessage?: string): Promise<void> {
  try {
    await pool.query(
      `UPDATE email_logs SET status = $1, error_message = $2, updated_at = NOW() WHERE id = $3`,
      [status, errorMessage || null, logId]
    );
  } catch (err) {
    console.error('[EMAIL-SENDER] Failed to update log status:', err);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
