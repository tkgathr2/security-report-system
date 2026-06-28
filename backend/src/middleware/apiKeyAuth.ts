import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';

/**
 * APIキー認証ミドルウェア
 * procast-sync など機械間通信用の認証
 * リクエストヘッダー x-api-key が HOUKO_API_KEY 環境変数と一致すれば通過
 * タイミング攻撃対策として crypto.timingSafeEqual で定数時間比較する
 */
export function requireApiKey(req: Request, res: Response, next: NextFunction): void {
  const raw = req.headers['x-api-key'];
  const apiKey = Array.isArray(raw) ? raw[0] : raw;
  const expectedKey = process.env.HOUKO_API_KEY;

  if (!expectedKey) {
    res.status(500).json({ error: 'HOUKO_API_KEY が設定されていません' });
    return;
  }

  if (!apiKey) {
    res.status(401).json({ error: 'APIキーが無効または未指定です' });
    return;
  }

  const a = Buffer.from(apiKey, 'utf8');
  const b = Buffer.from(expectedKey, 'utf8');
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);

  if (!ok) {
    res.status(401).json({ error: 'APIキーが無効または未指定です' });
    return;
  }

  next();
}
