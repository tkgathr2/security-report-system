/**
 * 回帰テスト: 「1日1現場」重複をSlackボタンで西村さんが個別にACKできるようにする対応（社長指示 2026-07-24）。
 *
 * 背景:
 *  - 2026-07-24 の対応で force_import 時は errors[] への重複警告を握りつぶすようにした
 *    (adminCsvImport.force-import-dedup-no-error.test.ts)。
 *  - 今回はさらに一歩進め、重複を握りつぶさず Slack ボタンで裁けるようにする。
 *    重複の詳細（staffKey/castName/staffNo/workDate/existingWork/newWork）を収集し、
 *    duplicate_acks に未登録（未ACK）のものだけを unacknowledged_duplicates として
 *    レスポンスに含める。
 *
 * adminCsvImport.ts はDB接続前提の複雑な統合ルートのため、既存テスト群と同じく
 * ソースコード上に該当実装が存在することを検証する軽量ユニットテストとする。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('adminCsvImport 重複ACK対応（unacknowledged_duplicates）', () => {
  const src = readFileSync(join(__dirname, 'adminCsvImport.ts'), 'utf-8');

  it('DuplicateDetail 型と staffKey 生成ヘルパーが定義されている', () => {
    expect(src).toMatch(/interface DuplicateDetail/);
    expect(src).toMatch(/function buildStaffKey\(/);
    // staffNo優先、無ければ正規化した氏名
    expect(src).toMatch(/if \(staffNo && staffNo\.trim\(\)\) return staffNo\.trim\(\);/);
  });

  it('In-CSV重複(Place 1)・DB既存重複(Place 2)の両方で duplicateDetails.push が呼ばれる（forceImportの内外を問わず）', () => {
    const pushCount = (src.match(/duplicateDetails\.push\(/g) || []).length;
    expect(pushCount).toBeGreaterThanOrEqual(3); // Place1(1箇所) + Place2(!forceImport分・forceImport分の2箇所)
  });

  it('レスポンス構築前に duplicate_acks を照会し、ACK済みを除外している', () => {
    expect(src).toMatch(/SELECT staff_key, work_date::text as work_date FROM duplicate_acks/);
    expect(src).toMatch(/unacknowledgedDuplicates = uniqueDuplicateDetails\.filter\(d => !ackedSet\.has/);
  });

  it('ACK照会が失敗しても未ACK扱いのまま返す（通知が飛ばないより多重の方が安全というフェイルセーフ）', () => {
    const block = src.match(/if \(uniqueDuplicateDetails\.length > 0\) \{[\s\S]*?\n  \}/);
    expect(block).not.toBeNull();
    expect(block![0]).toMatch(/catch \(ackQueryError\)/);
  });

  it('最終レスポンスJSONに unacknowledged_duplicates フィールドが含まれ、既存フィールドは維持されている', () => {
    const responseBlock = src.match(/res\.status\(200\)\.json\(\{\s*ok: true,[\s\S]*?\}\);/);
    expect(responseBlock).not.toBeNull();
    const block = responseBlock![0];
    // 既存フィールド（壊していないこと）
    expect(block).toMatch(/duplicate_cast_assignments: duplicateCastAssignments/);
    expect(block).toMatch(/errors: errors\.slice\(0, 10\)/);
    // 新規フィールド
    expect(block).toMatch(/unacknowledged_duplicates: unacknowledgedDuplicates/);
  });
});
