// KZ-127: cast_users の「孤児（スタッフ未紐付け）」自動削除クエリを、テスト可能な形で切り出したもの。
//
// 背景（本番調査で確認した実際の事故）:
//   backend/src/index.ts の cleanupData() は起動時＋6時間ごとに、
//   「staff_id が未設定 or 論理削除済みスタッフを指している」かつ「まだ email_verified/pin_hash が
//   揃っていない」cast_users 行を、作成からの経過時間を一切見ずに即座に論理削除していた。
//
//   これは「キャストがメールアドレスを入力して自己登録した直後〜管理者がそのキャストを
//   スタッフとして作成/紐付けするまでの待機時間」という、登録フローとして正常な一時状態を
//   誤って「孤児（ゴミ）」とみなして消してしまう欠陥だった。
//
//   実測（本番DB直読み・2026-08-11）: KZ-127 の実例キャスト（神野さん）のケースで、
//   2026-08-04 16:30 に自己登録 → staff_id が未紐付けの間にこの削除ジョブが作動 →
//   確認メールのリンクが無効化 → 以後 6 日間、email_verified=false / pin_hash=null のまま
//   スタック（モバイルからは「登録したのに登録されていないと言われる」＝KZ-127症状2と一致）。
//
// 対策: 作成から一定の猶予期間（グレースピリオド）を置いてからのみ「本当の孤児」とみなす。
// 正常な登録フロー（自己登録 → 管理者によるスタッフ紐付け → メール確認）が完了するのに
// 現実的に十分な日数として 7 日を採用する。

export const ORPHAN_CAST_USER_GRACE_PERIOD_DAYS = 7;

/**
 * 「スタッフに紐付いておらず、かつ未登録完了（email_verified/pin_hash が揃っていない）」
 * cast_users 行のうち、作成から ORPHAN_CAST_USER_GRACE_PERIOD_DAYS 日以上経過したものだけを
 * 論理削除する UPDATE クエリを返す。
 *
 * grace period 条件（created_at < NOW() - INTERVAL '7 days'）が抜けると、登録直後の
 * 正常な待機状態のキャストが再び誤削除されるため、この関数のテストで固定している。
 */
export function buildOrphanCastUsersDeleteQuery(): string {
  return `
    UPDATE cast_users SET deleted_at = NOW()
    WHERE deleted_at IS NULL
      AND (staff_id IS NULL
           OR staff_id NOT IN (SELECT id FROM staff_master WHERE deleted_at IS NULL))
      AND NOT (email_verified = true AND pin_hash IS NOT NULL)
      AND created_at < NOW() - INTERVAL '${ORPHAN_CAST_USER_GRACE_PERIOD_DAYS} days'
  `;
}
