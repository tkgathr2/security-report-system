import { describe, it, expect } from 'vitest';
import {
  analyzePlacements,
  PlacementInput,
  DEFAULT_ANALYZE_OPTIONS,
} from './controlKnowledgeLearn';

// テスト用の UUID 風 ID（normalizeCompatPair の辞書順比較が効くよう昇順に意味を持たせる）
const A = 'aaaaaaaa-0000-0000-0000-000000000001';
const B = 'bbbbbbbb-0000-0000-0000-000000000002';
const C = 'cccccccc-0000-0000-0000-000000000003';

/** ある現場に複数 staff を配置した行を作るヘルパー。 */
function project(id: string, startTime: string | null, staffIds: (string | null)[]): PlacementInput[] {
  return staffIds.map((staff_id) => ({ project_id: id, staff_id, start_time: startTime }));
}

describe('analyzePlacements - solo', () => {
  it('単独配置が閾値以上の staff を solo 候補に挙げる', () => {
    const rows: PlacementInput[] = [
      ...project('p1', '08:00', [A]),
      ...project('p2', '08:00', [A]),
      ...project('p3', '08:00', [A]),
    ];
    const { solo } = analyzePlacements(rows);
    expect(solo).toEqual([{ staff_id: A, solo_count: 3, total_count: 3 }]);
  });

  it('単独回数が閾値未満なら solo 候補に挙げない', () => {
    const rows = [...project('p1', '08:00', [A]), ...project('p2', '08:00', [A])];
    const { solo } = analyzePlacements(rows); // 既定閾値3
    expect(solo).toEqual([]);
  });

  it('他者と同居した現場は solo にカウントしないが total には数える', () => {
    const rows: PlacementInput[] = [
      ...project('p1', '08:00', [A]), // solo
      ...project('p2', '08:00', [A]), // solo
      ...project('p3', '08:00', [A]), // solo
      ...project('p4', '08:00', [A, B]), // 同居 → soloに数えない
    ];
    const { solo } = analyzePlacements(rows);
    expect(solo).toEqual([{ staff_id: A, solo_count: 3, total_count: 4 }]);
  });

  it('閾値はオプションで変えられる', () => {
    const rows = [...project('p1', '08:00', [A]), ...project('p2', '08:00', [A])];
    const { solo } = analyzePlacements(rows, { ...DEFAULT_ANALYZE_OPTIONS, soloThreshold: 2 });
    expect(solo).toEqual([{ staff_id: A, solo_count: 2, total_count: 2 }]);
  });
});

describe('analyzePlacements - night', () => {
  it('evening シフトの配置を夜勤実績として数える', () => {
    const rows: PlacementInput[] = [
      ...project('p1', '18:00', [A]), // evening
      ...project('p2', '20:00', [A, B]), // evening（A,Bとも）
      ...project('p3', '08:00', [A]), // morning → 数えない
    ];
    const { night } = analyzePlacements(rows);
    expect(night).toEqual([
      { staff_id: A, evening_count: 2 },
      { staff_id: B, evening_count: 1 },
    ]);
  });

  it('夜番がいなければ night は空', () => {
    const rows = [...project('p1', '08:00', [A]), ...project('p2', '12:00', [B])];
    const { night } = analyzePlacements(rows);
    expect(night).toEqual([]);
  });
});

describe('analyzePlacements - pair', () => {
  it('同居ペアの共起が閾値以上なら good ペア候補に挙げる（正規化済み）', () => {
    const rows: PlacementInput[] = [
      ...project('p1', '08:00', [A, B]),
      ...project('p2', '08:00', [B, A]), // 逆順でも同じペア
      ...project('p3', '08:00', [A, B]),
    ];
    const { pairs } = analyzePlacements(rows);
    // normalizeCompatPair で (小, 大) に正規化 → A < B
    expect(pairs).toEqual([{ staff_a_id: A, staff_b_id: B, together_count: 3 }]);
  });

  it('共起が閾値未満なら挙げない', () => {
    const rows = [...project('p1', '08:00', [A, B]), ...project('p2', '08:00', [A, B])];
    const { pairs } = analyzePlacements(rows); // 既定閾値3
    expect(pairs).toEqual([]);
  });

  it('3人現場は3ペアすべてを数える', () => {
    const rows: PlacementInput[] = [
      ...project('p1', '08:00', [A, B, C]),
      ...project('p2', '08:00', [A, B, C]),
      ...project('p3', '08:00', [A, B, C]),
    ];
    const { pairs } = analyzePlacements(rows);
    expect(pairs).toHaveLength(3);
    for (const p of pairs) expect(p.together_count).toBe(3);
    // 正規化で a < b になっていること
    for (const p of pairs) expect(p.staff_a_id < p.staff_b_id).toBe(true);
  });
});

describe('analyzePlacements - 重複排除と堅牢性', () => {
  it('同一 project 内の同じ staff の重複行は1人として数える', () => {
    const rows: PlacementInput[] = [
      { project_id: 'p1', staff_id: A, start_time: '08:00' },
      { project_id: 'p1', staff_id: A, start_time: '08:00' }, // 重複
    ];
    const { solo } = analyzePlacements(rows, { ...DEFAULT_ANALYZE_OPTIONS, soloThreshold: 1 });
    // 重複しても solo は1現場・単独扱い
    expect(solo).toEqual([{ staff_id: A, solo_count: 1, total_count: 1 }]);
  });

  it('staff_id が null/空の行は無視する', () => {
    const rows: PlacementInput[] = [
      ...project('p1', '08:00', [null]),
      { project_id: 'p2', staff_id: '', start_time: '08:00' },
      ...project('p3', '08:00', [A]),
    ];
    const { solo, night, pairs } = analyzePlacements(rows, {
      ...DEFAULT_ANALYZE_OPTIONS,
      soloThreshold: 1,
    });
    expect(solo).toEqual([{ staff_id: A, solo_count: 1, total_count: 1 }]);
    expect(night).toEqual([]);
    expect(pairs).toEqual([]);
  });

  it('null staff と実 staff が混在する現場は、実 staff 1人なら単独扱い', () => {
    const rows: PlacementInput[] = [
      { project_id: 'p1', staff_id: A, start_time: '08:00' },
      { project_id: 'p1', staff_id: null, start_time: '08:00' }, // 名寄せ未解決は除外
    ];
    const { solo } = analyzePlacements(rows, { ...DEFAULT_ANALYZE_OPTIONS, soloThreshold: 1 });
    expect(solo).toEqual([{ staff_id: A, solo_count: 1, total_count: 1 }]);
  });

  it('空入力なら全て空配列', () => {
    expect(analyzePlacements([])).toEqual({ solo: [], night: [], pairs: [] });
  });
});
