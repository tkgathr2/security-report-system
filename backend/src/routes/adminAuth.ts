import { Router, Request, Response, NextFunction } from 'express';
import passport from 'passport';
import { Strategy as GoogleStrategy, Profile } from 'passport-google-oauth20';
import crypto from 'crypto';
import pool from '../db/pool';
import { sendEmail } from '../services/notifications';
import { logAudit } from '../utils/auditLog';

const router = Router();

const GOOGLE_CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET || '';
const GOOGLE_REDIRECT_URL = process.env.GOOGLE_OAUTH_REDIRECT_URL || 'http://localhost:3000/api/admin/auth/google/callback';

interface AdminUser {
  id: string;
  email: string;
  google_sub: string;
  is_active: boolean;
  role: string;
}

declare module 'express-session' {
  interface SessionData {
    oauthState?: string;
    pendingEmail?: string;
    pendingDisplayName?: string;
  }
}

declare global {
  namespace Express {
    interface User {
      id: string;
      email: string;
      is_active: boolean;
      role: string;
    }
  }
}

// Passport serialization (always configured for session support)
passport.serializeUser((user: Express.User, done) => {
  done(null, user.email);
});

passport.deserializeUser(async (email: string, done) => {
  try {
    const result = await pool.query(
      'SELECT id, email, is_active, COALESCE(role, \'admin\') as role FROM admin_allowlist WHERE email = $1 AND is_active = true',
      [email]
    );

    if (result.rows.length === 0) {
      return done(null, false);
    }

    done(null, result.rows[0]);
  } catch (error) {
    done(error);
  }
});

if (GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET) {
  passport.use(new GoogleStrategy({
    clientID: GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
    callbackURL: GOOGLE_REDIRECT_URL,
    scope: ['email', 'profile'],
    state: false,  // Changed from true - avoid conflict with manual state management
    passReqToCallback: true
  }, async (req: Request, accessToken: string, refreshToken: string, _params: any, profile: Profile, done: (error: Error | null, user?: AdminUser | false) => void) => {
    try {
      const email = profile.emails?.[0]?.value;
      const googleSub = profile.id;

      if (!email) {
        return done(null, false);
      }

      // Use case-insensitive email comparison
      const result = await pool.query(
        'SELECT id, email, is_active, COALESCE(role, \'admin\') as role FROM admin_allowlist WHERE LOWER(email) = LOWER($1)',
        [email]
      );

      if (result.rows.length === 0) {
        req.session.pendingEmail = email;
        req.session.pendingDisplayName = profile.displayName || '';
        return done(null, false);
      }

      const admin = result.rows[0];
      if (!admin.is_active) {
        req.session.pendingEmail = email;
        req.session.pendingDisplayName = profile.displayName || '';
        return done(null, false);
      }
      return done(null, {
        id: admin.id,
        email: admin.email,
        google_sub: googleSub,
        is_active: admin.is_active,
        role: admin.role
      });
    } catch (error) {
      return done(error as Error);
    }
  }));
}

function generateState(): string {
  return crypto.randomBytes(32).toString('hex');
}

router.get('/google/start', (req: Request, res: Response, next: NextFunction) => {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    res.status(503).json({
      error: 'OAUTH_NOT_CONFIGURED',
      message: 'Google OAuth認証が設定されていません。環境変数 GOOGLE_OAUTH_CLIENT_ID と GOOGLE_OAUTH_CLIENT_SECRET を設定してください。',
      details: {
        missing: [
          !GOOGLE_CLIENT_ID ? 'GOOGLE_OAUTH_CLIENT_ID' : null,
          !GOOGLE_CLIENT_SECRET ? 'GOOGLE_OAUTH_CLIENT_SECRET' : null
        ].filter(Boolean)
      }
    });
    return;
  }
  
  const state = generateState();
  req.session.oauthState = state;
  
  req.session.save((err) => {
    if (err) {
      console.error('Session save error:', err);
      res.status(500).json({
        error: 'INTERNAL_ERROR',
        message: 'セッション保存に失敗しました',
        details: {}
      });
      return;
    }
    passport.authenticate('google', { 
      scope: ['email', 'profile'],
      state: state
    })(req, res, next);
  });
});

