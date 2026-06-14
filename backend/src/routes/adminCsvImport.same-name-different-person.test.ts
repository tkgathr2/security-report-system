/**
 * 西野QA: 同姓同名別人の同日異案件アサインで「重複検出が誤発火し全体ROLLBACKされる」再現テスト
 *
 * 根拠（バグチェックラボ 北村Critical#1 + 田所Critical#2）：
 *  - staffResolver はスタッフNo(procast_staff_no)で同姓同名別人を分離する設計（PR#443/#444/#448）
 *  - しかし adminCsvImport.ts:710-717, 720-733 のダブルブッキング検出は
 *    castName（display_name_kanji）のみで判定し、procast_staff_no を一切照合していない
 *  - 同姓同名別人2行が同日に出現すると duplicateCastAssignments > 0 で ROLLBACK
 *
 * このテストは「失敗するべき」状態で追加する（赤）。
 * cto-room-dev がダブルブッキング検出キーを `${procast_staff_no || castName}::${dateKey}`
 * に修正したら緑になる回帰防止網になる。
 *
 * 動作確認の方針：DB必須テストのフル統合は別途。ここではキー組み立てロジックの
 * "事実" を端的にコード上で示し、現在の実装が name-only キーを使っていることを
 * 静的にも一目で示す軽量ユニットテスト。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('adminCsvImport ダブルブッキング検出キー（同姓同名別人問題）', () => {
  const src = readFileSync(
    join(__dirname, 'adminCsvImport.ts'),
    'utf-8'
  );

  it('castDateKey 構築が castName のみでなく staffNo を優先する（同姓同名別人対応）', () => {
    // 修正前：const castDateKey = `${castName}::${dateKey}`;
    // 修正後：const castDateKey = `${staffNo || castName}::${dateKey}`;
    const hasNameOnlyKey = /castDateKey\s*=\s*[`'"]\$\{castName\}::\$\{dateKey\}/.test(src);
    const hasStaffNoBasedKey = /castDateKey\s*=\s*[`'"]\$\{\s*staffNo\s*\|\|\s*castName\s*\}::\$\{dateKey\}/.test(src);

    expect({ hasNameOnlyKey, hasStaffNoBasedKey }).toEqual({
      hasNameOnlyKey: false,
      hasStaffNoBasedKey: true,
    });
  });

  it('既存案件の重複チェックSQLが procast_staff_no を優先照合する（同姓同名別人対応）', () => {
    // 修正後：sm.procast_staff_no と sm.display_name_kanji の両方を WHERE で使う。
    // No指定時は No一致のみ、No空欄行は No未付与の同名のみを既存とみなす。
    const usesStaffNoInDoubleBookingSql =
      /sm\.procast_staff_no\s*=/.test(src) &&
      /sm\.display_name_kanji/.test(src);
    expect(usesStaffNoInDoubleBookingSql).toBe(true);
  });
});
