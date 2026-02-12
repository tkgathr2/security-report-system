import nodemailer from 'nodemailer';

const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '587', 10);
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const SMTP_FROM = process.env.SMTP_FROM || 'noreply@example.com';

const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL || '';

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
}

export async function sendEmail(options: EmailOptions): Promise<{ success: boolean; error?: string }> {
  console.log('[EMAIL] SMTP Config check - HOST:', SMTP_HOST ? 'SET' : 'NOT SET');
  console.log('[EMAIL] SMTP Config check - USER:', SMTP_USER ? 'SET' : 'NOT SET');
  console.log('[EMAIL] SMTP Config check - PASS:', SMTP_PASS ? 'SET' : 'NOT SET');
  console.log('[EMAIL] SMTP Config check - FROM:', SMTP_FROM);
  console.log('[EMAIL] Recipients:', options.to.length > 0 ? options.to.join(', ') : 'EMPTY');
  
  if (options.to.length === 0) {
    console.log('[EMAIL] No recipients, skipping email send');
    return { success: false, error: 'No recipients' };
  }
  
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    console.log('[EMAIL] SMTP not configured, skipping email send');
    console.log('[EMAIL] Would send to:', options.to.join(', '));
    console.log('[EMAIL] Subject:', options.subject);
    return { success: false, error: 'SMTP not configured' };
  }

  try {
    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: {
        user: SMTP_USER,
        pass: SMTP_PASS
      }
    });

    const mailOptions = {
      from: SMTP_FROM,
      to: options.to.join(', '),
      subject: options.subject,
      text: options.text,
      html: options.html,
      attachments: options.attachments?.map(att => ({
        filename: att.filename,
        content: att.content,
        contentType: att.contentType
      }))
    };

    console.log('[EMAIL] Sending email to:', options.to.join(', '));
    await transporter.sendMail(mailOptions);
    console.log('[EMAIL] Email sent successfully');
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
      text: `【デジタル警備報告書システム ほうこちゃん】報告書が承認されました`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*【デジタル警備報告書システム ほうこちゃん】報告書承認通知*\n\n` +
              `*会社名:* ${notification.companyName}\n` +
              `*実施日:* ${notification.workDate}\n` +
              `*案件名:* ${notification.projectName}\n` +
              (notification.location ? `*実施場所:* ${notification.location}\n` : '') +
              (notification.writerName ? `*報告者:* ${notification.writerName}\n` : '') +
              `*報告書ID:* ${notification.reportId}`
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
  csvBytes?: Buffer;
  skipSlack?: boolean;
}): Promise<{ emailSent: boolean; slackSent: boolean; castEmailSent: boolean; adminEmailSent: boolean; warnings: string[] }> {
  const warnings: string[] = [];

  const attachments = [
    {
      filename: `report_${params.workDate}.pdf`,
      content: params.pdfBytes,
      contentType: 'application/pdf'
    },
    ...(params.csvBytes ? [{
      filename: `report_${params.workDate}.csv`,
      content: params.csvBytes,
      contentType: 'text/csv'
    }] : [])
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
      `添付のPDF/CSVファイルをご確認ください。`,
    html: `<p>${params.companyName} 様</p>` +
      `<p>デジタル警備報告書システム【ほうこちゃん】より警備報告書をお送りいたします。</p>` +
      `<ul>` +
      `<li>案件名: ${params.projectName}</li>` +
      `<li>実施日: ${params.workDate}</li>` +
      `</ul>` +
      `<p>添付のPDF/CSVファイルをご確認ください。</p>`,
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
        `添付のPDF/CSVファイルをご確認ください。`,
      html: `<p>${params.writerName} 様</p>` +
        `<p><strong>お仕事お疲れ様でした。</strong></p>` +
        `<p>報告書が正常に送信されました。</p>` +
        `<ul>` +
        `<li>案件名: ${params.projectName}</li>` +
        `<li>実施日: ${params.workDate}</li>` +
        `<li>実施場所: ${params.location}</li>` +
        `<li>監督者: ${params.supervisorName}</li>` +
        `</ul>` +
        `<p>添付のPDF/CSVファイルをご確認ください。</p>`,
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
        `添付のPDF/CSVファイルをご確認ください。`,
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
        `<p>添付のPDF/CSVファイルをご確認ください。</p>`,
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
