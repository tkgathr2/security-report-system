import crypto from 'crypto';

/**
 * magic_link_token を JWT に縛り付けるための短いハッシュ（SHA-256先頭16バイト=32hex）。
 * cast_users.magic_link_token をローテーションすると古いJWTの mlh と一致しなくなり失効する。
 *
 * セキュリティ要件:
 *  - 元トークン推測困難（SHA-256）
 *  - 衝突確率は 32hex (128bit) で実用上ゼロ
 *  - 失効後のJWTを authenticateCast 側で確実に弾く
 */
export function magicLinkHash(magicLinkToken: string | null | undefined): string {
  if (!magicLinkToken) return '';
  return crypto.createHash('sha256').update(magicLinkToken).digest('hex').slice(0, 32);
}
