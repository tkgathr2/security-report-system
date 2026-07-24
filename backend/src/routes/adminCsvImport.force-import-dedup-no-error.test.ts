/**
 * 回帰テスト: 自動同期(force_import=true)では「1日1現場まで」の重複除外を errors[] に載せない。
 *
 * 背景（社長指摘 2026-07-21・#ky_警備報告書システム_ほうこちゃん）：
 *  - プロキャス自動同期(force_import=true)は元データCSVを毎回まるごと取込む。
 *  - 元データに「同じ人・同じ日・複数現場」（例: 現任教育＋現場）が残っていると、
 *    In-CSV重複検出(Place 1)が毎回同じ行を検出する。
 *  - houko 自身は status=success / skipped=0 で正常取込しているのに、
 *    この重複notを errors[] に載せていたため procast-sync が errorCount>0 を
 *    「一部失敗」とみなし、同一警告を毎日3回鳴らし続けていた（実DB csv_imports で確認）。
 *
 * 修正: force_import=true のときは errors.push をスキップし、duplicateCastAssignments の
 *       集計だけ行う。手動取込(force_import=false)のブロック挙動は従来どおり温存する。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('adminCsvImport 自動同期時の重複除外はerrorsに載せない', () => {
  const src = readFileSync(join(__dirname, 'adminCsvImport.ts'), 'utf-8');

  it('In-CSV重複(Place 1)の「1日1現場まで」push が !forceImport でガードされている', () => {
    // castDateAssignments.has(...) ブロック内の errors.push が forceImport 条件で守られていること。
    const blockMatch = src.match(
      /if \(castDateAssignments\.has\(castDateKey\)\) \{[\s\S]*?duplicateCastAssignments\+\+;\s*\}/
    );
    expect(blockMatch).not.toBeNull();
    const block = blockMatch![0];

    // 「1日1現場まで」の errors.push が同ブロック内に存在する
    expect(block).toMatch(/errors\.push\([\s\S]*1日1現場まで/);
    // その push が if (!forceImport) でガードされている
    expect(block).toMatch(/if \(!forceImport\)\s*\{[\s\S]*errors\.push/);
    // 重複カウント自体は force でも継続して計上する
    expect(block).toMatch(/duplicateCastAssignments\+\+;/);
  });
});
