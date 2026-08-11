// KZ-127: migration 1784100000000 (H-CA3) は cast_users.email を大文字小文字を無視した
// partial unique index (LOWER(email) WHERE deleted_at IS NULL) に置き換える意図だったが、
// 同名 (idx_cast_users_email_active) のインデックスが別の定義 (LOWER 無し、素の email)
// で既に存在していたため `CREATE UNIQUE INDEX IF NOT EXISTS` が名前一致のみで
// 何もせずスキップし、意図した LOWER(email) 版は一度も作成されていなかった。
// （本番調査で確認: 実際に生きているインデックスは
//   `CREATE UNIQUE INDEX idx_cast_users_email_active ON cast_users (email) WHERE deleted_at IS NULL`
//   であり LOWER(email) ではなかった。1784300000000 が同名で `(email)` 版を
//   IF NOT EXISTS で作ろうとしたのも、実は既存の旧・素の email 版を追認しただけだった。）
//
// このマイグレーションは、名前を変えて実際に LOWER(email) 版を作成し、
// 旧・素の email 版を置き換える。事前に本番データを確認済み:
// 大文字小文字違いのメールを持つ行は 2 件のみ存在するが、いずれも既に論理削除済み
// (deleted_at IS NOT NULL) であり、LOWER() 化しても現存のアクティブ行との衝突は無い
// （2026-08-11 実測）。
exports.up = async (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS idx_cast_users_email_active;
  `);

  pgm.sql(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_cast_users_email_lower_active
    ON cast_users (LOWER(email))
    WHERE deleted_at IS NULL;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP INDEX IF EXISTS idx_cast_users_email_lower_active;`);
  pgm.sql(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_cast_users_email_active
    ON cast_users (email)
    WHERE deleted_at IS NULL;
  `);
};
