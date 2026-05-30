/**
 * email_logs に last_manual_resend_at 列を追加
 *
 * 手動再送（管理者操作）専用のレート制限判定に使う。
 * updated_at はシステム送信（成功/失敗/retry）でも更新されてしまい、
 * 「送信失敗直後の正当な手動再送」を誤ってブロックするため、
 * 手動再送時刻だけを記録する専用列を分離する。
 * NULL = これまで手動再送なし（即再送可）。
 */
exports.up = (pgm) => {
  pgm.addColumns('email_logs', {
    last_manual_resend_at: {
      type: 'timestamptz',
      notNull: false,
      default: null,
      comment: '直近の手動再送試行時刻（成功/失敗を問わず再送試行時点で更新）。レート制限判定に使用。',
    },
  });
};

exports.down = (pgm) => {
  pgm.dropColumns('email_logs', ['last_manual_resend_at']);
};
