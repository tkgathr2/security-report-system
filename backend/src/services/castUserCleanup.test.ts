import { describe, it, expect } from 'vitest';
import { buildOrphanCastUsersDeleteQuery, ORPHAN_CAST_USER_GRACE_PERIOD_DAYS } from './castUserCleanup';

// KZ-127 回帰テスト:
// cleanupData() の「孤児 cast_users 自動削除」クエリから grace period 条件が
// 抜け落ちると、自己登録直後〜スタッフ紐付け前の正常な待機状態のキャストが
// 即座に論理削除され、確認メールのリンクが無効化される事故が再発する
// （本番実例: 2026-08-11、KZ-127 チケット参照）。

describe('buildOrphanCastUsersDeleteQuery (KZ-127)', () => {
  const query = buildOrphanCastUsersDeleteQuery();

  it('grace period（7日）を必ず条件に含む', () => {
    expect(ORPHAN_CAST_USER_GRACE_PERIOD_DAYS).toBe(7);
    expect(query).toContain(`INTERVAL '${ORPHAN_CAST_USER_GRACE_PERIOD_DAYS} days'`);
    expect(query).toMatch(/created_at\s*<\s*NOW\(\)\s*-\s*INTERVAL/);
  });

  it('スタッフ未紐付け（staff_id IS NULL）を対象条件に含む', () => {
    expect(query).toMatch(/staff_id IS NULL/);
  });

  it('論理削除済みスタッフへの紐付けも対象条件に含む', () => {
    expect(query).toMatch(/staff_id NOT IN \(SELECT id FROM staff_master WHERE deleted_at IS NULL\)/);
  });

  it('登録完了済み（email_verified かつ pin_hash あり）は対象から除外する', () => {
    expect(query).toMatch(/NOT \(email_verified = true AND pin_hash IS NOT NULL\)/);
  });

  it('既に論理削除済みの行は対象外（deleted_at IS NULL）', () => {
    expect(query).toMatch(/WHERE deleted_at IS NULL/);
  });

  it('論理削除（deleted_at = NOW()）であり物理削除ではない', () => {
    expect(query).toMatch(/UPDATE cast_users SET deleted_at = NOW\(\)/);
    expect(query).not.toMatch(/DELETE FROM/i);
  });
});
