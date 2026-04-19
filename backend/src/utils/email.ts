import { Resend } from 'resend';

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

const FROM_EMAIL = 'noreply@takagi.bz';
const APP_NAME = 'デジタル警備報告書システム ほうこちゃん';

export async function sendVerificationEmail(email: string, name: string | null, token: string, baseUrl: string) {
  if (!resend) {
    console.log('RESEND_API_KEY not configured, skipping email');
    return { success: false, error: 'Email not configured' };
  }

  const verifyUrl = `${baseUrl}/cast/verify?token=${token}`;

  try {
    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: email,
      subject: `【${APP_NAME}】メールアドレスの確認`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #E67E22;">【${APP_NAME}】メールアドレスの確認</h2>
          ${name ? `<p>${name} 様</p>` : '<p>こんにちは</p>'}
          <p>以下のボタンをクリックして、登録を完了してください。</p>
          <p style="margin: 30px 0;">
            <a href="${verifyUrl}" 
               style="display: inline-block; padding: 15px 30px; background: #E67E22; color: white; text-decoration: none; border-radius: 8px; font-weight: bold;">
              登録を完了する
            </a>
          </p>
          <p style="color: #666; font-size: 14px;">
            このリンクは24時間有効です。<br>
            心当たりがない場合は、このメールを無視してください。
          </p>
        </div>
      `,
    });

    if (error) {
      console.error('Failed to send verification email:', error);
      return { success: false, error: error.message };
    }

    console.log('Verification email sent:', data);
    return { success: true, data };
  } catch (error) {
    console.error('Email send error:', error);
    return { success: false, error: String(error) };
  }
}

export async function sendMagicLinkEmail(email: string, name: string, token: string, baseUrl: string) {
  if (!resend) {
    console.log('RESEND_API_KEY not configured, skipping email');
    return { success: false, error: 'Email not configured' };
  }

  const magicUrl = `${baseUrl}/cast/magic?token=${token}`;

  try {
    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: email,
      subject: `【${APP_NAME}】今日の現場を確認`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #E67E22;">【${APP_NAME}】今日の現場</h2>
          <p>${name} 様</p>
          <p>以下のボタンをクリックして、今日の現場を確認してください。</p>
          <p style="margin: 30px 0;">
            <a href="${magicUrl}" 
               style="display: inline-block; padding: 15px 30px; background: #E67E22; color: white; text-decoration: none; border-radius: 8px; font-weight: bold;">
              今日の現場を見る
            </a>
          </p>
          <p style="color: #666; font-size: 14px;">
            このリンクは1時間有効です。
          </p>
        </div>
      `,
    });

    if (error) {
      console.error('Failed to send magic link email:', error);
      return { success: false, error: error.message };
    }

    console.log('Magic link email sent:', data);
    return { success: true, data };
  } catch (error) {
    console.error('Email send error:', error);
    return { success: false, error: String(error) };
  }
}

