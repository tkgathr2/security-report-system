import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import pool from '../db/pool';
import { sendVerificationEmail, sendMagicLinkEmail, sendWelcomeEmail, sendPinResetEmail, sendInquiryNotificationEmail } from '../utils/email';
import { isValidEmail, validateStringField, MAX_LENGTHS } from '../utils/validation';
import { logAudit } from '../utils/auditLog';
import { checkRateLimitDb, recordFailedAttemptDb, resetAttemptsDb, checkAndIncrementRateLimitDb } from '../utils/rateLimit';
import { todayJST, escapeLikePattern } from '../utils/dateUtil';
import { magicLinkHash, authenticateCast } from '../middleware/auth';

const inquiryUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const AUTH_SECRET = process.env.AUTH_SECRET || (process.env.NODE_ENV === 'production' ? '' : 'dev-secret-key');
const JWT_EXPIRES_IN = '24h';
const COOKIE_MAX_AGE_SEC = 30 * 24 * 60 * 60; // 30 days in seconds

function setCastTokenCookie(res: Response, token: string): void {
  res.cookie('castToken', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: COOKIE_MAX_AGE_SEC * 1000, // cookie() takes ms
  });
}

function clearCastTokenCookie(res: Response): void {
  res.cookie('castToken', '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: 0,
  });
}

// Token blacklist for logout functionality
const tokenBlacklist = new Set<string>();

const router = Router();


const KANJI_VARIANTS: Record<string, string> = {
  '髙': '高', // 髙 → 高
  '侮': '侮', // 侮 variant
  '僧': '侻', // 併 variant
  '塡': '崎', // 埼 → 崎
  '﨑': '崎', // 﨑 → 崎
  '繁': '繋', // 繁 variant
  '濳': '澤', // 濃 → 澤
  '澤': '沢', // 澤 → 沢
  '鶴': '鶴', // 鶴
  '徳': '徳', // 徳
  '斉': '斎', // 斉 → 斎
  '齋': '斎', // 齋 → 斎
  '齊': '斉', // 齊 → 斉
  '廣': '広', // 廣 → 広
  '櫻': '桜', // 櫻 → 桜
  '欝': '正', // 歝 → 正
  '渊': '淵', // 渊 → 淵
  '瀧': '滝', // 瀧 → 滝
  '瀬': '測', // 瀬 variant
  '峰': '峯', // 峰 → 峯
  '峯': '峰', // 峯 → 峰
  '鿔': '龍', // 龍 variant
  '龍': '竜', // 龍 → 竜
  '鄰': '郎', // 郎 variant
  '郞': '郎', // 郞 → 郎
  '華': '花', // 華 → 花
  '學': '学', // 學 → 学
  '歸': '帰', // 歸 → 帰
  '亘': '亙', // 亘 → 亙
  '亙': '亘', // 亙 → 亘
};

function normalizeKanjiVariants(name: string): string {
  let normalized = name;
  for (const [variant, standard] of Object.entries(KANJI_VARIANTS)) {
    normalized = normalized.split(variant).join(standard);
  }
  return normalized.replace(/[\s　]/g, '');
}

function generateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

function getBaseUrl(req: Request): string {
  const protocol = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.headers['x-forwarded-host'] || req.get('host');
  return `${protocol}://${host}`;
}

async function autoLinkStaff(userId: string, userEmail: string): Promise<{ staff_id: string; staff_name: string } | null> {
  const result = await pool.query(
    `UPDATE cast_users SET staff_id = sm.id, updated_at = NOW()
     FROM staff_master sm
     WHERE cast_users.id = $1
       AND LOWER(sm.email) = LOWER($2)
       AND sm.deleted_at IS NULL
       AND cast_users.staff_id IS NULL
     RETURNING sm.id as staff_id, sm.display_name_kanji as staff_name`,
    [userId, userEmail]
  );
  return result.rows.length > 0 ? result.rows[0] : null;
}

