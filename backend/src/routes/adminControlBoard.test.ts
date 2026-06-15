import { describe, it, expect, vi } from 'vitest';

// pure 関数のみを検証する。ルートモジュールは読み込み時に db/pool を初期化し
// DATABASE_URL を要求するため、副作用を断つようモックする。
vi.mock('../db/pool', () => ({
  default: { query: vi.fn(), connect: vi.fn() },
}));

import {
  deriveShift,
  deriveSiteKey,
  deriveSiteLabel,
  UNSET_SITE_KEY,
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

  // 回帰防止：1桁時刻(ゼロ埋めなし)でも正しく判定する（辞書順比較の罠）
  it('9:00（1桁時）は morning', () => {
    expect(deriveShift('9:00')).toBe('morning');
  });

  it('8:30（1桁時）は morning', () => {
    expect(deriveShift('8:30')).toBe('morning');
  });

  it('7:00（1桁時）は morning', () => {
    expect(deriveShift('7:00')).toBe('morning');
  });

  it('9:30（1桁時・09:00超）は mid', () => {
    expect(deriveShift('9:30')).toBe('mid');
  });

  it('不正な値(時刻でない)は mid', () => {
    expect(deriveShift('あ')).toBe('mid');
  });
});

describe('deriveSiteKey（現場を一意に識別する複合キー）', () => {
  it('取引先・所在地・作業名の複合キーになる', () => {
    expect(deriveSiteKey('ABC商事', '東京都港区', '警備業務')).toBe('ABC商事|東京都港区|警備業務');
  });

  // H1a回帰防止：同一取引先でも所在地が違えば別キー（別列）になる＝片方が盤面から消えない
  it('同一取引先・別所在地は別キー（衝突しない）', () => {
    const a = deriveSiteKey('大豊工業', '渋谷現場', '警備業務');
    const b = deriveSiteKey('大豊工業', '新宿現場', '警備業務');
    expect(a).not.toBe(b);
  });

  // H1c回帰防止：表記揺れ(全角半角/空白/㈱)を正規化で同一キーに寄せる＝同一現場が別列に割れない
  it('表記揺れは正規化で同一キーに寄る', () => {
    const a = deriveSiteKey('ＡＢＣ商事', '東京都港区', '警備'); // 全角
    const b = deriveSiteKey('ABC 商事', ' 東京都港区 ', '警備'); // 半角＋空白
    expect(a).toBe(b);
  });

  it('所在地のみでもキーになる（取引先空）', () => {
    expect(deriveSiteKey('', '東京都港区', '')).toBe('|東京都港区|');
    expect(deriveSiteKey(null, '東京都港区', null)).toBe('|東京都港区|');
  });

  // H1b回帰防止：すべて空でも番兵キーを返す＝そのキャストが盤面から落ちない
  it('すべて空なら番兵キー(UNSET_SITE_KEY)', () => {
    expect(deriveSiteKey(null, null, null)).toBe(UNSET_SITE_KEY);
    expect(deriveSiteKey('  ', '', '　')).toBe(UNSET_SITE_KEY);
  });
});

describe('deriveSiteLabel（列の表示名）', () => {
  it('作業名→取引先名→所在地→(現場未設定) の順で選ぶ', () => {
    expect(deriveSiteLabel('ABC商事', '港区', '警備業務')).toBe('警備業務');
    expect(deriveSiteLabel('ABC商事', '港区', '')).toBe('ABC商事');
    expect(deriveSiteLabel('', '港区', null)).toBe('港区');
    expect(deriveSiteLabel(null, null, null)).toBe('(現場未設定)');
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
