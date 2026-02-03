import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import pool from '../db/pool';
import { sendVerificationEmail, sendMagicLinkEmail, sendWelcomeEmail } from '../utils/email';

const router = Router();

function generateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

function getBaseUrl(req: Request): string {
  const protocol = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.headers['x-forwarded-host'] || req.get('host');
  return `${protocol}://${host}`;
}

// Register - Step 1: Enter email
router.post('/register', async (req: Request, res: Response) => {
  try {
    const { email } = req.body;

    if (!email || !email.includes('@')) {
      return res.status(400).json({ message: 'メールアドレスを入力してください' });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Check if user already exists
    const existingUser = await pool.query(
      'SELECT id, email_verified, name FROM cast_users WHERE email = $1',
      [normalizedEmail]
    );

    let userId: string;
    const token = generateToken();
    const tokenExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    if (existingUser.rows.length > 0) {
      const user = existingUser.rows[0];
      if (user.email_verified && user.name) {
        return res.status(400).json({ 
          message: '既に登録済みです。ログインしてください',
          redirect: '/cast/login'
        });
      }
      // Update verification token for incomplete registration
      await pool.query(
        `UPDATE cast_users 
         SET verification_token = $1, verification_token_expires = $2, updated_at = NOW()
         WHERE id = $3`,
        [token, tokenExpires, user.id]
      );
      userId = user.id;
    } else {
      // Create new user
      const result = await pool.query(
        `INSERT INTO cast_users (email, verification_token, verification_token_expires)
         VALUES ($1, $2, $3)
         RETURNING id`,
        [normalizedEmail, token, tokenExpires]
      );
      userId = result.rows[0].id;
    }

    // Send verification email
    const baseUrl = getBaseUrl(req);
    const emailResult = await sendVerificationEmail(normalizedEmail, null, token, baseUrl);

    if (!emailResult.success) {
      console.error('Failed to send verification email:', emailResult.error);
      return res.status(500).json({ message: 'メール送信に失敗しました。しばらく経ってから再度お試しください' });
    }

    res.json({ 
      message: '確認メールを送信しました。メールをご確認ください',
      email: normalizedEmail
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ message: '登録に失敗しました' });
  }
});

// Verify email and complete registration
router.post('/verify', async (req: Request, res: Response) => {
  try {
    const { token, name, pin } = req.body;

    if (!token) {
      return res.status(400).json({ message: '無効なリンクです' });
    }

    // Find user by token
    const result = await pool.query(
      `SELECT id, email, name FROM cast_users 
       WHERE verification_token = $1 AND verification_token_expires > NOW()`,
      [token]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ message: 'リンクが無効または期限切れです。再度登録してください' });
    }

    const user = result.rows[0];

    // If name and pin provided, complete registration
    if (name && pin) {
      if (pin.length !== 4 || !/^\d{4}$/.test(pin)) {
        return res.status(400).json({ message: 'PINコードは4桁の数字で入力してください' });
      }

      const pinHash = await bcrypt.hash(pin, 10);

      await pool.query(
        `UPDATE cast_users 
         SET name = $1, pin_hash = $2, email_verified = true, 
             verification_token = NULL, verification_token_expires = NULL,
             updated_at = NOW()
         WHERE id = $3`,
        [name.trim(), pinHash, user.id]
      );

      // Send welcome email
      const baseUrl = getBaseUrl(req);
      await sendWelcomeEmail(user.email, name.trim(), baseUrl);

      // Create session token
      const sessionToken = generateToken();
      await pool.query(
        `UPDATE cast_users SET magic_link_token = $1, magic_link_expires = $2, last_login_at = NOW()
         WHERE id = $3`,
        [sessionToken, new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), user.id]
      );

      res.json({ 
        message: '登録が完了しました',
        token: sessionToken,
        user: { id: user.id, email: user.email, name: name.trim() }
      });
    } else {
      // Return user info for form completion
      res.json({ 
        valid: true,
        email: user.email,
        existingName: user.name
      });
    }
  } catch (error) {
    console.error('Verification error:', error);
    res.status(500).json({ message: '認証に失敗しました' });
  }
});

// Login with email and PIN
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, pin } = req.body;

    if (!email || !pin) {
      return res.status(400).json({ message: 'メールアドレスとPINコードを入力してください' });
    }

    const normalizedEmail = email.toLowerCase().trim();

    const result = await pool.query(
      `SELECT id, email, name, pin_hash, email_verified FROM cast_users WHERE email = $1`,
      [normalizedEmail]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ message: 'メールアドレスまたはPINコードが正しくありません' });
    }

    const user = result.rows[0];

    if (!user.email_verified || !user.pin_hash) {
      return res.status(401).json({ 
        message: '登録が完了していません。メールをご確認ください',
        redirect: '/cast/register'
      });
    }

    const pinValid = await bcrypt.compare(pin, user.pin_hash);
    if (!pinValid) {
      return res.status(401).json({ message: 'メールアドレスまたはPINコードが正しくありません' });
    }

    // Create session token
    const sessionToken = generateToken();
    await pool.query(
      `UPDATE cast_users SET magic_link_token = $1, magic_link_expires = $2, last_login_at = NOW()
       WHERE id = $3`,
      [sessionToken, new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), user.id]
    );

    res.json({
      message: 'ログイン成功',
      token: sessionToken,
      user: { id: user.id, email: user.email, name: user.name }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'ログインに失敗しました' });
  }
});

