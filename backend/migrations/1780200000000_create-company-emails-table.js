/**
 * company_emails テーブル: 取引先企業ごとの通知先メールアドレス（複数対応）
 * 仕様書 v1.0 F-1: 会社ごとに通知先メール（複数可）を登録・編集・削除できる
 */
exports.up = (pgm) => {
  pgm.createTable('company_emails', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    company_id: {
      type: 'uuid',
      notNull: true,
      references: 'clients(id)',
      onDelete: 'CASCADE',
    },
    email: {
      type: 'text',
      notNull: true,
    },
    label: {
      type: 'text',
      notNull: false,
      comment: '任意のラベル（例: 担当者名、部署名）',
    },
    is_active: {
      type: 'boolean',
      notNull: true,
      default: true,
    },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('NOW()'),
    },
    updated_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('NOW()'),
    },
    deleted_at: {
      type: 'timestamptz',
      default: null,
    },
  });

  // 同一会社に同じメールアドレスの重複登録を防止（論理削除されていないもの）
  pgm.createIndex('company_emails', ['company_id', 'email'], {
    unique: true,
    where: 'deleted_at IS NULL',
    name: 'idx_company_emails_company_email_active',
  });

  // 会社IDでの検索用インデックス
  pgm.createIndex('company_emails', 'company_id', {
    where: 'deleted_at IS NULL',
    name: 'idx_company_emails_company_id_active',
  });
};

exports.down = (pgm) => {
  pgm.dropTable('company_emails');
};