router.get('/google/callback',
  (req: Request, res: Response, next: NextFunction) => {
    const stateFromQuery = req.query.state as string | undefined;
    const stateFromSession = req.session.oauthState;
    
    if (!stateFromQuery || !stateFromSession) {
      res.status(400).json({
        error: 'INVALID_STATE',
        message: 'OAuth stateパラメータが欠落しています',
        details: {}
      });
      return;
    }
    
    if (stateFromQuery !== stateFromSession) {
      res.status(400).json({
        error: 'INVALID_STATE',
        message: 'OAuth stateパラメータが一致しません',
        details: {}
      });
      return;
    }

    delete req.session.oauthState;
    
    passport.authenticate('google', { session: true }, (err: Error | null, user: AdminUser | false) => {
      if (err) {
        console.error('Google OAuth error:', err);
        res.status(500).json({
          error: 'INTERNAL_ERROR',
          message: '認証処理中にエラーが発生しました',
          details: {}
        });
        return;
      }

      if (!user) {
        const pendingEmail = req.session.pendingEmail || '';
        const pendingName = req.session.pendingDisplayName || '';
        delete req.session.pendingEmail;
        delete req.session.pendingDisplayName;
        res.redirect(`/?access_denied=1&name=${encodeURIComponent(pendingName)}`);
        return;
      }

      req.logIn(user, (loginErr) => {
        if (loginErr) {
          console.error('Login error:', loginErr);
          res.status(500).json({
            error: 'INTERNAL_ERROR',
            message: 'セッション確立に失敗しました',
            details: {}
          });
          return;
        }

        logAudit({ req, actorEmail: user.email, action: 'ADMIN_LOGIN', targetType: 'admin', targetId: user.id, payload: {} });

        // ログイン成功後、フロントエンドのダッシュボードにリダイレクト
        res.redirect('/');
      });
    })(req, res, next);
  }
);

// --- Access Request API (no auth required) ---
router.post('/request-access', async (req: Request, res: Response) => {
  try {
    const { email, display_name } = req.body;
    if (!email) {
      res.status(400).json({ error: 'INVALID_PAYLOAD', message: 'メールアドレスは必須です' });
      return;
    }

    const existing = await pool.query(
      'SELECT id, status FROM access_requests WHERE LOWER(email) = LOWER($1) AND status = $2',
      [email, 'pending']
    );
    if (existing.rows.length > 0) {
      res.json({ ok: true, message: '申請済みです。承認をお待ちください。' });
      return;
    }

    const alreadyAdmin = await pool.query(
      'SELECT id FROM admin_allowlist WHERE LOWER(email) = LOWER($1) AND is_active = true',
      [email]
    );
    if (alreadyAdmin.rows.length > 0) {
      res.json({ ok: true, message: '既にアクセス権があります。ログインしてください。' });
      return;
    }

    await pool.query(
      'INSERT INTO access_requests (email, display_name) VALUES ($1, $2)',
      [email, display_name || null]
    );

    const OWNER_EMAIL = process.env.ADMIN_NOTIFICATION_EMAILS || 'atsuhiro@takagi.bz';
    const ownerEmails = OWNER_EMAIL.split(',').map(e => e.trim()).filter(Boolean);

    const BASE_URL = process.env.BASE_URL || 'https://security-report.up.railway.app';
    await sendEmail({
      to: ownerEmails,
      subject: '【デジタル警備報告書システム ほうこちゃん】管理画面アクセス申請',
      text: `管理画面へのアクセス申請がありました。\n\nメール: ${email}\n名前: ${display_name || '未設定'}\n\n管理画面のアカウント管理ページから承認・拒否してください。\n${BASE_URL}`,
      html: `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;font-family:'Helvetica Neue',Arial,sans-serif;background-color:#f5f5f5;">
  <div style="max-width:600px;margin:0 auto;padding:20px;">
    <div style="background-color:#2C3E50;padding:20px 30px;border-radius:8px 8px 0 0;text-align:center;">
      <h1 style="color:#ffffff;margin:0;font-size:20px;">デジタル警備報告書システム【ほうこちゃん】</h1>
    </div>
    <div style="background-color:#ffffff;padding:30px;border-radius:0 0 8px 8px;box-shadow:0 2px 8px rgba(0,0,0,0.1);">
      <h2 style="color:#e67e22;margin:0 0 20px;font-size:18px;border-bottom:2px solid #e67e22;padding-bottom:10px;">管理画面アクセス申請</h2>
      <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
        <tr>
          <td style="padding:10px 12px;background:#f8f9fa;border:1px solid #e9ecef;font-weight:bold;color:#495057;width:120px;">メール</td>
          <td style="padding:10px 12px;border:1px solid #e9ecef;color:#212529;">${email}</td>
        </tr>
        <tr>
          <td style="padding:10px 12px;background:#f8f9fa;border:1px solid #e9ecef;font-weight:bold;color:#495057;">名前</td>
          <td style="padding:10px 12px;border:1px solid #e9ecef;color:#212529;">${display_name || '未設定'}</td>
        </tr>
      </table>
      <div style="text-align:center;margin:25px 0;">
        <a href="${BASE_URL}" style="display:inline-block;background-color:#e67e22;color:#ffffff;text-decoration:none;padding:12px 30px;border-radius:6px;font-size:15px;font-weight:bold;">管理画面で承認・拒否する</a>
      </div>
      <p style="color:#6c757d;font-size:12px;text-align:center;margin:0;">ログイン後「アカウント管理」から申請を処理できます</p>
    </div>
    <p style="color:#adb5bd;font-size:11px;text-align:center;margin-top:15px;">日本交通誘導 デジタル警備報告書システム【ほうこちゃん】</p>
  </div>
</body>
</html>`
    });

    logAudit({ req, actorEmail: email, actorType: 'system', action: 'ACCESS_REQUEST', targetType: 'access_request', payload: { email, display_name: display_name || null } });

    res.json({ ok: true, message: '申請を送信しました。管理者の承認をお待ちください。' });
  } catch (error) {
    console.error('[ACCESS_REQUEST] Error:', error);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: '申請の送信に失敗しました' });
  }
});