// Request magic link
router.post('/magic-link', async (req: Request, res: Response) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ message: 'メールアドレスを入力してください' });
    }

    const normalizedEmail = email.toLowerCase().trim();

    const result = await pool.query(
      `SELECT id, email, name, email_verified FROM cast_users WHERE email = $1`,
      [normalizedEmail]
    );

    if (result.rows.length === 0 || !result.rows[0].email_verified) {
      return res.status(404).json({ 
        message: '登録されていないメールアドレスです',
        redirect: '/cast/register'
      });
    }

    const user = result.rows[0];
    const token = generateToken();
    const tokenExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await pool.query(
      `UPDATE cast_users SET magic_link_token = $1, magic_link_expires = $2 WHERE id = $3`,
      [token, tokenExpires, user.id]
    );

    const baseUrl = getBaseUrl(req);
    const emailResult = await sendMagicLinkEmail(user.email, user.name, token, baseUrl);

    if (!emailResult.success) {
      return res.status(500).json({ message: 'メール送信に失敗しました' });
    }

    res.json({ message: 'メールを送信しました。メールをご確認ください' });
  } catch (error) {
    console.error('Magic link error:', error);
    res.status(500).json({ message: 'エラーが発生しました' });
  }
});

// Verify magic link
router.get('/magic', async (req: Request, res: Response) => {
  try {
    const { token } = req.query;

    if (!token || typeof token !== 'string') {
      return res.status(400).json({ message: '無効なリンクです' });
    }

    const result = await pool.query(
      `SELECT id, email, name FROM cast_users 
       WHERE magic_link_token = $1 AND magic_link_expires > NOW()`,
      [token]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ message: 'リンクが無効または期限切れです' });
    }

    const user = result.rows[0];

    // Create new session token
    const sessionToken = generateToken();
    await pool.query(
      `UPDATE cast_users SET magic_link_token = $1, magic_link_expires = $2, last_login_at = NOW()
       WHERE id = $3`,
      [sessionToken, new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), user.id]
    );

    res.json({
      message: 'ログイン成功',
      token: sessionToken,
      user: { id: user.id, email: user.email, name: user.name }
    });
  } catch (error) {
    console.error('Magic link verify error:', error);
    res.status(500).json({ message: 'エラーが発生しました' });
  }
});

// Get current user
router.get('/me', async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: '認証が必要です' });
    }

    const token = authHeader.substring(7);

    const result = await pool.query(
      `SELECT id, email, name FROM cast_users 
       WHERE magic_link_token = $1 AND magic_link_expires > NOW()`,
      [token]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ message: 'セッションが無効です。再度ログインしてください' });
    }

    const user = result.rows[0];
    res.json({ user });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ message: 'エラーが発生しました' });
  }
});

// Get today's projects for the logged-in cast
router.get('/today', async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: '認証が必要です' });
    }

    const token = authHeader.substring(7);

    // Get user
    const userResult = await pool.query(
      `SELECT id, email, name FROM cast_users 
       WHERE magic_link_token = $1 AND magic_link_expires > NOW()`,
      [token]
    );

    if (userResult.rows.length === 0) {
      return res.status(401).json({ message: 'セッションが無効です' });
    }

    const user = userResult.rows[0];

    // Get today's projects where this cast is assigned
    // Match by name in project_casts table or by staff_name in CSV import
    const today = new Date().toISOString().split('T')[0];

    const projectsResult = await pool.query(
      `SELECT DISTINCT p.id, p.project_key, p.client_name_raw, p.work_date, p.work_name, 
              p.location, p.status, p.unique_url, p.url_expires_at,
              c.name as client_name
       FROM projects p
       LEFT JOIN clients c ON p.client_id = c.id
       LEFT JOIN project_casts pc ON p.id = pc.project_id
       LEFT JOIN staff_master sm ON pc.staff_id = sm.id
       WHERE p.work_date = $1
         AND p.status = 'active'
         AND (
           sm.display_name_kanji = $2 
           OR sm.display_name_kana = $2
           OR pc.staff_name = $2
         )
       ORDER BY p.work_date, p.work_name`,
      [today, user.name]
    );

    res.json({ 
      user,
      date: today,
      projects: projectsResult.rows 
    });
  } catch (error) {
    console.error('Get today projects error:', error);
    res.status(500).json({ message: 'エラーが発生しました' });
  }
});

// Logout
router.post('/logout', async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      await pool.query(
        `UPDATE cast_users SET magic_link_token = NULL, magic_link_expires = NULL 
         WHERE magic_link_token = $1`,
        [token]
      );
    }
    res.json({ message: 'ログアウトしました' });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ message: 'エラーが発生しました' });
  }
});

export default router;