// Register - Step 1: Enter email only
router.post('/register', async (req: Request, res: Response) => {
  try {
    const { email } = req.body;

    if (!email || !isValidEmail(email)) {
      return res.status(400).json({ message: '正しいメールアドレスを入力してください' });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Check if user already exists
    const existingUser = await pool.query(
      `SELECT cu.id, cu.email_verified, cu.staff_id, sm.display_name_kanji as name
       FROM cast_users cu
       LEFT JOIN staff_master sm ON cu.staff_id = sm.id
       WHERE cu.email = $1 AND cu.deleted_at IS NULL`,
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
      const staffLookup = await pool.query(
        'SELECT id FROM staff_master WHERE LOWER(email) = $1 AND deleted_at IS NULL',
        [normalizedEmail]
      );
      const linkedStaffId = staffLookup.rows.length > 0 ? staffLookup.rows[0].id : null;

      const softDeleted = await pool.query(
        'SELECT id FROM cast_users WHERE email = $1 AND deleted_at IS NOT NULL ORDER BY updated_at DESC LIMIT 1',
        [normalizedEmail]
      );
      if (softDeleted.rows.length > 0) {
        // 復活時は、削除済み(=無効になった旧staff_master)を指す既存staff_idより
        // メールアドレスで新たに特定した現行staff_idを優先する（KZ-127）
        await pool.query(
          `UPDATE cast_users SET deleted_at = NULL, verification_token = $1, verification_token_expires = $2, staff_id = COALESCE($3, staff_id), updated_at = NOW() WHERE id = $4`,
          [token, tokenExpires, linkedStaffId, softDeleted.rows[0].id]
        );
      } else {
        await pool.query(
          `INSERT INTO cast_users (email, verification_token, verification_token_expires, staff_id)
           VALUES ($1, $2, $3, $4)
           RETURNING id`,
          [normalizedEmail, token, tokenExpires, linkedStaffId]
        );
      }
    }

    // Send verification email
    const baseUrl = getBaseUrl(req);
    const emailResult = await sendVerificationEmail(normalizedEmail, '', token, baseUrl);

    if (!emailResult.success) {
      console.error('Failed to send verification email:', emailResult.error);
      return res.status(500).json({ message: 'メール送信に失敗しました。しばらく経ってから再度お試しください' });
    }

    logAudit({ req, actorEmail: normalizedEmail, actorType: 'cast', action: 'CAST_REGISTER', targetType: 'cast_user', payload: { email: normalizedEmail } });

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
      `SELECT cu.id, cu.email, cu.staff_id, sm.display_name_kanji as name
       FROM cast_users cu
       LEFT JOIN staff_master sm ON cu.staff_id = sm.id
       WHERE cu.verification_token = $1 AND cu.verification_token_expires > NOW() AND cu.deleted_at IS NULL`,
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
      const nameErr = validateStringField(name, '氏名', MAX_LENGTHS.PERSON_NAME);
      if (nameErr) { return res.status(400).json({ message: nameErr }); }

      // Verify staff exists and email matches the registering user
      const staffCheck = await pool.query(
        'SELECT id, display_name_kanji, email FROM staff_master WHERE id = $1',
        [staffId]
      );

      if (staffCheck.rows.length === 0) {
        return res.status(400).json({ message: '選択されたスタッフが見つかりません' });
      }

      const staffEmail = staffCheck.rows[0].email;
      if (!staffEmail || staffEmail.toLowerCase().trim() !== user.email.toLowerCase().trim()) {
        return res.status(400).json({ message: '選択したスタッフ情報が一致しません' });
      }

      await pool.query(
        'UPDATE cast_users SET staff_id = NULL, updated_at = NOW() WHERE staff_id = $1 AND deleted_at IS NULL AND id != $2',
        [staffId, user.id]
      );

      const pinHash = await bcrypt.hash(pin, 10);

      await pool.query(
        `UPDATE cast_users 
         SET pin_hash = $1, email_verified = true, staff_id = $2,
             verification_token = NULL, verification_token_expires = NULL,
             updated_at = NOW()
         WHERE id = $3`,
        [pinHash, staffId, user.id]
      );

      await pool.query(
        `UPDATE staff_master SET email = $1, updated_at = NOW() WHERE id = $2 AND (email IS NULL OR email = '')`,
        [user.email, staffId]
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

      logAudit({ req, actorEmail: user.email, actorType: 'cast', action: 'CAST_VERIFY', targetType: 'cast_user', targetId: user.id, payload: { staff_id: staffId } });

      setCastTokenCookie(res, sessionToken);
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

    if (!isValidEmail(email)) {
      return res.status(400).json({ message: '正しいメールアドレスを入力してください' });
    }

    if (typeof pin !== 'string' || !/^\d{4}$/.test(pin)) {
      return res.status(400).json({ message: 'PINコードは4桁の数字で入力してください' });
    }

    const normalizedEmail = email.toLowerCase().trim();

    const rateCheck = await checkRateLimitDb(normalizedEmail);
    if (!rateCheck.allowed) {
      const remainMin = Math.ceil((rateCheck.remainingMs || 0) / 60000);
      return res.status(429).json({ message: `ログイン試行回数が上限を超えました。${remainMin}分後にお試しください` });
    }

    const result = await pool.query(
      `SELECT cu.id, cu.email, cu.pin_hash, cu.email_verified, cu.staff_id,
              sm.display_name_kanji as name
       FROM cast_users cu
       LEFT JOIN staff_master sm ON cu.staff_id = sm.id
       WHERE cu.email = $1 AND cu.deleted_at IS NULL`,
      [normalizedEmail]
    );

    if (result.rows.length === 0) {
      await recordFailedAttemptDb(normalizedEmail);
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
      await recordFailedAttemptDb(normalizedEmail);
      return res.status(401).json({ message: 'メールアドレスまたはPINコードが正しくありません' });
    }

    await resetAttemptsDb(normalizedEmail);

    // Create session token and clear any old verification/magic link tokens
    const sessionToken = generateToken();
    await pool.query(
      `UPDATE cast_users SET magic_link_token = $1, magic_link_expires = $2, last_login_at = NOW(),
       verification_token = NULL, verification_token_expires = NULL
       WHERE id = $3`,
      [sessionToken, new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), user.id]
    );

    // Cleanup expired tokens for other users (background, non-blocking)
    pool.query(
      `UPDATE cast_users SET magic_link_token = NULL, magic_link_expires = NULL
       WHERE magic_link_expires < NOW() AND magic_link_token IS NOT NULL AND deleted_at IS NULL`
    ).catch(() => {});

    logAudit({ req, actorEmail: normalizedEmail, actorType: 'cast', action: 'CAST_LOGIN', targetType: 'cast_user', targetId: user.id, payload: {} });

    setCastTokenCookie(res, sessionToken);
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

    if (!email || !isValidEmail(email)) {
      return res.status(400).json({ message: '正しいメールアドレスを入力してください' });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // 第1段階: 5回/15分 の悪用防止 rate limit（既存）
    const rateCheck = await checkAndIncrementRateLimitDb(`magic-link:${normalizedEmail}`, { maxAttempts: 5, lockDurationMs: 15 * 60 * 1000 });
    if (!rateCheck.allowed) {
      const remainMin = Math.ceil((rateCheck.remainingMs || 0) / 60000);
      return res.status(429).json({ message: `送信回数の上限に達しました。${remainMin}分後にお試しください` });
    }

    // 第2段階: 同一メールへの 5分以内重複送信をブロック
    const lastSendKey = `magic-link-last:${normalizedEmail}`;
    const lastSendCheck = await pool.query(
      `SELECT locked_until FROM rate_limits WHERE key = $1 AND locked_until > NOW()`,
      [lastSendKey]
    );
    if (lastSendCheck.rows.length > 0) {
      const remainMs = new Date(lastSendCheck.rows[0].locked_until).getTime() - Date.now();
      const remainSec = Math.ceil(remainMs / 1000);
      return res.status(429).json({ message: `メールは${remainSec}秒後に再送できます` });
    }

    const result = await pool.query(
      `SELECT cu.id, cu.email, cu.email_verified, cu.staff_id,
              sm.display_name_kanji as name
       FROM cast_users cu
       LEFT JOIN staff_master sm ON cu.staff_id = sm.id
       WHERE cu.email = $1 AND cu.deleted_at IS NULL`,
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
    const emailResult = await sendMagicLinkEmail(user.email, user.name || '', token, baseUrl);

    if (!emailResult.success) {
      return res.status(500).json({ message: 'メール送信に失敗しました' });
    }

    // 送信成功後: 5分間インターバル制限を記録（既存の locked_until 列を流用）
    await pool.query(
      `INSERT INTO rate_limits (key, attempts, locked_until)
       VALUES ($1, 1, NOW() + INTERVAL '5 minutes')
       ON CONFLICT (key) DO UPDATE SET locked_until = NOW() + INTERVAL '5 minutes'`,
      [lastSendKey]
    );

    res.json({ message: 'メールを送信しました。メールをご確認ください' });
  } catch (error) {
    console.error('Magic link error:', error);
    res.status(500).json({ message: 'エラーが発生しました' });
  }
});

// Verify magic link
router.post('/magic', async (req: Request, res: Response) => {
  try {
    const { token } = req.body;

    if (!token || typeof token !== 'string') {
      return res.status(400).json({ message: '無効なリンクです' });
    }

    const result = await pool.query(
      `SELECT cu.id, cu.email, cu.staff_id, sm.display_name_kanji as name
       FROM cast_users cu
       LEFT JOIN staff_master sm ON cu.staff_id = sm.id
       WHERE cu.magic_link_token = $1 AND cu.magic_link_expires > NOW() AND cu.deleted_at IS NULL`,
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

    setCastTokenCookie(res, sessionToken);
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
    let token: string | undefined;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    } else if (req.cookies?.castToken) {
      token = req.cookies.castToken as string;
    }
    if (!token) {
      return res.status(401).json({ message: '認証が必要です' });
    }

    const result = await pool.query(
      `SELECT cu.id, cu.email, cu.staff_id, sm.display_name_kanji as name
       FROM cast_users cu
       LEFT JOIN staff_master sm ON cu.staff_id = sm.id
       WHERE cu.magic_link_token = $1 AND cu.magic_link_expires > NOW() AND cu.deleted_at IS NULL`,
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
    let token: string | undefined;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    } else if (req.cookies?.castToken) {
      token = req.cookies.castToken as string;
    }
    if (!token) {
      return res.status(401).json({ message: '認証が必要です' });
    }

    // Get user with staff info
    const userResult = await pool.query(
      `SELECT cu.id, cu.email, cu.staff_id, sm.display_name_kanji as staff_name
       FROM cast_users cu
       LEFT JOIN staff_master sm ON cu.staff_id = sm.id
       WHERE cu.magic_link_token = $1 AND cu.magic_link_expires > NOW() AND cu.deleted_at IS NULL`,
      [token]
    );

    if (userResult.rows.length === 0) {
      return res.status(401).json({ message: 'セッションが無効です' });
    }

    let user = userResult.rows[0];

    if (!user.staff_id && user.email) {
      const linked = await autoLinkStaff(user.id, user.email);
      if (linked) {
        user = { ...user, staff_id: linked.staff_id, staff_name: linked.staff_name };
      }
    }

    const dateParam = req.query.date as string | undefined;
    const today = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)
      ? dateParam
      : todayJST();

    if (!user.staff_id) {
      return res.json({
        user,
        date: today,
        projects: []
      });
    }

    const projectsResult = await pool.query(
      `SELECT DISTINCT p.id, p.project_key, p.work_date, p.work_name,
              p.location, p.status, p.unique_url, p.url_expires_at,
              c.name as client_name
       FROM projects p
       LEFT JOIN clients c ON p.client_id = c.id
       LEFT JOIN project_casts pc ON p.id = pc.project_id
       LEFT JOIN reports r ON r.project_id = p.id AND r.deleted_at IS NULL
       WHERE p.work_date = $1
         AND p.status = 'active'
         AND p.deleted_at IS NULL
         AND r.id IS NULL
         AND pc.staff_id = $2
       ORDER BY p.work_date, p.work_name`,
     [today, user.staff_id]
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
router.get('/search-staff', authenticateCast, async (req: Request, res: Response) => {
  try {
    const { q } = req.query;

    if (!q || typeof q !== 'string' || q.length < 1) {
      return res.json({ staff: [] });
    }

    const searchTerm = q.trim();
    const searchNoSpace = searchTerm.replace(/[\s　]/g, '');
    const searchNormalized = normalizeKanjiVariants(searchTerm);

    const result = await pool.query(
      `SELECT id, display_name_kanji, display_name_kana
       FROM staff_master
       WHERE deleted_at IS NULL
         AND (REPLACE(REPLACE(display_name_kana, ' ', ''), E'\\u3000', '') ILIKE $1 ESCAPE '\\'
          OR display_name_kana ILIKE $2 ESCAPE '\\'
          OR display_name_kanji ILIKE $2 ESCAPE '\\'
          OR REPLACE(REPLACE(display_name_kanji, ' ', ''), E'\\u3000', '') ILIKE $1 ESCAPE '\\'
          OR REPLACE(REPLACE(display_name_kanji, ' ', ''), E'\\u3000', '') ILIKE $3 ESCAPE '\\')
       ORDER BY
         CASE
           WHEN REPLACE(REPLACE(display_name_kana, ' ', ''), E'\\u3000', '') ILIKE $2 ESCAPE '\\' THEN 0
           WHEN REPLACE(REPLACE(display_name_kanji, ' ', ''), E'\\u3000', '') ILIKE $2 ESCAPE '\\' THEN 1
           ELSE 2
         END,
         display_name_kana
       LIMIT 10`,
      [`%${escapeLikePattern(searchNoSpace)}%`, `%${escapeLikePattern(searchTerm)}%`, `%${escapeLikePattern(searchNormalized)}%`]
    );

    res.json({ staff: result.rows });
  } catch (error) {
    console.error('Search staff error:', error);
    res.status(500).json({ message: 'エラーが発生しました' });
  }
});

// Request PIN reset
router.post('/reset-pin', async (req: Request, res: Response) => {
  try {
    const { email } = req.body;

    if (!email || !isValidEmail(email)) {
      return res.status(400).json({ message: '正しいメールアドレスを入力してください' });
    }

    const normalizedEmail = email.toLowerCase().trim();

    const rateCheck = await checkRateLimitDb(`reset:${normalizedEmail}`);
    if (!rateCheck.allowed) {
      return res.json({ message: 'メールを送信しました。メールをご確認ください' });
    }

    const result = await pool.query(
      `SELECT cu.id, cu.email, cu.email_verified, cu.staff_id,
              sm.display_name_kanji as name
       FROM cast_users cu
       LEFT JOIN staff_master sm ON cu.staff_id = sm.id
       WHERE cu.email = $1 AND cu.deleted_at IS NULL`,
      [normalizedEmail]
    );

    if (result.rows.length === 0 || !result.rows[0].email_verified) {
      await recordFailedAttemptDb(`reset:${normalizedEmail}`);
      logAudit({ req, actorEmail: normalizedEmail, actorType: 'cast', action: 'CAST_PIN_RESET_NOT_FOUND', targetType: 'cast_user', payload: { email: normalizedEmail } });
      return res.json({ message: 'メールを送信しました。メールをご確認ください' });
    }

    const user = result.rows[0];
    const token = generateToken();
    const tokenExpires = new Date(Date.now() + 60 * 60 * 1000);

    await pool.query(
      `UPDATE cast_users SET pin_reset_token = $1, pin_reset_token_expires = $2 WHERE id = $3`,
      [token, tokenExpires, user.id]
    );

    const baseUrl = getBaseUrl(req);
    const emailResult = await sendPinResetEmail(user.email, user.name || '', token, baseUrl);

    if (!emailResult.success) {
      return res.status(500).json({ message: 'メール送信に失敗しました' });
    }

    res.json({ message: 'メールを送信しました。メールをご確認ください' });
  } catch (error) {
    console.error('PIN reset request error:', error);
    res.status(500).json({ message: 'エラーが発生しました' });
  }
});

// Verify PIN reset token
router.get('/reset-pin/verify', async (req: Request, res: Response) => {
  try {
    const { token } = req.query;

    if (!token || typeof token !== 'string') {
      return res.status(400).json({ message: '無効なリンクです' });
    }

    const result = await pool.query(
      `SELECT cu.id, cu.email, cu.staff_id, sm.display_name_kanji as name
       FROM cast_users cu
       LEFT JOIN staff_master sm ON cu.staff_id = sm.id
       WHERE cu.pin_reset_token = $1 AND cu.pin_reset_token_expires > NOW() AND cu.deleted_at IS NULL`,
      [token]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ message: 'リンクが無効または期限切れです' });
    }

    const user = result.rows[0];
    res.json({ valid: true, email: user.email, name: user.name });
  } catch (error) {
    console.error('PIN reset verify error:', error);
    res.status(500).json({ message: 'エラーが発生しました' });
  }
});

// Confirm PIN reset
router.post('/reset-pin/confirm', async (req: Request, res: Response) => {
  try {
    const { token, pin } = req.body;

    if (!token) {
      return res.status(400).json({ message: '無効なリンクです' });
    }

    if (!pin || pin.length !== 4 || !/^\d{4}$/.test(pin)) {
      return res.status(400).json({ message: '暗証番号は4桁の数字で入力してください' });
    }

    const result = await pool.query(
      `SELECT cu.id, cu.email, cu.staff_id, sm.display_name_kanji as name
       FROM cast_users cu
       LEFT JOIN staff_master sm ON cu.staff_id = sm.id
       WHERE cu.pin_reset_token = $1 AND cu.pin_reset_token_expires > NOW() AND cu.deleted_at IS NULL`,
      [token]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ message: 'リンクが無効または期限切れです。再度リセットをお試しください' });
    }

    const user = result.rows[0];
    const pinHash = await bcrypt.hash(pin, 10);

    await pool.query(
      `UPDATE cast_users 
       SET pin_hash = $1, pin_reset_token = NULL, pin_reset_token_expires = NULL, updated_at = NOW()
       WHERE id = $2`,
      [pinHash, user.id]
    );

    const sessionToken = generateToken();
    await pool.query(
      `UPDATE cast_users SET magic_link_token = $1, magic_link_expires = $2, last_login_at = NOW()
       WHERE id = $3`,
      [sessionToken, new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), user.id]
    );

    logAudit({ req, actorEmail: user.email, actorType: 'cast', action: 'CAST_PIN_RESET', targetType: 'cast_user', targetId: user.id, payload: {} });

    setCastTokenCookie(res, sessionToken);
    res.json({
      message: '暗証番号を再設定しました',
      token: sessionToken,
      user: { id: user.id, email: user.email, name: user.name }
    });
  } catch (error) {
    console.error('PIN reset confirm error:', error);
    res.status(500).json({ message: 'エラーが発生しました' });
  }
});

// Logout
router.post('/logout', async (req: Request, res: Response) => {
  try {
    // Resolve token from header or cookie
    const authHeader = req.headers.authorization;
    let token: string | undefined;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    } else if (req.cookies?.castToken) {
      token = req.cookies.castToken as string;
    }
    if (token) {
      const { addTokenToBlacklist } = await import('../middleware/auth');
      await addTokenToBlacklist(token);
      await pool.query(
        `UPDATE cast_users SET magic_link_token = NULL, magic_link_expires = NULL
         WHERE magic_link_token = $1`,
        [token]
      );
    }
    clearCastTokenCookie(res);
    res.json({ message: 'ログアウトしました' });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ message: 'エラーが発生しました' });
  }
});

