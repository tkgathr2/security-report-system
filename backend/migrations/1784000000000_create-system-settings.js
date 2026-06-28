/**
 * system_settings テーブル: PDF レイアウト・フィーチャーフラグ等のシステム設定を保存する KV ストア
 *
 * key: 設定名 (例: 'pdf_layout', 'pdf_design', 'client_email_enabled', 'email_notification_enabled')
 * value: 設定値 (TEXT)
 *
 * 旧実装では /api/reports/:reportId/approve ハンドラ内でリクエストごとに
 * CREATE TABLE IF NOT EXISTS を実行していた。これを migration に昇格させることで
 * 毎リクエストのテーブルロック取得とスキーマの散在を解消する。
 */
exports.up = (pgm) => {
  pgm.createTable(
    'system_settings',
    {
      key: {
        type: 'text',
        primaryKey: true,
      },
      value: {
        type: 'text',
        notNull: true,
      },
      updated_at: {
        type: 'timestamptz',
        default: pgm.func('NOW()'),
      },
    },
    { ifNotExists: true }
  );
};

exports.down = (pgm) => {
  pgm.dropTable('system_settings', { ifExists: true });
};
