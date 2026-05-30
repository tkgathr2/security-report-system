/**
 * email_notification_enabled フィーチャーフラグを system_settings に追加
 * 仕様書 v1.0 セクション11: フィーチャーフラグで段階リリース
 *
 * デフォルト 'false' でOFF。管理画面または直接DBで 'true' にすると有効化。
 */
exports.up = (pgm) => {
  // system_settingsテーブルはindex.ts起動時にCREATE TABLE IF NOT EXISTSされるが
  // マイグレーション実行時に未作成の可能性があるため、ここでも保険で作成
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  pgm.sql(`
    INSERT INTO system_settings (key, value, updated_at)
    VALUES ('email_notification_enabled', 'false', NOW())
    ON CONFLICT (key) DO NOTHING
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DELETE FROM system_settings WHERE key = 'email_notification_enabled'`);
};
