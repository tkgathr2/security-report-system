/**
 * email_logs テーブル: メール送信履歴（冪等性チェック・可視化・手動再送用）
 * 仕様書 v1.0 F-4/F-5: 送信結果記録・手動再送
 */
exports.up = (pgm) => {
  pgm.createTable('email_logs', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    report_id: {
      type: 'uuid',
      notNull: true,
      references: 'reports(id)',
      onDelete: 'CASCADE',
    },
    company_id: {
      type: 'uuid',
      notNull: false,
      references: 'clients(id)',
      onDelete: 'SET NULL',
    },
    recipient_email: {
      type: 'text',
      notNull: true,
    },
    recipient_type: {
      type: 'text',
      notNull: true,
      comment: 'client | writer | admin',
    },
    status: {
      type: 'text',
      notNull: true,
      default: 'pending',
      comment: 'pending | sent | failed | skipped',
    },
    idempotency_key: {
      type: 'text',
      notNull: true,
      comment: 'report_id + recipient_email + recipient_type の組み合わせで冪等性を担保',
    },
    resend_message_id: {
      type: 'text',
      notNull: false,
      comment: 'Resend APIから返されるmessage_id',
    },
    error_message: {
      type: 'text',
      notNull: false,
    },
    retry_count: {
      type: 'integer',
      notNull: true,
      default: 0,
    },
    sent_at: {
      type: 'timestamptz',
      notNull: false,
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
  });

  // 冪等性チェック用ユニークインデックス
  pgm.createIndex('email_logs', 'idempotency_key', {
    unique: true,
    name: 'idx_email_logs_idempotency_key',
  });

  // 報告書IDでの検索用
  pgm.createIndex('email_logs', 'report_id', {
    name: 'idx_email_logs_report_id',
  });

  // 会社IDでの検索用
  pgm.createIndex('email_logs', 'company_id', {
    where: 'company_id IS NOT NULL',
    name: 'idx_email_logs_company_id',
  });

  // ステータス別の検索用（失敗ログの確認）
  pgm.createIndex('email_logs', 'status', {
    where: "status = 'failed'",
    name: 'idx_email_logs_failed',
  });
};

exports.down = (pgm) => {
  pgm.dropTable('email_logs');
};