// --- Field Report endpoints (migrated from auth.ts) ---
// These use JWT tokens for FieldReport.tsx compatibility with authenticateCast middleware.

router.post('/field-login', async (req: Request, res: Response) => {
  try {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      res.status(400).json({
        error: 'INVALID_PAYLOAD',
        message: 'リクエストボディはJSON形式で送信してください',
        details: {}
      });
      return;
    }

    const { email, pin } = req.body;

    if (!email || !pin) {
      res.status(400).json({
        error: 'INVALID_PAYLOAD',
        message: 'メールアドレスとPINは必須です',
        details: {}
      });
      return;
    }

    if (!isValidEmail(email)) {
      res.status(400).json({
        error: 'INVALID_PAYLOAD',
        message: '正しいメールアドレスを入力してください',
        details: {}
      });
      return;
    }

    const normalizedEmail = email.toLowerCase().trim();

    const rateCheck = await checkRateLimitDb(normalizedEmail);
    if (!rateCheck.allowed) {
      const remainMin = Math.ceil((rateCheck.remainingMs || 0) / 60000);
      res.status(429).json({
        error: 'RATE_LIMITED',
        message: `ログイン試行回数が上限を超えました。${remainMin}分後にお試しください`,
        details: {}
      });
      return;
    }

    const result = await pool.query(
      `SELECT cu.id, cu.email, cu.pin_hash, cu.created_at, cu.staff_id,
              sm.display_name_kanji as staff_name
       FROM cast_users cu
       LEFT JOIN staff_master sm ON cu.staff_id = sm.id
       WHERE cu.email = $1 AND cu.deleted_at IS NULL`,
      [normalizedEmail]
    );

    if (result.rows.length === 0) {
      await recordFailedAttemptDb(normalizedEmail);
      res.status(401).json({
        error: 'UNAUTHORIZED',
        message: 'メールアドレスまたはPINが正しくありません',
        details: {}
      });
      return;
    }

    const user = result.rows[0];

    if (!user.pin_hash) {
      await recordFailedAttemptDb(normalizedEmail);
      res.status(401).json({
        error: 'UNAUTHORIZED',
        message: 'メールアドレスまたはPINが正しくありません',
        details: {}
      });
      return;
    }

    const isValidPin = await bcrypt.compare(pin, user.pin_hash);

    if (!isValidPin) {
      await recordFailedAttemptDb(normalizedEmail);
      res.status(401).json({
        error: 'UNAUTHORIZED',
        message: 'メールアドレスまたはPINが正しくありません',
        details: {}
      });
      return;
    }

    await resetAttemptsDb(normalizedEmail);

    const sessionToken = generateToken();
    const sessionExpires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await pool.query(
      'UPDATE cast_users SET magic_link_token = $1, magic_link_expires = $2, updated_at = NOW() WHERE id = $3',
      [sessionToken, sessionExpires, user.id]
    );

    const token = jwt.sign(
      { userId: user.id, email: user.email, mlh: magicLinkHash(sessionToken) },
      AUTH_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    setCastTokenCookie(res, token);
    res.status(200).json({
      user: {
        id: user.id,
        email: user.email,
        created_at: user.created_at,
        staff_id: user.staff_id || null,
        staff_name: user.staff_name || null
      },
      token
    });
  } catch (error) {
    console.error('Field login error:', error);
    res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'ログイン処理中にエラーが発生しました',
      details: {}
    });
  }
});

