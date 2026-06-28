/**
 * data_monitor_notifications.notification_kind の CHECK 制約に
 * 'morning_reminder' / 'evening_reminder' を追加する。
 *
 * 経緯:
 *   dailyReminderService.ts がリマインダー送信済みを DB で記録するために
 *   この 2 値を INSERT する。既存の 4 値は後方互換で残す。
 */

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE data_monitor_notifications
      DROP CONSTRAINT IF EXISTS data_monitor_notifications_notification_kind_check;
    ALTER TABLE data_monitor_notifications
      ADD CONSTRAINT data_monitor_notifications_notification_kind_check
      CHECK (notification_kind IN ('pre_day', 'same_day', 'same_day_prefetch', 'same_day_postfetch', 'morning_reminder', 'evening_reminder'));
  `);
};

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE data_monitor_notifications
      DROP CONSTRAINT IF EXISTS data_monitor_notifications_notification_kind_check;
    ALTER TABLE data_monitor_notifications
      ADD CONSTRAINT data_monitor_notifications_notification_kind_check
      CHECK (notification_kind IN ('pre_day', 'same_day', 'same_day_prefetch', 'same_day_postfetch'));
  `);
};
