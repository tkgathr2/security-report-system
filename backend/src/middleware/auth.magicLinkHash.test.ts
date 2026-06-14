/**
 * バグチェックラボ検出（神谷High#3）：cast JWT が magic_link_token のローテーションで
 * 失効しない問題への対策。authenticateCast 側で mlh と現在の magic_link_token のハッシュを
 * 突き合わせるため、ハッシュ関数の安定性と長さを保証する単体テスト。
 */
import { describe, it, expect } from 'vitest';
import { magicLinkHash } from '../utils/magicLinkHash';

describe('magicLinkHash', () => {
  it('SHA-256 先頭16バイト (32 hex) を返す', () => {
    const h = magicLinkHash('any-token-value');
    expect(h).toMatch(/^[0-9a-f]{32}$/);
  });

  it('同じ入力に対して安定したハッシュを返す', () => {
    expect(magicLinkHash('abc')).toBe(magicLinkHash('abc'));
  });

  it('異なる入力で異なるハッシュを返す', () => {
    expect(magicLinkHash('abc')).not.toBe(magicLinkHash('abd'));
  });

  it('null / undefined / 空文字 は空文字を返し、現在ハッシュとの不一致で必ず弾かれる', () => {
    expect(magicLinkHash(null)).toBe('');
    expect(magicLinkHash(undefined)).toBe('');
    expect(magicLinkHash('')).toBe('');
  });
});
