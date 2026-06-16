import { describe, it, expect, vi } from 'vitest';

// ルートモジュールは db/pool を初期化時に要求するためモックで断つ
vi.mock('../db/pool', () => ({
  default: { query: vi.fn(), connect: vi.fn() },
}));

import { normalizeCompatPair } from './adminControlKnowledge';

describe('normalizeCompatPair', () => {
  it('辞書順で小さい方が normA になる', () => {
    const a = 'aaaaaaaa-0000-0000-0000-000000000000';
    const b = 'bbbbbbbb-0000-0000-0000-000000000000';
    const { normA, normB } = normalizeCompatPair(a, b);
    expect(normA).toBe(a);
    expect(normB).toBe(b);
  });

  it('引数が逆順でも同じ結果になる（順序正規化）', () => {
    const a = 'aaaaaaaa-0000-0000-0000-000000000000';
    const b = 'bbbbbbbb-0000-0000-0000-000000000000';
    const { normA, normB } = normalizeCompatPair(b, a);
    expect(normA).toBe(a);
    expect(normB).toBe(b);
  });

  it('同じ UUID を渡すと等値のまま返る（a === b の場合はルート側で弾くが関数自体は破綻しない）', () => {
    const id = 'cccccccc-0000-0000-0000-000000000000';
    const { normA, normB } = normalizeCompatPair(id, id);
    expect(normA).toBe(id);
    expect(normB).toBe(id);
  });

  it('正規化結果は冪等（同じ入力に何度呼んでも同じ結果）', () => {
    const a = 'ffffffff-0000-0000-0000-000000000001';
    const b = '00000000-0000-0000-0000-000000000001';
    const r1 = normalizeCompatPair(a, b);
    const r2 = normalizeCompatPair(b, a);
    expect(r1.normA).toBe(r2.normA);
    expect(r1.normB).toBe(r2.normB);
  });

  it('正規化後は常に normA <= normB（辞書順）', () => {
    const pairs: [string, string][] = [
      ['ffffffff-ffff-ffff-ffff-ffffffffffff', '00000000-0000-0000-0000-000000000000'],
      ['11111111-0000-0000-0000-000000000000', '22222222-0000-0000-0000-000000000000'],
      ['zzzzzzzz-0000-0000-0000-000000000000', 'aaaaaaaa-0000-0000-0000-000000000000'],
    ];
    for (const [x, y] of pairs) {
      const { normA, normB } = normalizeCompatPair(x, y);
      expect(normA <= normB).toBe(true);
    }
  });
});
