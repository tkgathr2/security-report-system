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

/**
 * URL / オリジン文字列から host（ポート含む・小文字）だけを取り出す。失敗時は null。
 *
 * scheme（http/https）ではなく host で同一オリジン判定する。理由:
 *   リバースプロキシ（Railway等）配下では req.protocol が常に正しく https を返すとは限らず、
 *   scheme まで厳密照合すると同一オリジンの正規リクエストまで誤遮断する。
 *   アプリは HSTS で https 固定・固有ホスト名のため、host 一致＝同一サイトと判断して安全。
 */
function hostOf(value: string | undefined): string | null {
  if (!value) return null;
  try {
    // scheme 無しでも URL() が解釈できるよう補う
    const withScheme = /^[a-z]+:\/\//i.test(value) ? value : `https://${value}`;
    return new URL(withScheme).host.toLowerCase();
  } catch {
    return null;
  }
}

/** このリクエストにとって正当な host の集合を組み立てる（自ホスト＋env許可分）。 */
function buildAllowedHosts(req: Request): Set<string> {
  const allowed = new Set<string>();

  // 自ホスト（Host ヘッダ。プロキシ配下でも素直に取得できる）
  const host = req.get('host');
  if (host) allowed.add(host.toLowerCase());

  // 明示的に許可する追加オリジン（カスタムドメイン等）。host 部分だけ採用
  const extra = process.env.CSRF_ALLOWED_ORIGINS;
  if (extra) {
    for (const o of extra.split(',')) {
      const h = hostOf(o.trim());
      if (h) allowed.add(h);
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

  const allowed = buildAllowedHosts(req);
  const sourceHost = hostOf(req.headers.origin) || hostOf(req.headers.referer);

  // 状態変更リクエストなのに Origin / Referer が無い＝ブラウザ由来として不自然 → 拒否
  if (!sourceHost) {
    res.status(403).json({
      error: 'CSRF_ORIGIN_MISSING',
      message: 'リクエスト元（Origin）が確認できませんでした',
      details: {}
    });
    return;
  }

  if (!allowed.has(sourceHost)) {
    res.status(403).json({
      error: 'CSRF_ORIGIN_MISMATCH',
      message: 'リクエスト元が許可されていません',
      details: {}
    });
    return;
  }

  next();
}
