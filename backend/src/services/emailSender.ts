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
import { escapeHtml, isValidEmail, maskEmail } from '../utils/validation';

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const EMAIL_FROM = process.env.SMTP_FROM || 'noreply@takagi.bz';

const MAX_RETRIES = 3;
const RETRY_BASE_MS = 1000; // 指数バックオフ: 1s, 2s, 4s

// ユーザー（管理画面）向けの定型エラーメッセージ。生の例外文はSentry/サーバログのみに残す。
const GENERIC_SEND_ERROR = 'メール送信に失敗しました。時間をおいて再度お試しください。';

/**
 * 恒久エラー（4xx, ただし429は除く）かどうかを判定する。
 * 恒久エラーならリトライせず即failedにする。5xx/タイムアウト/429はリトライ対象。
 */
export function isRetryableError(err: unknown): boolean {
  const status = extractStatusCode(err);
  if (status !== null) {
    if (status === 429) return true; // レート制限はバックオフでリトライ
    if (status >= 400 && status < 500) return false; // その他4xxは恒久エラー
    return true; // 5xx等はリトライ
  }
  // ステータス不明（ネットワーク/タイムアウト等）はリトライ対象
  return true;
}

export function extractStatusCode(err: unknown): number | null {
  if (err && typeof err === 'object') {
    const e = err as { statusCode?: unknown; status?: unknown };
    const raw = e.statusCode ?? e.status;
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
    if (typeof raw === 'string' && /^\d+$/.test(raw)) return parseInt(raw, 10);
  }
  return null;
}

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
  /** 再送時にフィーチャーフラグ評価をスキップしたくない場合に true（手動再送経路で使用） */
  enforceFeatureFlag?: boolean;
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
    pdfBuffer, isResend, enforceFeatureFlag,
  } = params;

  // 宛先メールアドレスの検証（特に手動再送経路で不正なログ値が混入し得るため）
  if (!isValidEmail(recipientEmail)) {
    console.warn(`[EMAIL-SENDER] Invalid recipient email, refusing to send: ${maskEmail(recipientEmail)}`);
    return { success: false, error: '宛先メールアドレスの形式が不正です' };
  }

  // recipient_type ホワイトリスト検証
  if (!['client', 'writer', 'admin'].includes(recipientType)) {
    console.warn(`[EMAIL-SENDER] Invalid recipient type: ${recipientType}`);
    return { success: false, error: '宛先種別が不正です' };
  }

  // フィーチャーフラグ評価（手動再送など、呼び出し元でフラグ評価していない経路で使用）
  if (enforceFeatureFlag && !(await isEmailNotificationEnabled())) {
    console.log('[EMAIL-SENDER] email_notification_enabled is OFF. Skipping send.');
    return { success: false, error: 'メール通知機能が無効です' };
  }

  // 冪等性キー生成
  const baseKey = `${reportId}:${recipientEmail}:${recipientType}`;
  const idempotencyKey = isResend ? `${baseKey}:resend:${Date.now()}` : baseKey;

  // ログレコード作成（pending状態）。
  // チェックとINSERTを単一クエリに統合してTOCTOUを排除する。
  // 既にsent済み（status='sent'）の場合はUPDATEがWHEREで弾かれRETURNINGが空になる。
  let logId: string;
  try {
    const logResult = await pool.query(
      `INSERT INTO email_logs (report_id, company_id, recipient_email, recipient_type, status, idempotency_key)
       VALUES ($1, $2, $3, $4, 'pending', $5)
       ON CONFLICT (idempotency_key) DO UPDATE SET
         status = 'pending',
         retry_count = email_logs.retry_count + 1,
         updated_at = NOW()
       WHERE email_logs.status <> 'sent'
       RETURNING id, status`,
      [reportId, companyId, recipientEmail, recipientType, idempotencyKey]
    );

    // RETURNINGが空 = 既にsent済み（冪等性ヒット）。送信フェーズに進まず早期return。
    if (logResult.rows.length === 0) {
      const existing = await pool.query(
        `SELECT id FROM email_logs WHERE idempotency_key = $1`,
        [idempotencyKey]
      );
      console.log('[EMAIL-SENDER] Idempotency hit: already sent, skipping send.');
      return { success: true, logId: existing.rows[0]?.id };
    }

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
  const maskedRecipient = maskEmail(recipientEmail);
  let lastError = '';
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      if (attempt > 0) {
        const delay = RETRY_BASE_MS * Math.pow(2, attempt - 1);
        console.log(`[EMAIL-SENDER] Retry ${attempt}/${MAX_RETRIES} after ${delay}ms for ${maskedRecipient}`);
        await sleep(delay);
      }

      console.log(`[EMAIL-SENDER] Sending to ${maskedRecipient} (attempt ${attempt + 1}/${MAX_RETRIES})`);

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
        console.error(`[EMAIL-SENDER] Resend API error (attempt ${attempt + 1}) for ${maskedRecipient}:`, error);
        // error_messageには生の例外文ではなくユーザー向け定型メッセージを保存（詳細はサーバログのみ）
        await pool.query(
          `UPDATE email_logs SET retry_count = $1, error_message = $2, updated_at = NOW() WHERE id = $3`,
          [attempt + 1, GENERIC_SEND_ERROR, logId]
        );
        // 恒久エラー（4xx, 429除く）はリトライせず即failedで打ち切り
        if (!isRetryableError(error)) {
          console.error(`[EMAIL-SENDER] Permanent error for ${maskedRecipient}, aborting retries.`);
          await updateLogStatus(logId, 'failed', GENERIC_SEND_ERROR);
          return { success: false, error: GENERIC_SEND_ERROR, logId };
        }
        continue;
      }

      // 成功
      const messageId = (data as { id?: string })?.id || null;
      await pool.query(
        `UPDATE email_logs SET status = 'sent', resend_message_id = $1, sent_at = NOW(), retry_count = $2, error_message = NULL, updated_at = NOW()
         WHERE id = $3`,
        [messageId, attempt + 1, logId]
      );
      console.log(`[EMAIL-SENDER] Sent successfully to ${maskedRecipient}, messageId=${messageId}`);
      return { success: true, logId };

    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      console.error(`[EMAIL-SENDER] Exception (attempt ${attempt + 1}) for ${maskedRecipient}:`, lastError);
      await pool.query(
        `UPDATE email_logs SET retry_count = $1, error_message = $2, updated_at = NOW() WHERE id = $3`,
        [attempt + 1, GENERIC_SEND_ERROR, logId]
      ).catch(() => {});
      // 恒久エラーはリトライせず打ち切り
      if (!isRetryableError(err)) {
        console.error(`[EMAIL-SENDER] Permanent exception for ${maskedRecipient}, aborting retries.`);
        await updateLogStatus(logId, 'failed', GENERIC_SEND_ERROR);
        return { success: false, error: GENERIC_SEND_ERROR, logId };
      }
    }
  }

  // 全リトライ失敗
  await updateLogStatus(logId, 'failed', GENERIC_SEND_ERROR);
  console.error(`[EMAIL-SENDER] All ${MAX_RETRIES} attempts failed for ${maskedRecipient}: ${lastError}`);
  return { success: false, error: GENERIC_SEND_ERROR, logId };
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
  /** 手動再送時はtrue。冪等性キーに resend サフィックスを付け、送信済みでも再送する。 */
  isResend?: boolean;
}): Promise<{ sent: number; failed: number; skipped: number; warnings: string[] }> {
  const warnings: string[] = [];
  let sent = 0;
  let failed = 0;
  let skipped = 0;

  // フィーチャーフラグ確認
  const emailNotificationEnabled = await isEmailNotificationEnabled();

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
        isResend: params.isResend,
      });

      if (result.success) {
        sent++;
      } else {
        failed++;
        warnings.push(`メール送信失敗 (${maskEmail(row.email)}): ${result.error}`);
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

// --- ③ 案件取消（現場の中止）連絡メール ---

interface CancellationEmailData {
  companyName: string;
  contactName: string;
  contactTitle: string;
  workDate: string;
  projectName: string;
  location: string;
}

/**
 * 中止連絡メールの本文を生成する。
 * 報告書PDFは添付せず、個人情報を含めない最小限の内容に留める（神谷の方針）。
 */
export function buildCancellationEmailContent(
  data: CancellationEmailData
): { subject: string; text: string; html: string } {
  const contactParts: string[] = [];
  if (data.contactTitle) contactParts.push(data.contactTitle);
  if (data.contactName) contactParts.push(data.contactName);
  const contactLine = contactParts.join(' ');
  const contactLineHtml = contactLine ? escapeHtml(contactLine) + ' ' : '';

  const detail: string[] = [`実施予定日: ${data.workDate}`];
  if (data.location) detail.push(`実施場所: ${data.location}`);
  if (data.projectName) detail.push(`作業名称: ${data.projectName}`);

  return {
    subject: `【デジタル警備報告書システム ほうこちゃん】警備業務 中止のお知らせ ${data.projectName} (${data.workDate})`,
    text: `${data.companyName}\n${contactLine ? contactLine + ' ' : ''}様\n\n` +
      `いつもお世話になっております。\n` +
      `下記の警備業務が中止となりましたのでお知らせいたします。\n\n` +
      detail.join('\n') + `\n\n` +
      `ご不明な点がございましたら弊社までお問い合わせください。`,
    html: `<p>${escapeHtml(data.companyName)}<br>${contactLineHtml}様</p>` +
      `<p>いつもお世話になっております。<br>下記の警備業務が中止となりましたのでお知らせいたします。</p>` +
      `<ul>${detail.map(d => `<li>${escapeHtml(d)}</li>`).join('')}</ul>` +
      `<p>ご不明な点がございましたら弊社までお問い合わせください。</p>`,
  };
}

/**
 * 案件中止時に、会社の通知先（company_emails）へ中止連絡メールを送る。
 * - report が存在しない案件にも送れるよう、email_logs には project_id で記録（report_id=null）。
 * - 冪等性キー `cancel:{projectId}:{email}` で二重送信を防止。
 * - フィーチャーフラグ（email_notification_enabled）がOFFならスキップ。
 * - 通知先未設定はエラーにせずスキップ＋警告。
 */
export async function sendProjectCancellationEmails(params: {
  projectId: string;
  companyId: string | null;
  companyName: string;
  contactName: string;
  contactTitle: string;
  workDate: string;
  projectName: string;
  location: string;
  /** 手動再送時はtrue。冪等性キーに resend サフィックスを付け、送信済みでも再送する。 */
  isResend?: boolean;
}): Promise<{ sent: number; failed: number; skipped: number; warnings: string[] }> {
  const warnings: string[] = [];
  let sent = 0;
  let failed = 0;

  if (!(await isEmailNotificationEnabled())) {
    console.log('[EMAIL-SENDER] email_notification_enabled is OFF. Skipping cancellation emails.');
    return { sent: 0, failed: 0, skipped: 1, warnings: ['メール通知機能が無効です（フィーチャーフラグ: email_notification_enabled）'] };
  }

  if (!params.companyId) {
    warnings.push('案件に会社が紐づいていないため中止連絡メールを送信できません');
    return { sent: 0, failed: 0, skipped: 1, warnings };
  }

  let rows: { email: string }[];
  try {
    const r = await pool.query(
      `SELECT email FROM company_emails
       WHERE company_id = $1 AND is_active = true AND deleted_at IS NULL`,
      [params.companyId]
    );
    rows = r.rows;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[EMAIL-SENDER] Error resolving company emails (cancel):', msg);
    warnings.push(`会社メール解決エラー: ${msg}`);
    return { sent: 0, failed: 1, skipped: 0, warnings };
  }

  if (rows.length === 0) {
    console.log(`[EMAIL-SENDER] No notification emails configured for company ${params.companyId} (cancel)`);
    warnings.push(`会社「${params.companyName}」にメール通知先が未設定です`);
    return { sent: 0, failed: 0, skipped: 1, warnings };
  }

  const { subject, text, html } = buildCancellationEmailContent({
    companyName: params.companyName,
    contactName: params.contactName,
    contactTitle: params.contactTitle,
    workDate: params.workDate,
    projectName: params.projectName,
    location: params.location,
  });

  for (const row of rows) {
    const result = await sendCancellationEmailWithLog({
      projectId: params.projectId,
      companyId: params.companyId,
      recipientEmail: row.email,
      subject,
      text,
      html,
      isResend: params.isResend,
    });
    if (result.success) {
      sent++;
    } else {
      failed++;
      warnings.push(`中止連絡メール送信失敗 (${maskEmail(row.email)}): ${result.error}`);
    }
  }

  return { sent, failed, skipped: 0, warnings };
}

/**
 * 中止連絡メールを1宛先に送信し、email_logs に記録する（冪等・リトライ付き・PDF添付なし）。
 * ①の sendEmailWithLog（report中心）には手を入れず、案件中止専用に独立実装してリスクを隔離する。
 */
async function sendCancellationEmailWithLog(params: {
  projectId: string;
  companyId: string | null;
  recipientEmail: string;
  subject: string;
  text: string;
  html: string;
  /** 手動再送時はtrue。冪等性キーに resend サフィックスを付け、送信済みでも再送する。 */
  isResend?: boolean;
}): Promise<SendResult> {
  const { projectId, companyId, recipientEmail, subject, text, html, isResend } = params;

  if (!isValidEmail(recipientEmail)) {
    console.warn(`[EMAIL-SENDER] Invalid cancel recipient, refusing to send: ${maskEmail(recipientEmail)}`);
    return { success: false, error: '宛先メールアドレスの形式が不正です' };
  }

  const baseCancelKey = `cancel:${projectId}:${recipientEmail}`;
  const idempotencyKey = isResend ? `${baseCancelKey}:resend:${Date.now()}` : baseCancelKey;

  let logId: string;
  try {
    const logResult = await pool.query(
      `INSERT INTO email_logs (report_id, project_id, company_id, recipient_email, recipient_type, status, idempotency_key)
       VALUES (NULL, $1, $2, $3, 'cancel', 'pending', $4)
       ON CONFLICT (idempotency_key) DO UPDATE SET
         status = 'pending',
         retry_count = email_logs.retry_count + 1,
         updated_at = NOW()
       WHERE email_logs.status <> 'sent'
       RETURNING id`,
      [projectId, companyId, recipientEmail, idempotencyKey]
    );

    if (logResult.rows.length === 0) {
      const existing = await pool.query(
        `SELECT id FROM email_logs WHERE idempotency_key = $1`,
        [idempotencyKey]
      );
      console.log('[EMAIL-SENDER] Cancel idempotency hit: already sent, skipping.');
      return { success: true, logId: existing.rows[0]?.id };
    }

    logId = logResult.rows[0].id;
  } catch (err) {
    console.error('[EMAIL-SENDER] Failed to create cancel log record:', err);
    return { success: false, error: 'ログレコード作成失敗' };
  }

  if (!resend) {
    console.log('[EMAIL-SENDER] RESEND_API_KEY not configured, marking cancel as skipped');
    await updateLogStatus(logId, 'skipped', 'Resend API not configured');
    return { success: false, error: 'Resend API not configured', logId };
  }

  const maskedRecipient = maskEmail(recipientEmail);
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      if (attempt > 0) {
        const delay = RETRY_BASE_MS * Math.pow(2, attempt - 1);
        console.log(`[EMAIL-SENDER] Cancel retry ${attempt}/${MAX_RETRIES} after ${delay}ms for ${maskedRecipient}`);
        await sleep(delay);
      }

      console.log(`[EMAIL-SENDER] Sending cancellation to ${maskedRecipient} (attempt ${attempt + 1}/${MAX_RETRIES})`);

      const { data, error } = await resend.emails.send({
        from: EMAIL_FROM,
        to: [recipientEmail],
        subject,
        text,
        html,
      });

      if (error) {
        console.error(`[EMAIL-SENDER] Resend API error (cancel attempt ${attempt + 1}) for ${maskedRecipient}:`, error);
        await pool.query(
          `UPDATE email_logs SET retry_count = $1, error_message = $2, updated_at = NOW() WHERE id = $3`,
          [attempt + 1, GENERIC_SEND_ERROR, logId]
        );
        if (!isRetryableError(error)) {
          await updateLogStatus(logId, 'failed', GENERIC_SEND_ERROR);
          return { success: false, error: GENERIC_SEND_ERROR, logId };
        }
        continue;
      }

      const messageId = (data as { id?: string })?.id || null;
      await pool.query(
        `UPDATE email_logs SET status = 'sent', resend_message_id = $1, sent_at = NOW(), retry_count = $2, error_message = NULL, updated_at = NOW()
         WHERE id = $3`,
        [messageId, attempt + 1, logId]
      );
      console.log(`[EMAIL-SENDER] Cancellation sent to ${maskedRecipient}, messageId=${messageId}`);
      return { success: true, logId };

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[EMAIL-SENDER] Exception (cancel attempt ${attempt + 1}) for ${maskedRecipient}:`, msg);
      await pool.query(
        `UPDATE email_logs SET retry_count = $1, error_message = $2, updated_at = NOW() WHERE id = $3`,
        [attempt + 1, GENERIC_SEND_ERROR, logId]
      ).catch(() => {});
      if (!isRetryableError(err)) {
        await updateLogStatus(logId, 'failed', GENERIC_SEND_ERROR);
        return { success: false, error: GENERIC_SEND_ERROR, logId };
      }
    }
  }

  await updateLogStatus(logId, 'failed', GENERIC_SEND_ERROR);
  console.error(`[EMAIL-SENDER] All ${MAX_RETRIES} cancel attempts failed for ${maskedRecipient}`);
  return { success: false, error: GENERIC_SEND_ERROR, logId };
}

// --- ヘルパー関数 ---

export function buildEmailContent(
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
  if (recipientType === 'client') {
    // 宛名（肩書＋担当者名）。日本のビジネス慣習に合わせ役職を氏名の前に置く。未設定時は「ご担当者様」にフォールバックする。
    const contactParts: string[] = [];
    if (data.contactTitle) contactParts.push(data.contactTitle);
    if (data.contactName) contactParts.push(data.contactName);
    const contactLine = contactParts.length > 0 ? contactParts.join(' ') : '';
    const greetingName = contactLine ? `${contactLine} 様` : 'ご担当者様';

    // 協力会社向けの明細。実施場所と住所は1項目に統合（住所があれば「実施場所（住所）」）。
    const clientDetail: string[] = [`実施日：${data.workDate}`];
    const place = data.location
      ? (data.clientAddress ? `${data.location}（${data.clientAddress}）` : data.location)
      : (data.clientAddress || '');
    if (place) clientDetail.push(`実施場所：${place}`);
    if (data.projectName) clientDetail.push(`作業名称：${data.projectName}`);

    // 署名（送信元）。将来 system_settings 化する想定だが、現状は確定値を埋め込む。
    const signatureText =
      `──────────────\n` +
      `株式会社日本交通誘導\n` +
      `〒540-0031 大阪府大阪市中央区北浜東4番33号 北浜NEXU BUILD 17階\n` +
      `TEL：06-4400-8747 ／ Email：info@kotsuyudo.com\n` +
      `──────────────`;
    const signatureHtml =
      `<hr>` +
      `<p>株式会社日本交通誘導<br>` +
      `〒540-0031 大阪府大阪市中央区北浜東4番33号 北浜NEXU BUILD 17階<br>` +
      `TEL：06-4400-8747 ／ Email：info@kotsuyudo.com</p><hr>`;

    return {
      subject: `【日本交通誘導】警備業務報告書のご送付（${data.projectName}／${data.workDate}実施分）`,
      text: `${data.companyName}\n${greetingName}\n\n` +
        `平素より格別のお引き立てを賜り、厚く御礼申し上げます。\n` +
        `株式会社日本交通誘導でございます。\n\n` +
        `下記の警備業務につきまして、報告書を作成いたしましたのでご送付申し上げます。\n` +
        `お手すきの際にご確認をお願いいたします。\n\n` +
        clientDetail.join('\n') + `\n\n` +
        `報告書の詳細は、添付のPDFファイルをご確認ください。\n` +
        `ご不明な点・お気づきの点がございましたら、下記までお気軽にお問い合わせください。\n\n` +
        `今後とも変わらぬお引き立てを賜りますよう、お願い申し上げます。\n\n` +
        signatureText + `\n` +
        `※本メールはデジタル警備報告書システム「ほうこちゃん」より自動送信されています。\n` +
        `　ご返信は上記連絡先までお願いいたします。`,
      html: `<p>${escapeHtml(data.companyName)}<br>${escapeHtml(greetingName)}</p>` +
        `<p>平素より格別のお引き立てを賜り、厚く御礼申し上げます。<br>株式会社日本交通誘導でございます。</p>` +
        `<p>下記の警備業務につきまして、報告書を作成いたしましたのでご送付申し上げます。お手すきの際にご確認をお願いいたします。</p>` +
        `<ul>${clientDetail.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` +
        `<p>報告書の詳細は、添付のPDFファイルをご確認ください。<br>ご不明な点・お気づきの点がございましたら、下記までお気軽にお問い合わせください。</p>` +
        `<p>今後とも変わらぬお引き立てを賜りますよう、お願い申し上げます。</p>` +
        signatureHtml +
        `<p style="color:#888;font-size:12px">※本メールはデジタル警備報告書システム「ほうこちゃん」より自動送信されています。<br>　ご返信は上記連絡先までお願いいたします。</p>`,
    };
  }

  if (recipientType === 'writer') {
    return {
      subject: `【デジタル警備報告書システム ほうこちゃん】お仕事お疲れ様でした - ${data.projectName} (${data.workDate})`,
      text: `${data.writerName} 様\n\nお仕事お疲れ様でした。\n報告書が正常に送信されました。\n\n` +
        `作業名称: ${data.projectName}\n実施日: ${data.workDate}\n実施場所: ${data.location}\n監督者: ${data.supervisorName}\n\n` +
        `添付のPDFファイルをご確認ください。`,
      html: `<p>${escapeHtml(data.writerName)} 様</p>` +
        `<p><strong>お仕事お疲れ様でした。</strong></p>` +
        `<p>報告書が正常に送信されました。</p>` +
        `<ul><li>作業名称: ${escapeHtml(data.projectName)}</li><li>実施日: ${escapeHtml(data.workDate)}</li>` +
        `<li>実施場所: ${escapeHtml(data.location)}</li><li>監督者: ${escapeHtml(data.supervisorName)}</li></ul>` +
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
      `<ul><li>会社名: ${escapeHtml(data.companyName)}</li><li>作業名称: ${escapeHtml(data.projectName)}</li>` +
      `<li>実施日: ${escapeHtml(data.workDate)}</li><li>実施場所: ${escapeHtml(data.location)}</li>` +
      `<li>監督者: ${escapeHtml(data.supervisorName)}</li><li>記入者: ${escapeHtml(data.writerName)}</li>` +
      `<li>報告書ID: ${escapeHtml(data.reportId)}</li></ul>` +
      `<p>添付のPDFファイルをご確認ください。</p>`,
  };
}

/**
 * フィーチャーフラグ email_notification_enabled を評価する。
 * 取得失敗時は安全側に倒してOFF（false）を返す。
 */
async function isEmailNotificationEnabled(): Promise<boolean> {
  try {
    const flagResult = await pool.query(
      `SELECT value FROM system_settings WHERE key = 'email_notification_enabled'`
    );
    return flagResult.rows.length > 0 && flagResult.rows[0].value === 'true';
  } catch (err) {
    console.warn('[EMAIL-SENDER] Failed to check feature flag, defaulting to OFF:', err);
    return false;
  }
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
