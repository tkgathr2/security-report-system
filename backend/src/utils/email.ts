import { Resend } from 'resend';

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

const FROM_EMAIL = 'noreply@takagi.bz';
const APP_NAME = 'ほうこちゃん';

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
      subject: `【${APP_NAME}】暗証番号のリセット`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #E67E22;">【${APP_NAME}】暗証番号のリセット</h2>
          <p>${name} 様</p>
          <p>暗証番号のリセットリクエストを受け付けました。</p>
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