router.post('/field-register', async (req: Request, res: Response) => {
  try {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      res.status(400).json({
        error: 'INVALID_PAYLOAD',
        message: 'リクエストボディはJSON形式で送信してください',
        details: {}
      });
      return;
    }

    const { email: rawEmail, pin } = req.body;

    if (!rawEmail || !pin) {
      res.status(400).json({
        error: 'INVALID_PAYLOAD',
        message: 'メールアドレスとPINは必須です',
        details: {}
      });
      return;
    }

    const email = String(rawEmail).toLowerCase().trim();

    if (!isValidEmail(email)) {
      res.status(400).json({
        error: 'INVALID_PAYLOAD',
        message: '正しいメールアドレスを入力してください',
        details: {}
      });
      return;
    }

    const pinStr = String(pin);
    if (!/^\d{4,6}$/.test(pinStr)) {
      res.status(400).json({
        error: 'INVALID_PAYLOAD',
        message: 'PINは4〜6桁の数字である必要があります',
        details: {}
      });
      return;
    }

    const staffMatch = await pool.query(
      'SELECT id FROM staff_master WHERE LOWER(email) = $1 AND deleted_at IS NULL',
      [email]
    );
    const matchedStaffId = staffMatch.rows.length > 0 ? staffMatch.rows[0].id : null;

    const existingUser = await pool.query(
      'SELECT id, pin_hash, staff_id, created_at FROM cast_users WHERE email = $1 AND deleted_at IS NULL',
      [email]
    );

    if (existingUser.rows.length > 0) {
      const existing = existingUser.rows[0];
      if (!existing.pin_hash) {
        const pinHash = await bcrypt.hash(pinStr, 10);
        const sessionToken = generateToken();
        const sessionExpires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        // 既存staff_idが削除済みstaff_masterを指している場合があるため、
        // メールアドレスで新たに特定した現行staff_idを優先する（KZ-127）
        const staffId = matchedStaffId || existing.staff_id;
        await pool.query(
          'UPDATE cast_users SET pin_hash = $1, magic_link_token = $2, magic_link_expires = $3, staff_id = COALESCE($5, staff_id), email_verified = true, updated_at = NOW() WHERE id = $4',
          [pinHash, sessionToken, sessionExpires, existing.id, staffId]
        );

        if (staffId) {
          await pool.query(
            'UPDATE staff_master SET email = $1, updated_at = NOW() WHERE id = $2 AND (email IS NULL OR email = \'\')',
            [email, staffId]
          );
        }

        const baseUrl = getBaseUrl(req);
        let staffName: string | null = null;
        if (staffId) {
          const staffNameResult = await pool.query('SELECT display_name_kanji FROM staff_master WHERE id = $1', [staffId]);
          staffName = staffNameResult.rows.length > 0 ? staffNameResult.rows[0].display_name_kanji : null;
        }
        sendWelcomeEmail(email, staffName || email, baseUrl).catch(err => console.error('[EMAIL] field-register welcome email error:', err));

        const token = jwt.sign(
          { userId: existing.id, email, mlh: magicLinkHash(sessionToken) },
          AUTH_SECRET,
          { expiresIn: JWT_EXPIRES_IN }
        );

        setCastTokenCookie(res, token);
        res.status(200).json({
          user: {
            id: existing.id,
            email,
            created_at: existing.created_at
          },
          token
        });
        return;
      }

      res.status(400).json({
        error: 'INVALID_PAYLOAD',
        message: 'このメールアドレスは既に登録されています',
        details: {}
      });
      return;
    }

    const pinHash = await bcrypt.hash(pinStr, 10);
    const sessionToken = generateToken();
    const sessionExpires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    const result = await pool.query(
            `INSERT INTO cast_users (email, pin_hash, magic_link_token, magic_link_expires, staff_id, email_verified)
             VALUES ($1, $2, $3, $4, $5, true)
             ON CONFLICT (LOWER(email)) WHERE deleted_at IS NULL DO NOTHING
             RETURNING id, email, created_at`,
      [email, pinHash, sessionToken, sessionExpires, matchedStaffId]
    );

    if (result.rows.length === 0) {
      res.status(400).json({
        error: 'INVALID_PAYLOAD',
        message: 'このメールアドレスは既に登録されています',
        details: {}
      });
      return;
    }

    if (matchedStaffId) {
      await pool.query(
        'UPDATE staff_master SET email = $1, updated_at = NOW() WHERE id = $2 AND (email IS NULL OR email = \'\')',
        [email, matchedStaffId]
      );
    }

    const user = result.rows[0];

    const baseUrl = getBaseUrl(req);
    let staffName: string | null = null;
    if (matchedStaffId) {
      const staffNameResult = await pool.query('SELECT display_name_kanji FROM staff_master WHERE id = $1', [matchedStaffId]);
      staffName = staffNameResult.rows.length > 0 ? staffNameResult.rows[0].display_name_kanji : null;
    }
    sendWelcomeEmail(email, staffName || email, baseUrl).catch(err => console.error('[EMAIL] field-register welcome email error:', err));

    const token = jwt.sign(
      { userId: user.id, email: user.email, mlh: magicLinkHash(sessionToken) },
      AUTH_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    setCastTokenCookie(res, token);
    res.status(201).json({
      user: {
        id: user.id,
        email: user.email,
        created_at: user.created_at
      },
      token
    });
  } catch (error) {
    console.error('Field register error:', error);
    res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: '登録処理中にエラーが発生しました',
      details: {}
    });
  }
});

