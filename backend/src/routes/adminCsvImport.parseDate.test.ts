/**
 * バグチェックラボ検出（堀内潜在）：CSV取込の parseDate がローカルTZ依存だった問題の回帰防止。
 * サーバTZが UTC のときに「2026/06/14」を渡しても 2026-06-14T00:00:00Z で扱えることを保証する。
 *
 * adminCsvImport.ts:parseDate は private なので、ソースから関数を切り出して評価する代わりに
 * 「new Date(Date.UTC(...)) が使われていること」を静的に確認する軽量テスト。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('adminCsvImport.parseDate TZ非依存化', () => {
  const src = readFileSync(join(__dirname, 'adminCsvImport.ts'), 'utf-8');

  it('parseDate は new Date(Date.UTC(...)) を使い、ローカルTZに依存しない', () => {
    const usesLocalDateCtor = /return new Date\(year, month - 1, day\);/.test(src);
    const usesUtcCtor = /return new Date\(Date\.UTC\(year, month - 1, day\)\);/.test(src);
    expect({ usesLocalDateCtor, usesUtcCtor }).toEqual({
      usesLocalDateCtor: false,
      usesUtcCtor: true,
    });
  });

  it('urlExpiresAt 計算が setUTCDate / setUTCHours を使い workDate と整合する', () => {
    const usesLocalSetHours = /urlExpiresAt\.setHours\(23, 59, 59, 999\)/.test(src);
    const usesUtcSetHours = /urlExpiresAt\.setUTCHours\(23, 59, 59, 999\)/.test(src);
    expect({ usesLocalSetHours, usesUtcSetHours }).toEqual({
      usesLocalSetHours: false,
      usesUtcSetHours: true,
    });
  });
});
