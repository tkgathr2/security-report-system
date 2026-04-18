import { Request, Response, NextFunction } from 'express';

/**
 * APIキー認証ミドルウェア
 * procast-sync など機械間通信用の認証
 * リクエストヘッダー x-api-key が HOUKO_API_KEY 環境変数と一致すれば通過
 */
export function requireApiKey(req: Request, res: Response, next: NextFunction): void {
  const apiKey = req.headers['x-api-key'];
  const expectedKey = process.env.HOUKO_API_KEY;

  if (!expectedKey) {
    res.status(500).json({ error: 'HOUKO_API_KEY が設定されていません' });
    return;
  }

  if (!apiKey || apiKey !== expectedKey) {
    res.status(401).json({ error: 'APIキーが無効または未指定です' });
    return;
  }

  next();
}
