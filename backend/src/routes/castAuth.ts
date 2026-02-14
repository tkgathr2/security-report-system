import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import pool from '../db/pool';
import { sendVerificationEmail, sendMagicLinkEmail, sendWelcomeEmail } from '../utils/email';

const router = Router();

const KANJI_VARIANTS: Record<string, string> = {
  '\u9AD9': '\u9AD8', // 髙 → 高
  '\uFA30': '\u4FAE', // 侮 variant
  '\uFA31': '\u4FBB', // 併 variant
  '\u5861': '\u5D0E', // 埼 → 崎
  '\uFA11': '\u5D0E', // 﨑 → 崎
  '\u7E41': '\u7E4B', // 繁 variant
  '\u6FF3': '\u6FA4', // 濃 → 澤
  '\u6FA4': '\u6CA2', // 澤 → 沢
  '\u9DB4': '\u9DB4', // 鶴
  '\u5FB3': '\u5FB3', // 徳
  '\u6589': '\u658E', // 斉 → 斎
  '\u9F4B': '\u658E', // 齋 → 斎
  '\u9F4A': '\u6589', // 齊 → 斉
  '\u5EE3': '\u5E83', // 廣 → 広
  '\u6AFB': '\u685C', // 櫻 → 桜
  '\u6B1D': '\u6B63', // 歝 → 正
  '\u6E0A': '\u6DF5', // 渊 → 淵
  '\u7027': '\u6EDD', // 瀧 → 滝
  '\u702C': '\u6E2C', // 瀬 variant
  '\u5CF0': '\u5CEF', // 峰 → 峯
  '\u5CEF': '\u5CF0', // 峯 → 峰
  '\u9FD4': '\u9F8D', // 龍 variant
  '\u9F8D': '\u7ADC', // 龍 → 竜
  '\u9130': '\u90CE', // 郎 variant
  '\u90DE': '\u90CE', // 郞 → 郎
  '\u83EF': '\u82B1', // 華 → 花
  '\u5B78': '\u5B66', // 學 → 学
  '\u6B78': '\u5E30', // 歸 → 帰
  '\u4E98': '\u4E99', // 亘 → 亙
  '\u4E99': '\u4E98', // 亙 → 亘
};

function normalizeKanjiVariants(name: string): string {
  let normalized = name;
  for (const [variant, standard] of Object.entries(KANJI_VARIANTS)) {
    normalized = normalized.split(variant).join(standard);
  }
  return normalized.replace(/[\s\u3000]/g, '');
}

function generateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

function getBaseUrl(req: Request): string {
  const protocol = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.headers['x-forwarded-host'] || req.get('host');
  return `${protocol}://${host}`;
}

