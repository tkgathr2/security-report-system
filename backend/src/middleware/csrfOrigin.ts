import { Request, Response, NextFunction } from 'express';

/**
 * CSRF 多層防御：Origin/Referer 検証（OWASP "Verifying Origin With Standard Headers"）。
 *
 * セッションCookieのSameSite=Laxの上に重ねる"もう一枚"の防御。守る対象は
 * 「ブラウザ＋Cookie認証で状態を変える」リクエスト（管理コンソール）。
 * ブラウザがクロスサイトで自動付与しないヘッダで認証するリクエスト
 * （キャストJWTの `Authorization: Bearer` / サーバー間の `x-api-key`）は
 * そもそもCSRF不可のため検証対象外（除外）。
 *
 * 状態変更メソッド（POST/PUT/PATCH/DELETE）の挙動：
 *  - ヘッダ認証（Bearer / x-api-key）あり → 通過（CSRFの攻撃面でない）
 *  - Origin あり        → 許可オリジンに一致しなければ 403
 *  - Origin 無し・Referer あり → その origin が一致しなければ 403
 *  - どちらも無し       → 通過（非ブラウザ＝CSRF攻撃面でない。実ブラウザのCSRFは
 *                          必ずどちらかを送る／クロスサイトPOSTのCookieは
 *                          SameSite=Lax で既にブロック済み）
 *
 * 環境変数 CSRF_ENFORCEMENT=report の場合はブロックせずログのみ（安全な段階導入・調査用）。
 * 環境変数 ALLOWED_ORIGINS（カンマ区切り）で、フロントとAPIを別ホストにした場合の
 * 追加許可オリジンを指定可能（既定は自ホストのみ＝同一オリジン構成では設定不要）。
 */

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function getAllowedHosts(req: Request): Set<string> {
  const hosts = new Set<string>();

  // 自ホスト（Railwayドメインでも独自ドメインでも、設定なしで同一オリジンを許可）
  const selfHost = req.headers.host;
  if (typeof selfHost === 'string' && selfHost) {
    hosts.add(selfHost.toLowerCase());
  }

  // フロント/APIをホスト分離した場合のための明示的な許可リスト
  const extra = process.env.ALLOWED_ORIGINS || '';
  for (const entry of extra.split(',')) {
    const value = entry.trim();
    if (!value) continue;
    const host = toHost(value);
    hosts.add((host ?? value).toLowerCase());
  }

  return hosts;
}

/** URL文字列から host(:port) を取り出す。解析不能なら null。 */
function toHost(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).host.toLowerCase();
  } catch {
    return null;
  }
}

export function csrfOriginCheck(req: Request, res: Response, next: NextFunction): void {
  // 安全メソッド（GET/HEAD/OPTIONS等）は状態を変えないため検証不要
  if (!UNSAFE_METHODS.has(req.method)) {
    next();
    return;
  }

  // ヘッダ認証はブラウザがクロスサイトで自動付与しない＝CSRF不可のため除外。
  // 値の正当性は各ルートの認証ミドルウェア（requireApiKey / authenticateCast）が検証する。
  if (req.headers['x-api-key'] !== undefined) {
    next();
    return;
  }
  const authHeader = req.headers.authorization;
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    next();
    return;
  }

  const reportOnly = (process.env.CSRF_ENFORCEMENT || 'enforce').toLowerCase() === 'report';
  const allowedHosts = getAllowedHosts(req);

  const originHeader = typeof req.headers.origin === 'string' ? req.headers.origin : undefined;
  const refererHeader = typeof req.headers.referer === 'string' ? req.headers.referer : undefined;
  // Origin を優先し、無ければ Referer から判定
  const requestHost = toHost(originHeader) ?? toHost(refererHeader);

  // Origin も Referer も無い＝非ブラウザのサーバー間呼び出し等。CSRFの攻撃面ではなく、
  // クロスサイトPOSTのCookie送出は SameSite=Lax が既に防いでいるため通過させる。
  if (requestHost === null) {
    next();
    return;
  }

  if (allowedHosts.has(requestHost)) {
    next();
    return;
  }

  // 許可オリジンに一致しない＝クロスオリジンからの状態変更リクエスト
  console.warn(
    `[CSRF] Blocked ${req.method} ${req.originalUrl} from origin host "${requestHost}" ` +
    `(allowed: ${[...allowedHosts].join(', ') || '(none)'})`
  );

  if (reportOnly) {
    next();
    return;
  }

  res.status(403).json({
    error: 'CSRF_ORIGIN_MISMATCH',
    message: 'リクエスト元の検証に失敗しました（CSRF対策）。ページを再読み込みして操作し直してください。',
    details: {}
  });
}