router.post('/exchange-cast-token', async (req: Request, res: Response) => {
  try {
    const { cast_token } = req.body;
    if (!cast_token) {
      res.status(400).json({ error: 'INVALID_PAYLOAD', message: 'cast_tokenは必須です', details: {} });
      return;
    }

    const result = await pool.query(
      `SELECT cu.id, cu.email, cu.created_at, cu.staff_id,
              sm.display_name_kanji as staff_name
       FROM cast_users cu
       LEFT JOIN staff_master sm ON cu.staff_id = sm.id
       WHERE cu.magic_link_token = $1 AND cu.magic_link_expires > NOW() AND cu.deleted_at IS NULL`,
      [cast_token]
    );

    if (result.rows.length === 0) {
      res.status(401).json({ error: 'UNAUTHORIZED', message: 'キャストトークンが無効です', details: {} });
      return;
    }

    let user = result.rows[0];

    if (!user.staff_id && user.email) {
      const linked = await autoLinkStaff(user.id, user.email);
      if (linked) {
        user = { ...user, staff_id: linked.staff_id, staff_name: linked.staff_name };
      }
    }

    // exchange 後に magic_link_token をローテーションし、交換に使われたトークンを無効化する。
    // 同一 cast_token での再交換および古いトークンに紐づくJWTを失効させる（mlh 不一致で弾かれる）。
    const rotatedSessionToken = crypto.randomBytes(32).toString('hex');
    const rotatedExpires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await pool.query(
      'UPDATE cast_users SET magic_link_token = $1, magic_link_expires = $2, updated_at = NOW() WHERE id = $3',
      [rotatedSessionToken, rotatedExpires, user.id]
    );

    const token = jwt.sign(
      { userId: user.id, email: user.email, mlh: magicLinkHash(rotatedSessionToken) },
      AUTH_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    setCastTokenCookie(res, token);
    res.status(200).json({
      user: {
        id: user.id,
        email: user.email,
        created_at: user.created_at,
        staff_id: user.staff_id || null,
        staff_name: user.staff_name || null
      },
      token
    });
  } catch (error) {
    console.error('Exchange cast token error:', error);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: 'トークン交換に失敗しました', details: {} });
  }
});

