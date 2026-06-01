/**
 * ③ 案件取消（現場の中止）仕様 v1.0
 * projects テーブルに中止メタ情報を追加する（論理削除＝status='cancelled'）。
 * - status カラムは既存（'active' / 'pending_client' 等）。'cancelled' を新しい値として運用。
 * - 物理削除はせず、中止メタを保持して履歴・監査を残す。
 * - cancel_contacted_at（中止連絡を受けた日時）は将来のキャンセル料判定用の布石フィールド。
 * - status_before_cancel は復活（中止取消）時に元の status へ戻すために保持する。
 */
exports.up = (pgm) => {
  pgm.addColumns('projects', {
    cancelled_at: { type: 'timestamptz', notNull: false, default: null },
    cancel_reason: { type: 'text', notNull: false, default: null },
    // 先方から中止連絡を受けた日時（将来のキャンセル料計算用・布石）
    cancel_contacted_at: { type: 'timestamptz', notNull: false, default: null },
    cancelled_by: { type: 'text', notNull: false, default: null },
    // 中止前の status を退避（復活時に戻す）
    status_before_cancel: { type: 'text', notNull: false, default: null },
  });
};

exports.down = (pgm) => {
  pgm.dropColumns('projects', [
    'cancelled_at',
    'cancel_reason',
    'cancel_contacted_at',
    'cancelled_by',
    'status_before_cancel',
  ]);
};
