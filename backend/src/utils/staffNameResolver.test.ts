import { describe, it, expect } from 'vitest';
import { normalizeName, resolveStaffName, StaffNameRow } from './staffNameResolver';

const staff: StaffNameRow[] = [
  { id: 'id-nakamura', display_name_kanji: '中村 文彦', display_name_kana: 'ナカムラ フミヒコ' },
  { id: 'id-kawamo', display_name_kanji: '川面 直人', display_name_kana: 'カワモ ナオト' },
  { id: 'id-umehara', display_name_kanji: '梅原 幸雄', display_name_kana: 'ウメハラ ユキオ' },
  { id: 'id-nakata', display_name_kanji: '中田 健', display_name_kana: 'ナカタ ケン' },
];

describe('normalizeName', () => {
  it('敬称（さん/くん/様）を落とす', () => {
    expect(normalizeName('中村さん')).toBe('中村');
    expect(normalizeName('川面くん')).toBe('川面');
    expect(normalizeName('梅原様')).toBe('梅原');
  });
  it('全角半角スペースを除去・NFKC正規化', () => {
    expect(normalizeName('中村　文彦')).toBe('中村文彦');
    expect(normalizeName(' 川面 直人 ')).toBe('川面直人');
  });
  it('null/空は空文字', () => {
    expect(normalizeName(null)).toBe('');
    expect(normalizeName('')).toBe('');
  });
});

describe('resolveStaffName', () => {
  it('姓だけ＋敬称で一意に解決（前方一致）', () => {
    const r = resolveStaffName('川面さん', staff);
    expect(r.map((m) => m.id)).toEqual(['id-kawamo']);
  });

  it('フルネーム完全一致', () => {
    const r = resolveStaffName('中村 文彦', staff);
    expect(r[0].id).toBe('id-nakamura');
  });

  it('カナで解決', () => {
    const r = resolveStaffName('ウメハラ', staff);
    expect(r.map((m) => m.id)).toEqual(['id-umehara']);
  });

  it('曖昧な姓は複数候補を返す（中→中村・中田）', () => {
    const r = resolveStaffName('中', staff);
    expect(r.map((m) => m.id).sort()).toEqual(['id-nakamura', 'id-nakata'].sort());
  });

  it('完全一致を前方/部分一致より優先', () => {
    const s2: StaffNameRow[] = [
      { id: 'a', display_name_kanji: '中村', display_name_kana: null },
      { id: 'b', display_name_kanji: '中村 文彦', display_name_kana: null },
    ];
    const r = resolveStaffName('中村', s2);
    expect(r[0].id).toBe('a'); // 完全一致が先頭
  });

  it('該当なしは空配列', () => {
    expect(resolveStaffName('山田', staff)).toEqual([]);
  });

  it('1文字のスタッフ名は長い問い合わせ文に逆包含で誤マッチしない（誤爆防止）', () => {
    const oneChar: StaffNameRow[] = [{ id: 'x', display_name_kanji: '中', display_name_kana: null }];
    // 「中村は1人立ちOK」のような文に1文字名「中」が含まれても解決しない
    expect(resolveStaffName('中村は1人立ちOK', oneChar)).toEqual([]);
    // ただし完全一致（「中」そのもの）は解決する
    expect(resolveStaffName('中', oneChar).map((m) => m.id)).toEqual(['x']);
  });

  it('空クエリは空配列（誤爆防止）', () => {
    expect(resolveStaffName('', staff)).toEqual([]);
    expect(resolveStaffName('さん', staff)).toEqual([]);
  });

  it('表示名は kanji 優先', () => {
    const r = resolveStaffName('川面', staff);
    expect(r[0].name).toBe('川面 直人');
  });
});