router.post('/mail-help', async (req: Request, res: Response) => {
  try {
    const { email } = req.body;

    if (!email || !isValidEmail(email)) {
      return res.status(400).json({ message: '正しいメールアドレスを入力してください' });
    }

    const normalizedEmail = email.toLowerCase().trim();

    const existingUser = await pool.query(
      `SELECT cu.id, cu.email_verified, cu.staff_id, cu.pin_hash, sm.display_name_kanji as name
       FROM cast_users cu
       LEFT JOIN staff_master sm ON cu.staff_id = sm.id
       WHERE cu.email = $1 AND cu.deleted_at IS NULL`,
      [normalizedEmail]
    );

    if (existingUser.rows.length > 0) {
      const user = existingUser.rows[0];
      if (user.email_verified && user.pin_hash) {
        return res.json({ registered: true, message: 'メールアドレスが登録されています。ログインして下さい' });
      }
    }

    const token = generateToken();
    const tokenExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);

    if (existingUser.rows.length > 0) {
      await pool.query(
        `UPDATE cast_users SET verification_token = $1, verification_token_expires = $2, updated_at = NOW() WHERE id = $3`,
        [token, tokenExpires, existingUser.rows[0].id]
      );
    } else {
      const staffLookup2 = await pool.query(
        'SELECT id FROM staff_master WHERE email = $1 AND deleted_at IS NULL',
        [normalizedEmail]
      );
      const linkedStaffId2 = staffLookup2.rows.length > 0 ? staffLookup2.rows[0].id : null;

      const softDeleted2 = await pool.query(
        'SELECT id FROM cast_users WHERE email = $1 AND deleted_at IS NOT NULL ORDER BY updated_at DESC LIMIT 1',
        [normalizedEmail]
      );
      if (softDeleted2.rows.length > 0) {
        // 復活時は、削除済み(=無効になった旧staff_master)を指す既存staff_idより
        // メールアドレスで新たに特定した現行staff_idを優先する（KZ-127）
        await pool.query(
          `UPDATE cast_users SET deleted_at = NULL, verification_token = $1, verification_token_expires = $2, staff_id = COALESCE($3, staff_id), updated_at = NOW() WHERE id = $4`,
          [token, tokenExpires, linkedStaffId2, softDeleted2.rows[0].id]
        );
      } else {
        await pool.query(
          `INSERT INTO cast_users (email, verification_token, verification_token_expires, staff_id) VALUES ($1, $2, $3, $4)`,
          [normalizedEmail, token, tokenExpires, linkedStaffId2]
        );
      }
    }

    const baseUrl = getBaseUrl(req);
    const emailResult = await sendVerificationEmail(normalizedEmail, '', token, baseUrl);

    if (!emailResult.success) {
      return res.status(500).json({ message: 'メール送信に失敗しました' });
    }

    logAudit({ req, actorEmail: normalizedEmail, actorType: 'cast', action: 'CAST_MAIL_HELP',targetType: 'cast_user', payload: { email: normalizedEmail } });

    res.json({ registered: false, message: 'メールに登録できるようにURLを送りました' });
  } catch (error) {
    console.error('Mail help error:', error);
    res.status(500).json({ message: 'エラーが発生しました' });
  }
});

