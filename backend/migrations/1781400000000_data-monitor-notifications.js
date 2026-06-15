/**
 * data_monitor_notifications テーブル: 案件データ未登録アラートの送信履歴
 * Bug-A/B 修復: in-memory Set を廃止し DB 永続化 + dedup 単位を (対象日 × 種別) に集約
 *
 *  notification_kind:
 *   - 'pre_day'  ... 前日夕方の事前通知 (17/19/21時)
 *   - 'same_day' ... 当日の確認通知 (0/9/12時)
 *
 * 1対象日 × 1種別 = 最大1通知（同種別の retry 時刻は重複送信しない）
 */
exports.up = (pgm) => {
  pgm.createTable('data_monitor_notifications', {
    target_date: {
      type: 'date',
      notNull: true,
    },
    notification_kind: {
      type: 'text',
      notNull: true,
      check: "notification_kind IN ('pre_day', 'same_day')",
    },
    notified_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('NOW()'),
    },
    notified_hour: {
      type: 'integer',
      notNull: true,
      comment: '実際に送信した時刻 (JST hour, 0-23)。デバッグ用',
    },
  });

  pgm.addConstraint('data_monitor_notifications', 'data_monitor_notifications_pkey', {
    primaryKey: ['target_date', 'notification_kind'],
  });
};

exports.down = (pgm) => {
  pgm.dropTable('data_monitor_notifications');
};
