/**
 * 1784300000000_move-startup-ddl-to-migration.js
 *
 * index.ts の server listen 後に fire-and-forget で実行されていた DDL 群を
 * マイグレーションに移動する。各 DDL は IF NOT EXISTS / IF EXISTS を使って
 * 冪等に記述されているため、本番 DB に既に適用済みでも安全に再実行できる。
 *
 * 移動対象:
 *   - idx_reports_project_id_active (partial unique index)
 *   - reports.notes column
 *   - reports.partner_company_name column
 *   - reports.writer_name column
 *   - idx_cast_users_email_active (partial unique index)
 *   - clients.name_normalized partial unique index
 *   - inquiries table
 *   - jwt_token_blacklist table
 *   - data_monitor_notifications table + check constraint 拡張
 *   - system_settings table
 *
 * 注意: seedStaffData() 内の ADD COLUMN / CREATE INDEX はデータ修正の
 * 冪等ガードであり、マイグレーションではないため index.ts に残す。
 */
exports.up = async (pgm) => {
  // ---- reports indexes & columns ----
  pgm.sql(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_project_id_active
      ON reports (project_id)
      WHERE deleted_at IS NULL
  `);

  pgm.sql(`ALTER TABLE reports ADD COLUMN IF NOT EXISTS notes TEXT`);
  pgm.sql(`ALTER TABLE reports ADD COLUMN IF NOT EXISTS partner_company_name TEXT`);
  pgm.sql(`ALTER TABLE reports ADD COLUMN IF NOT EXISTS writer_name TEXT`);

  // ---- cast_users partial unique index ----
  pgm.sql(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_cast_users_email_active
      ON cast_users (email)
      WHERE deleted_at IS NULL
  `);

  // ---- clients.name_normalized partial unique ----
  pgm.sql(`ALTER TABLE clients DROP CONSTRAINT IF EXISTS clients_name_normalized_key`);
  pgm.sql(`
    CREATE UNIQUE INDEX IF NOT EXISTS clients_name_normalized_active_unique
      ON clients (name_normalized)
      WHERE deleted_at IS NULL
  `);

  // ---- inquiries table ----
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS inquiries (
      id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      cast_user_id        UUID        NOT NULL,
      cast_email          TEXT        NOT NULL,
      cast_name           TEXT,
      category            TEXT        NOT NULL,
      message             TEXT        NOT NULL,
      screenshot_bytes    BYTEA,
      screenshot_mime_type TEXT,
      status              TEXT        NOT NULL DEFAULT 'new',
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // ---- jwt_token_blacklist table ----
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS jwt_token_blacklist (
      token       TEXT        PRIMARY KEY,
      expires_at  TIMESTAMPTZ,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // ---- data_monitor_notifications table + check constraint 拡張 ----
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS data_monitor_notifications (
      target_date       DATE        NOT NULL,
      notification_kind TEXT        NOT NULL
        CHECK (notification_kind IN (
          'pre_day', 'same_day', 'same_day_prefetch', 'same_day_postfetch'
        )),
      notified_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      notified_hour     INTEGER     NOT NULL,
      PRIMARY KEY (target_date, notification_kind)
    )
  `);

  // morning_reminder / evening_reminder を許可する check constraint に拡張
  pgm.sql(`
    ALTER TABLE data_monitor_notifications
      DROP CONSTRAINT IF EXISTS data_monitor_notifications_notification_kind_check
  `);
  pgm.sql(`
    ALTER TABLE data_monitor_notifications
      ADD CONSTRAINT data_monitor_notifications_notification_kind_check
      CHECK (notification_kind IN (
        'pre_day', 'same_day', 'same_day_prefetch', 'same_day_postfetch',
        'morning_reminder', 'evening_reminder'
      ))
  `);

  // ---- system_settings table ----
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS system_settings (
      key        TEXT        PRIMARY KEY,
      value      TEXT        NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
};

exports.down = async (pgm) => {
  // DDL ロールバックは非破壊的なもののみ実施。
  // 本番データが存在しうるテーブル (inquiries, jwt_token_blacklist 等) は DROP しない。
  pgm.sql(`DROP INDEX IF EXISTS idx_reports_project_id_active`);
  pgm.sql(`DROP INDEX IF EXISTS idx_cast_users_email_active`);
  pgm.sql(`DROP INDEX IF EXISTS clients_name_normalized_active_unique`);
};