const ADMIN_NOTIFICATION_EMAILS = (process.env.ADMIN_NOTIFICATION_EMAILS || '').split(',').map(e => e.trim()).filter(Boolean);

router.post('/inquiry', inquiryUpload.single('screenshot'), async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    let token: string | undefined;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    } else if (req.cookies?.castToken) {
      token = req.cookies.castToken as string;
    }
    if (!token) {
      return res.status(401).json({ message: '認証が必要です' });
    }

    const userResult = await pool.query(
      `SELECT cu.id, cu.email, cu.staff_id, sm.display_name_kanji as name
       FROM cast_users cu
       LEFT JOIN staff_master sm ON cu.staff_id = sm.id
       WHERE cu.magic_link_token = $1 AND cu.magic_link_expires > NOW() AND cu.deleted_at IS NULL`,
      [token]
    );

    if (userResult.rows.length === 0) {
      return res.status(401).json({ message: 'セッションが無効です' });
    }

    const user = userResult.rows[0];

    const { category, message } = req.body;

    if (!category || !message) {
      return res.status(400).json({ message: 'カテゴリとメッセージは必須です' });
    }

    const validCategories = ['bug', 'unclear', 'other'];
    if (!validCategories.includes(category)) {
      return res.status(400).json({ message: '無効なカテゴリです' });
    }

    const msgStr = String(message).trim();
    if (msgStr.length === 0 || msgStr.length > 2000) {
      return res.status(400).json({ message: 'メッセージは1〜2000文字で入力してください' });
    }

    const file = req.file;
    let screenshotBytes: Buffer | null = null;
    let screenshotMimeType: string | null = null;

    if (file) {
      const allowedTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
      if (!allowedTypes.includes(file.mimetype)) {
        return res.status(400).json({ message: '画像ファイル（PNG, JPEG, GIF, WebP）のみアップロードできます' });
      }
      screenshotBytes = file.buffer;
      screenshotMimeType = file.mimetype;
    }

    await pool.query(
      `INSERT INTO inquiries (cast_user_id, cast_email, cast_name, category, message, screenshot_bytes, screenshot_mime_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [user.id, user.email, user.name || null, category, msgStr, screenshotBytes, screenshotMimeType]
    );

    const emailResult = await sendInquiryNotificationEmail({
      adminEmails: ADMIN_NOTIFICATION_EMAILS,
      senderName: user.name || user.email,
      senderEmail: user.email,
      category,
      message: msgStr,
      hasScreenshot: !!screenshotBytes,
    });

    if (!emailResult.success) {
      console.log('[INQUIRY] Email notification failed:', emailResult.error);
    }

    logAudit({ req, actorEmail: user.email, actorType: 'cast', action: 'CAST_INQUIRY', targetType: 'inquiry', payload: { category, hasScreenshot: !!screenshotBytes } });

    res.json({ ok: true, message: '問合せを送信しました。ありがとうございます。' });
  } catch (error) {
    console.error('Inquiry error:', error);
    res.status(500).json({ message: '問合せの送信に失敗しました' });
  }
});

export default router;