// --- Admin Management API (requires super_admin) ---
function requireSuperAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.isAuthenticated || !req.isAuthenticated() || !req.user) {
    res.status(401).json({ error: 'UNAUTHORIZED', message: '管理者セッションがありません' });
    return;
  }
  const user = req.user as Express.User;
  if (user.role !== 'super_admin') {
    res.status(403).json({ error: 'FORBIDDEN', message: 'スーパー管理者権限が必要です' });
    return;
  }
  next();
}

function requireAdminAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.isAuthenticated || !req.isAuthenticated() || !req.user) {
    res.status(401).json({ error: 'UNAUTHORIZED', message: '管理者セッションがありません' });
    return;
  }
  next();
}

router.get('/access-requests',requireSuperAdmin, async (_req: Request, res: Response) => {
  try {
    const result = await pool.query('SELECT * FROM access_requests ORDER BY created_at DESC');
    res.json({ requests: result.rows });
  } catch (error) {
    console.error('[ACCESS_REQUESTS] Error:', error);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: '申請一覧の取得に失敗しました' });
  }
});

router.post('/access-requests/:requestId/approve', requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const requestId = req.params.requestId as string;
    const { role } = req.body;
    const assignRole = role || 'viewer';
    const adminUser = req.user as Express.User;

    const requestResult = await pool.query('SELECT * FROM access_requests WHERE id = $1 AND status = $2', [requestId, 'pending']);
    if (requestResult.rows.length === 0) {
      res.status(404).json({ error: 'NOT_FOUND', message: '保留中の申請が見つかりません' });
      return;
    }

    const request = requestResult.rows[0];

    const existingAdmin = await pool.query('SELECT id FROM admin_allowlist WHERE LOWER(email) = LOWER($1)', [request.email]);
    if (existingAdmin.rows.length > 0) {
      await pool.query('UPDATE admin_allowlist SET is_active = true, role = $1 WHERE LOWER(email) = LOWER($2)', [assignRole, request.email]);
    } else {
      await pool.query('INSERT INTO admin_allowlist (email, is_active, role, created_by_admin_email) VALUES ($1, true, $2, $3)', [request.email, assignRole, adminUser.email]);
    }

    await pool.query(
      'UPDATE access_requests SET status = $1, reviewed_by = $2, reviewed_at = NOW() WHERE id = $3',
      ['approved', adminUser.email, requestId]
    );

    const BASE_URL = process.env.BASE_URL || 'https://security-report.up.railway.app';
    try {
      await sendEmail({
        to: [request.email],
        subject: '【デジタル警備報告書システム ほうこちゃん】アクセスが承認されました',
        text: `管理画面へのアクセスが承認されました。\n\n権限: ${assignRole}\n\nログインしてご利用ください。\n${BASE_URL}`,
        html: `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;font-family:'Helvetica Neue',Arial,sans-serif;background-color:#f5f5f5;">
  <div style="max-width:600px;margin:0 auto;padding:20px;">
    <div style="background-color:#2C3E50;padding:20px 30px;border-radius:8px 8px 0 0;text-align:center;">
      <h1 style="color:#ffffff;margin:0;font-size:20px;">デジタル警備報告書システム【ほうこちゃん】</h1>
    </div>
    <div style="background-color:#ffffff;padding:30px;border-radius:0 0 8px 8px;box-shadow:0 2px 8px rgba(0,0,0,0.1);">
      <h2 style="color:#27ae60;margin:0 0 20px;font-size:18px;border-bottom:2px solid #27ae60;padding-bottom:10px;">アクセスが承認されました</h2>
      <p style="color:#212529;font-size:15px;line-height:1.6;">管理画面へのアクセスが承認されました。</p>
      <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
        <tr>
          <td style="padding:10px 12px;background:#f8f9fa;border:1px solid #e9ecef;font-weight:bold;color:#495057;width:120px;">権限</td>
          <td style="padding:10px 12px;border:1px solid #e9ecef;color:#212529;">${assignRole}</td>
        </tr>
      </table>
      <div style="text-align:center;margin:25px 0;">
        <a href="${BASE_URL}" style="display:inline-block;background-color:#27ae60;color:#ffffff;text-decoration:none;padding:12px 30px;border-radius:6px;font-size:15px;font-weight:bold;">管理画面にログイン</a>
      </div>
    </div>
    <p style="color:#adb5bd;font-size:11px;text-align:center;margin-top:15px;">日本交通誘導 デジタル警備報告書システム【ほうこちゃん】</p>
  </div>
</body>
</html>`
      });
    } catch (emailError) {
      console.error('[APPROVE] Email send failed (approval still succeeded):', emailError);
    }

    logAudit({ req, actorEmail: adminUser.email, action: 'APPROVE_ACCESS_REQUEST', targetType: 'access_request', targetId: requestId, payload: { approved_email: request.email, role: assignRole } });

    res.json({ ok: true });
  } catch (error) {
    console.error('[APPROVE] Error:', error);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: '承認処理に失敗しました' });
  }
});

