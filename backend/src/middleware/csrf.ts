import { Request, Response, NextFunction } from 'express';

/**
 * CSRF 対策ミドルウェア（Origin / Referer 検証方式・ステートレス）
 *
 * 背景:
 *   管理APIは express-session の Cookie（SameSite=Lax / httpOnly）でログイン状態を保持する。
 *   Cookie ベース認証は CSRF の対象になり得るため、多層防御として「状態変更リクエストの
 *   Origin が自サイトと一致するか」を検証する。トークン発行が不要でフロント改修ゼロ。
 *
 * 防御の前提（既存の層）:
 *   - SameSite=Lax Cookie（クロスサイトの状態変更で Cookie が付かない）
 *   - requireJsonContentType（HTMLフォーム由来の単純CSRFを遮断）
 *   - CORS 無効＝同一オリジン配信のみ
 *   本ミドルウェアはこれらに上乗せする最終ラインの Origin 検証。
 *
 * 適用方針:
 *   - 非冪等メソッド（POST/PUT/PATCH/DELETE）のみ検証。GET/HEAD/OPTIONS は素通し。
 *     ※ FAIL-25 の教訓「PATCH も状態変更メソッド。保護対象に含める」を反映。
 *   - Cookie 非依存のクライアントは除外:
 *       * x-api-key を持つ機械間通信（procast-sync 等。Cookie を使わずCSRF不可）
 *       * Authorization: Bearer を持つキャスト（JWT。Cookie を使わずCSRF不可）
 *   - 環境変数 CSRF_PROTECTION_DISABLED=true で即時無効化できる（再デプロイ不要の緊急弁）。
 *   - 追加で許可したいオリジンは CSRF_ALLOWED_ORIGINS（カンマ区切り）で指定。
 */

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** URL 文字列から `protocol//host`（ポート含む）だけを取り出す。失敗時は null。 */
function originOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`.toLowerCase();
  } catch {
    return null;
  }
}

/** 末尾スラッシュ除去＋小文字化でオリジン文字列を正規化する。 */
function normalizeOrigin(value: string): string {
  return value.trim().replace(/\/+$/, '').toLowerCase();
}

/** このリクエストにとって正当なオリジンの集合を組み立てる（自オリジン＋env許可分）。 */
function buildAllowedOrigins(req: Request): Set<string> {
  const allowed = new Set<string>();

  // 自オリジン（リバースプロキシ配下では trust proxy により protocol/host が正しく解決される）
  const host = req.get('host');
  if (host) {
    allowed.add(`${req.protocol}://${host}`.toLowerCase());
  }

  // 明示的に許可する追加オリジン（カスタムドメイン等）
  const extra = process.env.CSRF_ALLOWED_ORIGINS;
  if (extra) {
    for (const o of extra.split(',')) {
      const n = normalizeOrigin(o);
      if (n) allowed.add(n);
    }
  }
  return allowed;
}

export function csrfOriginGuard(req: Request, res: Response, next: NextFunction): void {
  // 冪等メソッドは状態を変えないため検証不要
  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }

  // 緊急無効化スイッチ（万一の誤遮断時に再デプロイなしで解除できる）
  if (process.env.CSRF_PROTECTION_DISABLED === 'true') {
    next();
    return;
  }

  // Cookie を使わない認証経路は CSRF 不可のため除外
  if (req.headers['x-api-key']) {
    next();
    return;
  }
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    next();
    return;
  }

  const allowed = buildAllowedOrigins(req);
  const source = originOf(req.headers.origin) || originOf(req.headers.referer);

  // 状態変更リクエストなのに Origin / Referer が無い＝ブラウザ由来として不自然 → 拒否
  if (!source) {
    res.status(403).json({
      error: 'CSRF_ORIGIN_MISSING',
      message: 'リクエスト元（Origin）が確認できませんでした',
      details: {}
    });
    return;
  }

  if (!allowed.has(source)) {
    res.status(403).json({
      error: 'CSRF_ORIGIN_MISMATCH',
      message: 'リクエスト元が許可されていません',
      details: {}
    });
    return;
  }

  next();
}
