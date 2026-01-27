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

export async function sendReportApprovalNotifications(params: {
  reportId: string;
  companyName: string;
  workDate: string;
  projectName: string;
  clientEmails: string[];
  pdfBytes: Buffer;
  csvBytes?: Buffer;
}): Promise<{ emailSent: boolean; slackSent: boolean; warnings: string[] }> {
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
    warnings.push(`メール送信失敗: ${emailResult.error}`);
  }

  const slackResult = await sendSlackNotification({
    companyName: params.companyName,
    workDate: params.workDate,
    projectName: params.projectName,
    reportId: params.reportId
  });

  if (!slackResult.success) {
    warnings.push(`Slack通知失敗: ${slackResult.error}`);
  }

  return {
    emailSent: emailResult.success,
    slackSent: slackResult.success,
    warnings
  };
}