router.post('/access-requests/:requestId/reject', requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const requestId = req.params.requestId as string;
    const adminUser = req.user as Express.User;

    await pool.query(
      'UPDATE access_requests SET status = $1, reviewed_by = $2, reviewed_at = NOW() WHERE id = $3',
      ['rejected', adminUser.email, requestId]
    );

    logAudit({ req, actorEmail: adminUser.email, action: 'REJECT_ACCESS_REQUEST', targetType: 'access_request', targetId: requestId, payload: {} });

    res.json({ ok: true });
  } catch (error) {
    console.error('[REJECT] Error:', error);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: '拒否処理に失敗しました' });
  }
});

router.get('/admins', requireSuperAdmin, async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT id, email, is_active, COALESCE(role, 'admin') as role, created_at FROM admin_allowlist ORDER BY created_at`
    );
    res.json({ admins: result.rows });
  } catch (error) {
    console.error('[ADMINS] Error:', error);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: '管理者一覧の取得に失敗しました' });
  }
});

router.put('/admins/:adminId/role', requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const adminId = req.params.adminId as string;
    const { role } = req.body;
    const validRoles = ['super_admin', 'admin', 'viewer'];
    if (!role || !validRoles.includes(role)) {
      res.status(400).json({ error: 'INVALID_PAYLOAD', message: '権限はsuper_admin, admin, viewerから選択してください' });
      return;
    }

    const adminUser = req.user as Express.User;
    await pool.query('UPDATE admin_allowlist SET role = $1 WHERE id = $2', [role, adminId]);

    logAudit({ req, actorEmail: adminUser.email, action: 'UPDATE_ADMIN_ROLE', targetType: 'admin', targetId: adminId, payload: { new_role: role } });

    res.json({ ok: true });
  } catch (error) {
    console.error('[ROLE_UPDATE] Error:', error);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: '権限の更新に失敗しました' });
  }
});

router.delete('/admins/:adminId', requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const adminId = req.params.adminId as string;
    const adminUser = req.user as Express.User;

    if (adminId === adminUser.id) {
      res.status(400).json({ error: 'INVALID_PAYLOAD', message: '自分自身は削除できません' });
      return;
    }

    await pool.query('UPDATE admin_allowlist SET is_active = false WHERE id = $1', [adminId]);

    await pool.query(
      `DELETE FROM session WHERE sess::text LIKE $1`,
      [`%${adminId}%`]
    ).catch(() => {});

    logAudit({ req, actorEmail: adminUser.email, action: 'DELETE_ADMIN', targetType: 'admin', targetId: adminId, payload: {} });

    res.json({ ok: true });
  } catch (error) {
    console.error('[ADMIN_DELETE] Error:', error);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: '管理者の削除に失敗しました' });
  }
});

export default router;
