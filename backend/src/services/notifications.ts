import { Resend } from 'resend';

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const EMAIL_FROM = process.env.SMTP_FROM || 'noreply@takagi.bz';

const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL || '';
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN || '';
const SLACK_CHANNEL_ID = process.env.SLACK_CHANNEL_ID || '';

interface EmailOptions {
  to: string[];
  subject: string;
  text: string;
  html?: string;
  attachments?: Array<{
    filename: string;
    content: Buffer;
    contentType: string;
  }>;
}

interface SlackNotification {
  companyName: string;
  workDate: string;
  projectName: string;
  reportId: string;
  writerName?: string;
  location?: string;
  pdfUrl?: string;
}

export async function sendEmail(options: EmailOptions): Promise<{ success: boolean; error?: string }> {
  console.log('[EMAIL] Resend API check:', resend ? 'CONFIGURED' : 'NOT SET');
  console.log('[EMAIL] FROM:', EMAIL_FROM);
  console.log('[EMAIL] Recipients:', options.to.length > 0 ? options.to.join(', ') : 'EMPTY');
  
  if (options.to.length === 0) {
    console.log('[EMAIL] No recipients, skipping email send');
    return { success: false, error: 'No recipients' };
  }
  
  if (!resend) {
    console.log('[EMAIL] RESEND_API_KEY not configured, skipping email send');
    console.log('[EMAIL] Would send to:', options.to.join(', '));
    console.log('[EMAIL] Subject:', options.subject);
    return { success: false, error: 'Resend API not configured' };
  }

  try {
    console.log('[EMAIL] Sending email via Resend to:', options.to.join(', '));
    const { data, error } = await resend.emails.send({
      from: EMAIL_FROM,
      to: options.to,
      subject: options.subject,
      text: options.text,
      html: options.html || undefined,
      attachments: options.attachments?.map(att => ({
        filename: att.filename,
        content: att.content.toString('base64'),
      }))
    });

    if (error) {
      console.error('[EMAIL] Resend API error:', error);
      return { success: false, error: error.message };
    }

    console.log('[EMAIL] Email sent successfully via Resend:', data);
    return { success: true };
  } catch (error) {
    console.error('[EMAIL] Failed to send email:', error);
    return { success: false, error: String(error) };
  }
}

export async function sendSlackNotification(notification: SlackNotification): Promise<{ success: boolean; error?: string }> {
  if (!SLACK_WEBHOOK_URL) {
    console.log('[SLACK] Webhook URL not configured, skipping Slack notification');
    console.log('[SLACK] Would send:', JSON.stringify(notification, null, 2));
    return { success: false, error: 'Slack webhook not configured' };
  }

  try {
    const message = {
      text: `<!channel> 【デジタル警備報告書システム ほうこちゃん】報告書が承認されました`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `<!channel>\n*【デジタル警備報告書システム ほうこちゃん】報告書承認通知*\n\n` +
              `*会社名:* ${notification.companyName}\n` +
              `*実施日:* ${notification.workDate}\n` +
              `*案件名:* ${notification.projectName}\n` +
              (notification.location ? `*実施場所:* ${notification.location}\n` : '') +
              (notification.writerName ? `*報告者:* ${notification.writerName}\n` : '') +
              `*報告書ID:* ${notification.reportId}` +
              (notification.pdfUrl ? `\n\n<${notification.pdfUrl}|報告書PDFをダウンロード>` : '')
          }
        }
      ]
    };

    console.log('[SLACK] Sending notification for report:', notification.reportId);
    
    const response = await fetch(SLACK_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message)
    });

    if (!response.ok) {
      throw new Error(`Slack API returned ${response.status}`);
    }

    console.log('[SLACK] Notification sent successfully');
    return { success: true };
  } catch (error) {
    console.error('[SLACK] Failed to send notification:', error);
    return { success: false, error: String(error) };
  }
}