export async function sendPinResetEmail(email: string, name: string, token: string, baseUrl: string) {
  if (!resend) {
    console.log('RESEND_API_KEY not configured, skipping email');
    return { success: false, error: 'Email not configured' };
  }

  const resetUrl = `${baseUrl}/cast/reset-pin?token=${token}`;

  try {
    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: email,
      subject: `【${APP_NAME}】暗証番号の再設定`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #E67E22;">【${APP_NAME}】暗証番号の再設定</h2>
          <p>${name} 様</p>
          <p>暗証番号の再設定リクエストを受け付けました。</p>
          <p>以下のボタンをクリックして、新しい暗証番号を設定してください。</p>
          <p style="margin: 30px 0;">
            <a href="${resetUrl}" 
               style="display: inline-block; padding: 15px 30px; background: #E67E22; color: white; text-decoration: none; border-radius: 8px; font-weight: bold;">
              暗証番号を再設定する
            </a>
          </p>
          <p style="color: #666; font-size: 14px;">
            このリンクは1時間有効です。<br>
            心当たりがない場合は、このメールを無視してください。
          </p>
        </div>
      `,
    });

    if (error) {
      console.error('Failed to send pin reset email:', error);
      return { success: false, error: error.message };
    }

    console.log('Pin reset email sent:', data);
    return { success: true, data };
  } catch (error) {
    console.error('Email send error:', error);
    return { success: false, error: String(error) };
  }
}

export async function sendLoginUrlEmail(email: string, name: string, loginUrl: string, isRegistered: boolean) {
  if (!resend) {
    console.log('RESEND_API_KEY not configured, skipping email');
    return { success: false, error: 'Email not configured' };
  }

  try {
    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: email,
      subject: `【${APP_NAME}】報告画面のご案内`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #E67E22;">【${APP_NAME}】報告画面のご案内</h2>
          ${name ? `<p>${name} 様</p>` : '<p>こんにちは</p>'}
          <p>以下のボタンをクリックして、${isRegistered ? 'ログイン' : '登録'}してください。</p>
          <p style="margin: 30px 0;">
            <a href="${loginUrl}" 
               style="display: inline-block; padding: 15px 30px; background: #E67E22; color: white; text-decoration: none; border-radius: 8px; font-weight: bold;">
              ${isRegistered ? 'ログインする' : '登録する'}
            </a>
          </p>
          <p style="color: #666; font-size: 14px;">
            ${isRegistered ? 'ログイン' : '登録'}後、本日の案件を確認して報告書を作成できます。
          </p>
        </div>
      `,
    });

    if (error) {
      console.error('Failed to send login URL email:', error);
      return { success: false, error: error.message };
    }

    console.log('Login URL email sent:', data);
    return { success: true, data };
  } catch (error) {
    console.error('Email send error:', error);
    return { success: false, error: String(error) };
  }
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export async function sendInquiryNotificationEmail(params: {
  adminEmails: string[];
  senderName: string;
  senderEmail: string;
  category: string;
  message: string;
  hasScreenshot: boolean;
}) {
  if (!resend) {
    console.log('RESEND_API_KEY not configured, skipping email');
    return { success: false, error: 'Email not configured' };
  }

  if (params.adminEmails.length === 0) {
    return { success: false, error: 'No admin emails configured' };
  }

  const categoryLabels: Record<string, string> = {
    bug: 'バグ報告',
    unclear: 'わかりにくい点',
    other: 'その他',
  };
  const categoryLabel = categoryLabels[params.category] || params.category;

  try {
    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: params.adminEmails,
      subject: `【${APP_NAME}・問合せ】${categoryLabel} - ${params.senderName}`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #E67E22;">【${APP_NAME}】ユーザーからの問合せ</h2>
          <table style="border-collapse: collapse; width: 100%; margin: 20px 0;">
            <tr><td style="padding: 8px; border: 1px solid #ddd; background: #f8f9fa; font-weight: bold; width: 120px;">送信者</td><td style="padding: 8px; border: 1px solid #ddd;">${escapeHtml(params.senderName)}</td></tr>
            <tr><td style="padding: 8px; border: 1px solid #ddd; background: #f8f9fa; font-weight: bold;">メール</td><td style="padding: 8px; border: 1px solid #ddd;">${escapeHtml(params.senderEmail)}</td></tr>
            <tr><td style="padding: 8px; border: 1px solid #ddd; background: #f8f9fa; font-weight: bold;">カテゴリ</td><td style="padding: 8px; border: 1px solid #ddd;">${categoryLabel}</td></tr>
          </table>
          <div style="background: #f8f9fa; border: 1px solid #ddd; border-radius: 8px; padding: 16px; margin: 20px 0;">
            <p style="margin: 0; white-space: pre-wrap;">${escapeHtml(params.message)}</p>
          </div>
          ${params.hasScreenshot ? '<p style="color: #666; font-size: 14px;">📎 スクリーンショットが添付されています（管理画面の問合せ一覧から確認できます）</p>' : ''}
        </div>
      `,
    });

    if (error) {
      console.error('Failed to send inquiry notification email:', error);
      return { success: false, error: error.message };
    }

    console.log('Inquiry notification email sent:', data);
    return { success: true, data };
  } catch (error) {
    console.error('Email send error:', error);
    return { success: false, error: String(error) };
  }
}

export async function sendDailyReminderEmail(params: {
  email: string;
  name: string;
  magicLoginUrl: string;
  projects: { workName: string; location: string }[];
  workDate: string;
  timing?: 'morning' | 'evening'; // morning=当日9時, evening=前日21時
}) {
  if (!resend) {
    console.log('RESEND_API_KEY not configured, skipping email');
    return { success: false, error: 'Email not configured' };
  }

  const { email, name, magicLoginUrl, projects, workDate, timing = 'morning' } = params;

  // Format date for display (e.g. "2026年4月13日")
  const [y, m, d] = workDate.split('-');
  const dateDisplay = `${y}年${parseInt(m)}月${parseInt(d)}日`;

  const isEvening = timing === 'evening';
  const subject = isEvening
    ? `【ほうこちゃん】明日の現場のご案内📋`
    : `【ほうこちゃん】本日の現場レポートはこちらから📋`;
  const greeting = isEvening
    ? `こんばんは！<br>明日（${dateDisplay}）の現場情報をお届けします🌙`
    : `おはようございます！<br>本日（${dateDisplay}）の現場情報をお届けします🌅`;

  const projectInfoBoxes = projects.map(p => {
    const loc = p.location || '未定';
    const escapedLoc = escapeHtml(loc);
    const mapUrl = loc !== '未定' ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(loc)}` : '';
    const locationHtml = mapUrl
      ? `<a href="${mapUrl}" style="color: #E67E22; text-decoration: underline;" target="_blank">${escapedLoc} 📍</a>`
      : escapedLoc;
    return `
    <div style="background-color: #FFF8F3; border-left: 4px solid #E67E22; padding: 16px; margin: 0 0 12px 0; border-radius: 0 8px 8px 0;">
      <p style="margin: 0 0 6px 0; font-size: 14px;"><strong>実施日：</strong>${dateDisplay}</p>
      <p style="margin: 0 0 6px 0; font-size: 14px;"><strong>業務名：</strong>${escapeHtml(p.workName || '未定')}</p>
      <p style="margin: 0; font-size: 14px;"><strong>実施場所：</strong>${locationHtml}</p>
    </div>`;
  }).join('');

  try {
    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: email,
      subject,
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; background-color: #ffffff;">
          <div style="background-color: #E67E22; padding: 24px 20px; text-align: center; border-radius: 8px 8px 0 0;">
            <p style="color: white; font-size: 12px; margin: 0 0 4px 0; opacity: 0.9;">デジタル警備報告書システム</p>
            <p style="color: white; font-size: 20px; font-weight: bold; margin: 0;">ほうこちゃん</p>
          </div>
          <div style="padding: 24px 20px;">
            <p style="font-size: 16px; margin: 0 0 20px 0;">${greeting}</p>
            ${projectInfoBoxes}
            <div style="text-align: center; margin: 24px 0;">
              <a href="${magicLoginUrl}" style="display: inline-block; padding: 16px 32px; background: #E67E22; color: white; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px;">
                📝 報告書を入力する
              </a>
            </div>
            <p style="color: #888; font-size: 12px; margin: 0;">※ このリンクの有効期限は24時間です。</p>
          </div>
          <div style="background-color: #f8f9fa; padding: 16px 20px; text-align: center; border-top: 1px solid #eee;">
            <p style="color: #999; font-size: 12px; margin: 0;">このメールは【ほうこちゃん】から自動送信されています。</p>
          </div>
        </div>
      `,
    });

    if (error) {
      console.error('Failed to send daily reminder email:', error);
      return { success: false, error: error.message };
    }

    console.log('Daily reminder email sent:', data);
    return { success: true, data };
  } catch (error) {
    console.error('Email send error:', error);
    return { success: false, error: String(error) };
  }
}

export async function sendWelcomeEmail(email: string, name: string, baseUrl: string) {
  if (!resend) {
    console.log('RESEND_API_KEY not configured, skipping email');
    return { success: false, error: 'Email not configured' };
  }

  const loginUrl = `${baseUrl}/cast/login`;

  try {
    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: email,
      subject: `【${APP_NAME}】登録完了のお知らせ`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #E67E22;">【${APP_NAME}】登録完了</h2>
          <p>${name} 様</p>
          <p>登録が完了しました。</p>
          <p>以下のボタンからログインして、今日の現場を確認できます。</p>
          <p style="margin: 30px 0;">
            <a href="${loginUrl}" 
               style="display: inline-block; padding: 15px 30px; background: #E67E22; color: white; text-decoration: none; border-radius: 8px; font-weight: bold;">
              ログインする
            </a>
          </p>
        </div>
      `,
    });

    if (error) {
      console.error('Failed to send welcome email:', error);
      return { success: false, error: error.message };
    }

    console.log('Welcome email sent:', data);
    return { success: true, data };
  } catch (error) {
    console.error('Email send error:', error);
    return { success: false, error: String(error) };
  }
}
