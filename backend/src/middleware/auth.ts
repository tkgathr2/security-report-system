import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import pool from '../db/pool';
import { CastJwtPayload, AuthenticatedCastRequest } from '../types';

const AUTH_SECRET = process.env.AUTH_SECRET || (process.env.NODE_ENV === 'production' ? '' : 'dev-secret-key');
if (process.env.NODE_ENV === 'production' && !process.env.AUTH_SECRET) {
  console.error('[SECURITY] AUTH_SECRET is not set in production! Authentication will fail.');
}

export async function authenticateCast(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      error: 'UNAUTHORIZED',
      message: '認証が必要です',
      details: {}
    });
    return;
  }

  const token = authHeader.substring(7);

  try {
    const decoded = jwt.verify(token, AUTH_SECRET) as CastJwtPayload;

    const userCheck = await pool.query(
      'SELECT id FROM cast_users WHERE id = $1 AND magic_link_token IS NOT NULL AND deleted_at IS NULL',
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
  next();
}