export async function uploadPdfToSlack(params: {
  pdfBuffer: Buffer;
  filename: string;
  reportId: string;
  title: string;
  initialComment?: string;
}): Promise<{ success: boolean; error?: string }> {
  if (!SLACK_BOT_TOKEN) {
    console.log('[SLACK-PDF] Bot token not configured, skipping PDF upload');
    return { success: false, error: 'Slack bot token not configured' };
  }
  if (!SLACK_CHANNEL_ID) {
    console.log('[SLACK-PDF] Channel ID not configured, skipping PDF upload');
    return { success: false, error: 'Slack channel ID not configured' };
  }

  try {
    console.log(`[SLACK-PDF] Starting PDF upload for report ${params.reportId} (${params.pdfBuffer.length} bytes)`);

    const urlRes = await fetch('https://slack.com/api/files.getUploadURLExternal', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SLACK_BOT_TOKEN}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        filename: params.filename,
        length: String(params.pdfBuffer.length)
      })
    });
    const urlData = await urlRes.json() as { ok: boolean; upload_url: string; file_id: string; error?: string };
    if (!urlData.ok) {
      throw new Error(`getUploadURLExternal failed: ${urlData.error}`);
    }
    console.log(`[SLACK-PDF] Got upload URL, file_id: ${urlData.file_id}`);

    const uploadRes = await fetch(urlData.upload_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: params.pdfBuffer
    });
    if (!uploadRes.ok) {
      throw new Error(`File upload failed: ${uploadRes.status}`);
    }
    console.log('[SLACK-PDF] File uploaded successfully');

    const completeRes = await fetch('https://slack.com/api/files.completeUploadExternal', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SLACK_BOT_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        files: [{ id: urlData.file_id, title: params.title }],
        channel_id: SLACK_CHANNEL_ID,
        initial_comment: params.initialComment || `報告書PDF（報告書ID: ${params.reportId}）`
      })
    });
    const completeData = await completeRes.json() as { ok: boolean; error?: string };
    if (!completeData.ok) {
      throw new Error(`completeUploadExternal failed: ${completeData.error}`);
    }

    console.log(`[SLACK-PDF] PDF shared to channel successfully`);
    return { success: true };
  } catch (error) {
    console.error('[SLACK-PDF] Failed to upload PDF to Slack:', error);
    return { success: false, error: String(error) };
  }
}

const ADMIN_EMAILS = (process.env.ADMIN_NOTIFICATION_EMAILS || '').split(',').map(e => e.trim()).filter(Boolean);

