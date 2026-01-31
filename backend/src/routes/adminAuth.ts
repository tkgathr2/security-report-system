import { Router, Request, Response, NextFunction } from 'express';
import passport from 'passport';
import { Strategy as GoogleStrategy, Profile } from 'passport-google-oauth20';
import crypto from 'crypto';
import pool from '../db/pool';

const router = Router();

const GOOGLE_CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET || '';
const GOOGLE_REDIRECT_URL = process.env.GOOGLE_OAUTH_REDIRECT_URL || 'http://localhost:3000/api/admin/auth/google/callback';

interface AdminUser {
  id: string;
  email: string;
  google_sub: string;
  is_active: boolean;
}

declare module 'express-session' {
  interface SessionData {
    oauthState?: string;
  }
}

declare global {
  namespace Express {
    interface User {
      id: string;
      email: string;
      is_active: boolean;
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
      'SELECT id, email, is_active FROM admin_allowlist WHERE email = $1 AND is_active = true',
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
    state: true,
    passReqToCallback: true
  }, async (req: Request, accessToken: string, refreshToken: string, profile: Profile, done: (error: Error | null, user?: AdminUser | false) => void) => {
    try {
      const email = profile.emails?.[0]?.value;
      const googleSub = profile.id;
      
      console.log('[OAuth Debug] Google profile email:', email);
      console.log('[OAuth Debug] Google profile id:', googleSub);
      console.log('[OAuth Debug] All emails from profile:', JSON.stringify(profile.emails));
      
      if (!email) {
        console.log('[OAuth Debug] No email found in profile');
        return done(null, false);
      }

      // Use case-insensitive email comparison
      const result = await pool.query(
        'SELECT id, email, is_active FROM admin_allowlist WHERE LOWER(email) = LOWER($1)',
        [email]
      );

      console.log('[OAuth Debug] Database query result rows:', result.rows.length);
      console.log('[OAuth Debug] Database query result:', JSON.stringify(result.rows));

      if (result.rows.length === 0) {
        console.log('[OAuth Debug] Email not found in admin_allowlist');
        return done(null, false);
      }

      const admin = result.rows[0];
      if (!admin.is_active) {
        console.log('[OAuth Debug] Admin is not active');
        return done(null, false);
      }

      console.log('[OAuth Debug] Login successful for:', admin.email);
      return done(null, {
        id: admin.id,
        email: admin.email,
        google_sub: googleSub,
        is_active: admin.is_active
      });
    } catch (error) {
      console.error('[OAuth Debug] Error:', error);
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
    // #region agent log
    console.log('[Callback Debug] Entered /google/callback endpoint');
    console.log('[Callback Debug] Query params:', JSON.stringify(req.query));
    console.log('[Callback Debug] Session exists:', !!req.session);
    console.log('[Callback Debug] Session oauthState:', req.session?.oauthState);
    // #endregion
    const stateFromQuery = req.query.state as string | undefined;
    const stateFromSession = req.session.oauthState;
    
    if (!stateFromQuery || !stateFromSession) {
      // #region agent log
      console.log('[Callback Debug] State validation FAILED - missing state');
      console.log('[Callback Debug] stateFromQuery:', stateFromQuery);
      console.log('[Callback Debug] stateFromSession:', stateFromSession);
      // #endregion
      res.status(400).json({
        error: 'INVALID_STATE',
        message: 'OAuth stateパラメータが欠落しています',
        details: {}
      });
      return;
    }
    
    if (stateFromQuery !== stateFromSession) {
      // #region agent log
      console.log('[Callback Debug] State validation FAILED - mismatch');
      console.log('[Callback Debug] stateFromQuery:', stateFromQuery);
      console.log('[Callback Debug] stateFromSession:', stateFromSession);
      // #endregion
      res.status(400).json({
        error: 'INVALID_STATE',
        message: 'OAuth stateパラメータが一致しません',
        details: {}
      });
      return;
    }
    
    // #region agent log
    console.log('[Callback Debug] State validation PASSED');
    console.log('[Callback Debug] About to call passport.authenticate');
    // #endregion
    
    delete req.session.oauthState;
    
    passport.authenticate('google', { session: true }, (err: Error | null, user: AdminUser | false) => {
      // #region agent log
      console.log('[Callback Debug] passport.authenticate callback entered');
      console.log('[Callback Debug] err:', err);
      console.log('[Callback Debug] user:', user);
      // #endregion
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
        // #region agent log
        console.log('[Callback Debug] Returning 403 - user is false/undefined');
        // #endregion
        res.status(403).json({
          error: 'FORBIDDEN',
          message: '許可リストに登録されていないか、無効化されています',
          details: {}
        });
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

        res.json({
          message: 'ログイン成功',
          admin: {
            id: user.id,
            email: user.email
          }
        });
      });
    })(req, res, next);
  }
);

export default router;
