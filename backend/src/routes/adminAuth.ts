import { Router, Request, Response, NextFunction } from 'express';
import passport from 'passport';
import { Strategy as GoogleStrategy, Profile } from 'passport-google-oauth20';
import pool from '../db/pool';

const router = Router();

const GOOGLE_CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET || '';
const GOOGLE_REDIRECT_URL = process.env.GOOGLE_OAUTH_REDIRECT_URL || 'http://localhost:3000/api/admin/auth/google/callback';
const ADMIN_SESSION_SECRET = process.env.AUTH_SECRET || 'dev-secret-key';

interface AdminUser {
  id: string;
  email: string;
  is_active: boolean;
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

if (GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET) {
  passport.use(new GoogleStrategy({
    clientID: GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
    callbackURL: GOOGLE_REDIRECT_URL,
    scope: ['email', 'profile']
  }, async (accessToken: string, refreshToken: string, profile: Profile, done: (error: Error | null, user?: AdminUser | false) => void) => {
    try {
      const email = profile.emails?.[0]?.value;
      if (!email) {
        return done(null, false);
      }

      const result = await pool.query(
        'SELECT id, email, is_active FROM admin_allowlist WHERE email = $1',
        [email]
      );

      if (result.rows.length === 0) {
        return done(null, false);
      }

      const admin = result.rows[0];
      if (!admin.is_active) {
        return done(null, false);
      }

      return done(null, {
        id: admin.id,
        email: admin.email,
        is_active: admin.is_active
      });
    } catch (error) {
      return done(error as Error);
    }
  }));

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
}

router.get('/google/start', (req: Request, res: Response, next: NextFunction) => {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'Google OAuth is not configured',
      details: {}
    });
    return;
  }
  passport.authenticate('google', { scope: ['email', 'profile'] })(req, res, next);
});

router.get('/google/callback',
  (req: Request, res: Response, next: NextFunction) => {
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