export async function sendReportApprovalNotifications(params: {
  reportId: string;
  companyName: string;
  workDate: string;
  projectName: string;
  clientEmails: string[];
  writerEmail: string;
  writerName: string;
  supervisorName: string;
  location: string;
  pdfBytes: Buffer;
  skipSlack?: boolean;
}): Promise<{ emailSent: boolean; slackSent: boolean; castEmailSent: boolean; adminEmailSent: boolean; warnings: string[] }> {
  const warnings: string[] = [];

  const attachments = [
    {
      filename: `report_${params.workDate}.pdf`,
      content: params.pdfBytes,
      contentType: 'application/pdf'
    }
  ];

  let slackSent = false;
  if (!params.skipSlack) {
    const slackResult = await sendSlackNotification({
      companyName: params.companyName,
      workDate: params.workDate,
      projectName: params.projectName,
      reportId: params.reportId,
      writerName: params.writerName,
      location: params.location
    });
    slackSent = slackResult.success;
    if (!slackResult.success) {
      warnings.push(`Slack通知失敗: ${slackResult.error}`);
    }
  } else {
    slackSent = true;
  }

  const emailResult = await sendEmail({
    to: params.clientEmails,
    subject: `【デジタル警備報告書システム ほうこちゃん】警備報告書 ${params.projectName} (${params.workDate})`,
    text: `${params.companyName} 様\n\n` +
      `デジタル警備報告書システム【ほうこちゃん】より警備報告書をお送りいたします。\n\n` +
      `案件名: ${params.projectName}\n` +
      `実施日: ${params.workDate}\n\n` +
      `添付のPDFファイルをご確認ください。`,
    html: `<p>${params.companyName} 様</p>` +
      `<p>デジタル警備報告書システム【ほうこちゃん】より警備報告書をお送りいたします。</p>` +
      `<ul>` +
      `<li>案件名: ${params.projectName}</li>` +
      `<li>実施日: ${params.workDate}</li>` +
      `</ul>` +
      `<p>添付のPDFファイルをご確認ください。</p>`,
    attachments
  });

  if (!emailResult.success) {
    warnings.push(`クライアントメール送信失敗: ${emailResult.error}`);
  }

  let castEmailSent = false;
  if (params.writerEmail) {
    const castResult = await sendEmail({
      to: [params.writerEmail],
      subject: `【ほうこちゃん】お仕事お疲れ様でした - ${params.projectName} (${params.workDate})`,
      text: `${params.writerName} 様\n\n` +
        `お仕事お疲れ様でした。\n` +
        `報告書が正常に送信されました。\n\n` +
        `案件名: ${params.projectName}\n` +
        `実施日: ${params.workDate}\n` +
        `実施場所: ${params.location}\n` +
        `監督者: ${params.supervisorName}\n\n` +
        `添付のPDFファイルをご確認ください。`,
      html: `<p>${params.writerName} 様</p>` +
        `<p><strong>お仕事お疲れ様でした。</strong></p>` +
        `<p>報告書が正常に送信されました。</p>` +
        `<ul>` +
        `<li>案件名: ${params.projectName}</li>` +
        `<li>実施日: ${params.workDate}</li>` +
        `<li>実施場所: ${params.location}</li>` +
        `<li>監督者: ${params.supervisorName}</li>` +
        `</ul>` +
        `<p>添付のPDFファイルをご確認ください。</p>`,
      attachments
    });
    castEmailSent = castResult.success;
    if (!castResult.success) {
      warnings.push(`キャストメール送信失敗: ${castResult.error}`);
    }
  }

  let adminEmailSent = false;
  if (ADMIN_EMAILS.length > 0) {
    const adminResult = await sendEmail({
      to: ADMIN_EMAILS,
      subject: `【ほうこちゃん・管理者通知】報告書提出 ${params.projectName} (${params.workDate})`,
      text: `管理者様\n\n` +
        `新しい報告書が提出されました。\n\n` +
        `会社名: ${params.companyName}\n` +
        `案件名: ${params.projectName}\n` +
        `実施日: ${params.workDate}\n` +
        `実施場所: ${params.location}\n` +
        `監督者: ${params.supervisorName}\n` +
        `記入者: ${params.writerName}\n` +
        `報告書ID: ${params.reportId}\n\n` +
        `添付のPDFファイルをご確認ください。`,
      html: `<p>管理者様</p>` +
        `<p><strong>新しい報告書が提出されました。</strong></p>` +
        `<ul>` +
        `<li>会社名: ${params.companyName}</li>` +
        `<li>案件名: ${params.projectName}</li>` +
        `<li>実施日: ${params.workDate}</li>` +
        `<li>実施場所: ${params.location}</li>` +
        `<li>監督者: ${params.supervisorName}</li>` +
        `<li>記入者: ${params.writerName}</li>` +
        `<li>報告書ID: ${params.reportId}</li>` +
        `</ul>` +
        `<p>添付のPDFファイルをご確認ください。</p>`,
      attachments
    });
    adminEmailSent = adminResult.success;
    if (!adminResult.success) {
      warnings.push(`管理者メール送信失敗: ${adminResult.error}`);
    }
  }

  return {
    emailSent: emailResult.success,
    slackSent,
    castEmailSent,
    adminEmailSent,
    warnings
  };
}
