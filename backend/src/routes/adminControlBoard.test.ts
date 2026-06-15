import { describe, it, expect, vi } from 'vitest';

// pure 関数のみを検証する。ルートモジュールは読み込み時に db/pool を初期化し
// DATABASE_URL を要求するため、副作用を断つようモックする。
vi.mock('../db/pool', () => ({
  default: { query: vi.fn(), connect: vi.fn() },
}));

import {
  deriveShift,
  deriveSiteKey,
  computeWarnings,
  StaffPlacement,
} from './adminControlBoard';

describe('deriveShift', () => {
  it('09:00 ちょうどは morning（境界 <= 09:00）', () => {
    expect(deriveShift('09:00')).toBe('morning');
  });

  it('08:59 は morning', () => {
    expect(deriveShift('08:59')).toBe('morning');
  });

  it('09:01 は mid（09:00 を越える）', () => {
    expect(deriveShift('09:01')).toBe('mid');
  });

  it('16:59 は mid（境界 < 17:00）', () => {
    expect(deriveShift('16:59')).toBe('mid');
  });

  it('17:00 ちょうどは evening', () => {
    expect(deriveShift('17:00')).toBe('evening');
  });

  it('17:01 は evening', () => {
    expect(deriveShift('17:01')).toBe('evening');
  });

  it('null は mid', () => {
    expect(deriveShift(null)).toBe('mid');
  });

  it('undefined は mid', () => {
    expect(deriveShift(undefined)).toBe('mid');
  });

  it('空文字は mid', () => {
    expect(deriveShift('')).toBe('mid');
  });

  it('前後空白は trim される', () => {
    expect(deriveShift(' 09:00 ')).toBe('morning');
  });
});

describe('deriveSiteKey', () => {
  it('client_name_raw を優先する', () => {
    expect(deriveSiteKey('ABC商事', '東京都港区')).toBe('ABC商事');
  });

  it('client_name_raw が空なら location を使う', () => {
    expect(deriveSiteKey('', '東京都港区')).toBe('東京都港区');
    expect(deriveSiteKey(null, '東京都港区')).toBe('東京都港区');
    expect(deriveSiteKey('   ', '東京都港区')).toBe('東京都港区');
  });

  it('どちらも空なら空文字', () => {
    expect(deriveSiteKey(null, null)).toBe('');
  });
});

describe('computeWarnings', () => {
  function place(staffId: string | null, name: string, shift: StaffPlacement['shift']): StaffPlacement {
    return { staffId, name, siteKey: 'site1', siteLabel: '現場A', shift };
  }

  it('前日夜→当日朝で連続するキャストに警告が立つ', () => {
    const currMorning = [place('s1', '川面', 'morning')];
    const prevEvening = [place('s1', '川面', 'evening')];

    const { warnings, warnStaffIds } = computeWarnings(currMorning, prevEvening, '6/16朝', '6/15夜');

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toEqual({
      staff_id: 's1',
      name: '川面',
      prev: '6/15夜',
      curr: '6/16朝',
      site: '現場A',
    });
    expect(warnStaffIds.has('s1')).toBe(true);
  });

  it('前日夜番に居なければ警告は立たない', () => {
    const currMorning = [place('s1', '川面', 'morning')];
    const prevEvening = [place('s2', '廣中', 'evening')];

    const { warnings, warnStaffIds } = computeWarnings(currMorning, prevEvening, '6/16朝', '6/15夜');

    expect(warnings).toHaveLength(0);
    expect(warnStaffIds.size).toBe(0);
  });

  it('staff_id が null のキャストは突き合わせ対象外', () => {
    const currMorning = [place(null, '名無し', 'morning')];
    const prevEvening = [place(null, '名無し', 'evening')];

    const { warnings } = computeWarnings(currMorning, prevEvening, '6/16朝', '6/15夜');

    expect(warnings).toHaveLength(0);
  });

  it('同一キャストが複数現場の朝番に居ても警告は1件に重複排除', () => {
    const currMorning = [place('s1', '川面', 'morning'), place('s1', '川面', 'morning')];
    const prevEvening = [place('s1', '川面', 'evening')];

    const { warnings } = computeWarnings(currMorning, prevEvening, '6/16朝', '6/15夜');

    expect(warnings).toHaveLength(1);
  });
});
