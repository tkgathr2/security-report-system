/**
 * data_monitor_notifications.notification_kind の CHECK 制約を拡張する。
 *
 * 経緯:
 *   元の制約: CHECK (notification_kind IN ('pre_day', 'same_day'))
 *   dataUploadMonitor.ts の classifyKind() は実際には 'same_day_prefetch' / 'same_day_postfetch'
 *   を返すため、tryClaimNotification() の INSERT が毎回 CHECK 制約違反 (23514) で失敗し、
 *   12時の @channel アラートが一切発報されていなかった。
 *
 * 修正: CHECK を 4値に拡張し、既存の 'same_day' は後方互換で残す。
 */

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE data_monitor_notifications
      DROP CONSTRAINT IF EXISTS data_monitor_notifications_notification_kind_check;

    ALTER TABLE data_monitor_notifications
      ADD CONSTRAINT data_monitor_notifications_notification_kind_check
      CHECK (notification_kind IN ('pre_day', 'same_day', 'same_day_prefetch', 'same_day_postfetch'));
  `);
};

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE data_monitor_notifications
      DROP CONSTRAINT IF EXISTS data_monitor_notifications_notification_kind_check;

    ALTER TABLE data_monitor_notifications
      ADD CONSTRAINT data_monitor_notifications_notification_kind_check
      CHECK (notification_kind IN ('pre_day', 'same_day'));
  `);
};