// Register - Step 1: Enter email only
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
    } else {
      // Create new user with email only
      await pool.query(
        `INSERT INTO cast_users (email, verification_token, verification_token_expires)
         VALUES ($1, $2, $3)
         RETURNING id`,
        [normalizedEmail, token, tokenExpires]
      );
    }

    // Send verification email
    const baseUrl = getBaseUrl(req);
    const emailResult = await sendVerificationEmail(normalizedEmail, '', token, baseUrl);

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
    const { token, staffId, name, pin } = req.body;

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

    // If staffId, name and pin provided, complete registration
    if (staffId && name && pin) {
      if (pin.length !== 4 || !/^\d{4}$/.test(pin)) {
        return res.status(400).json({ message: 'PINコードは4桁の数字で入力してください' });
      }

      // Verify staff exists
      const staffCheck = await pool.query(
        'SELECT id, display_name_kanji FROM staff_master WHERE id = $1',
        [staffId]
      );

      if (staffCheck.rows.length === 0) {
        return res.status(400).json({ message: '選択されたスタッフが見つかりません' });
      }

      const pinHash = await bcrypt.hash(pin, 10);

      await pool.query(
        `UPDATE cast_users 
         SET name = $1, pin_hash = $2, email_verified = true, staff_id = $3,
             verification_token = NULL, verification_token_expires = NULL,
             updated_at = NOW()
         WHERE id = $4`,
        [name.trim(), pinHash, staffId, user.id]
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
        email: user.email
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

    // Get user with staff info
    const userResult = await pool.query(
      `SELECT cu.id, cu.email, cu.name, cu.staff_id, sm.display_name_kanji as staff_name
       FROM cast_users cu
       LEFT JOIN staff_master sm ON cu.staff_id = sm.id
       WHERE cu.magic_link_token = $1 AND cu.magic_link_expires > NOW()`,
      [token]
    );

    if (userResult.rows.length === 0) {
      return res.status(401).json({ message: 'セッションが無効です' });
    }

    const user = userResult.rows[0];

    const dateParam = req.query.date as string | undefined;
    const today = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)
      ? dateParam
      : new Date().toISOString().split('T')[0];

    // Use staff_name from staff_master if available, otherwise use cast_users.name
    const matchName = user.staff_name || user.name;

    const normalizedMatchName = normalizeKanjiVariants(matchName);

    const projectsResult = await pool.query(
      `SELECT DISTINCT p.id, p.project_key, p.client_name_raw, p.work_date, p.work_name, 
              p.location, p.status, p.unique_url, p.url_expires_at,
              c.name as client_name
       FROM projects p
       LEFT JOIN clients c ON p.client_id = c.id
       LEFT JOIN project_casts pc ON p.id = pc.project_id
       WHERE p.work_date = $1
         AND p.status = 'active'
         AND (
           pc.cast_name = $2
           OR REPLACE(REPLACE(pc.cast_name, ' ', ''), E'\\u3000', '') = REPLACE(REPLACE($2, ' ', ''), E'\\u3000', '')
           OR TRANSLATE(REPLACE(REPLACE(pc.cast_name, ' ', ''), E'\\u3000', ''), E'\\u9AD9\\uFA11\\u5861\\u6FA4\\u9F8D\\u5EE3\\u6AFB\\u7027\\u90DE\\u9F4B\\u83EF\\u5B78', E'\\u9AD8\\u5D0E\\u5D0E\\u6CA2\\u7ADC\\u5E83\\u685C\\u6EDD\\u90CE\\u658E\\u82B1\\u5B66') = $3
         )
       ORDER BY p.work_date, p.work_name`,
      [today, matchName, normalizedMatchName]
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

// Search staff by kana (for autocomplete)
router.get('/search-staff', async (req: Request, res: Response) => {
  try {
    const { q } = req.query;

    if (!q || typeof q !== 'string' || q.length < 1) {
      return res.json({ staff: [] });
    }

    const searchTerm = q.trim();
    const searchNoSpace = searchTerm.replace(/[\s\u3000]/g, '');
    const searchNormalized = normalizeKanjiVariants(searchTerm);

    const result = await pool.query(
      `SELECT id, display_name_kanji, display_name_kana 
       FROM staff_master 
       WHERE REPLACE(REPLACE(display_name_kana, ' ', ''), E'\\u3000', '') ILIKE $1
          OR display_name_kana ILIKE $2
          OR display_name_kanji ILIKE $2
          OR REPLACE(REPLACE(display_name_kanji, ' ', ''), E'\\u3000', '') ILIKE $1
          OR REPLACE(REPLACE(display_name_kanji, ' ', ''), E'\\u3000', '') ILIKE $3
       ORDER BY 
         CASE 
           WHEN REPLACE(REPLACE(display_name_kana, ' ', ''), E'\\u3000', '') ILIKE $2 THEN 0
           WHEN REPLACE(REPLACE(display_name_kanji, ' ', ''), E'\\u3000', '') ILIKE $2 THEN 1
           ELSE 2
         END,
         display_name_kana
       LIMIT 10`,
      [`%${searchNoSpace}%`, `%${searchTerm}%`, `%${searchNormalized}%`]
    );

    res.json({ staff: result.rows });
  } catch (error) {
    console.error('Search staff error:', error);
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
