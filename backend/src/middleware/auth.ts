import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import pool from '../db/pool';
import { CastJwtPayload, AuthenticatedCastRequest } from '../types';
import { magicLinkHash } from '../utils/magicLinkHash';

export { magicLinkHash };

const AUTH_SECRET = process.env.AUTH_SECRET || (process.env.NODE_ENV === 'production' ? '' : 'dev-secret-key');
if (process.env.NODE_ENV === 'production' && !process.env.AUTH_SECRET) {
  console.error('[SECURITY] AUTH_SECRET is not set in production! Authentication will fail.');
}

// Persistent JWT blacklist (Postgres-backed). Each row records the token's
// natural expiry so the table can be pruned without losing logout state on restart.
export async function addTokenToBlacklist(token: string): Promise<void> {
  try {
    let expiresAt: Date | null = null;
    try {
      const decoded = jwt.decode(token) as { exp?: number } | null;
      if (decoded && typeof decoded.exp === 'number') {
        expiresAt = new Date(decoded.exp * 1000);
      }
    } catch {
      // fall back to NULL — middleware will still treat it as blacklisted
    }
    await pool.query(
      `INSERT INTO jwt_token_blacklist (token, expires_at) VALUES ($1, $2)
       ON CONFLICT (token) DO NOTHING`,
      [token, expiresAt]
    );
    // Best-effort cleanup of expired entries
    await pool.query('DELETE FROM jwt_token_blacklist WHERE expires_at IS NOT NULL AND expires_at < NOW()');
  } catch (err) {
    console.error('[AUTH] Failed to persist token blacklist entry:', err);
  }
}

async function isTokenBlacklisted(token: string): Promise<boolean> {
  try {
    const result = await pool.query(
      'SELECT 1 FROM jwt_token_blacklist WHERE token = $1 LIMIT 1',
      [token]
    );
    return result.rows.length > 0;
  } catch (err) {
    console.error('[AUTH] Failed to check token blacklist — failing closed (deny access):', err);
    return true;
  }
}

export async function authenticateCast(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;

  // Prefer Authorization: Bearer header; fall back to HttpOnly cookie
  let token: string | undefined;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7);
  } else if (req.cookies && req.cookies.castToken) {
    token = req.cookies.castToken as string;
  }

  if (!token) {
    res.status(401).json({
      error: 'UNAUTHORIZED',
      message: '認証が必要です',
      details: {}
    });
    return;
  }

  if (await isTokenBlacklisted(token)) {
    res.status(401).json({
      error: 'UNAUTHORIZED',
      message: 'トークンが無効化されています',
      details: {}
    });
    return;
  }

  try {
    const decoded = jwt.verify(token, AUTH_SECRET, { algorithms: ['HS256'] }) as CastJwtPayload;

    const userCheck = await pool.query(
      'SELECT id, magic_link_token FROM cast_users WHERE id = $1 AND magic_link_token IS NOT NULL AND deleted_at IS NULL',
      [decoded.userId]
    );
    if (userCheck.rows.length === 0) {
      res.status(401).json({
        error: 'UNAUTHORIZED',
        message: 'セッションが無効です。再度ログインしてください',
        details: {}
      });
      return;
    }

    // mlh が JWT に乗っている場合は cast_users.magic_link_token のハッシュと一致確認。
    // ローテーション後の古いJWTはここで弾く。旧来 mlh 無しJWTは段階移行のため許容する。
    if (decoded.mlh) {
      const currentHash = magicLinkHash(userCheck.rows[0].magic_link_token);
      if (decoded.mlh !== currentHash) {
        res.status(401).json({
          error: 'UNAUTHORIZED',
          message: 'セッションが無効化されています。再度ログインしてください',
          details: {}
        });
        return;
      }
    }

    (req as AuthenticatedCastRequest).castUser = decoded;
    next();
  } catch {
    res.status(401).json({
      error: 'UNAUTHORIZED',
      message: 'トークンが無効または期限切れです',
      details: {}
    });
  }
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.isAuthenticated || !req.isAuthenticated() || !req.user) {
    res.status(401).json({
      error: 'ADMIN_UNAUTHORIZED',
      message: '管理者セッションがありません',
      details: {}
    });
    return;
  }
  const user = req.user as Express.User;
  if (!user.role || (user.role !== 'admin' && user.role !== 'super_admin')) {
    res.status(403).json({
      error: 'FORBIDDEN',
      message: '管理者権限が必要です',
      details: {}
    });
    return;
  }
  next();
}
