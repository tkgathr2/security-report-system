/**
 * ③ 案件取消（現場の中止）仕様 v1.0
 * email_logs を「案件単位の中止連絡メール」にも対応させる。
 * - 中止連絡メールは報告書(report)が存在しない案件に対して送るため、report_id を nullable にする。
 * - 代わりに project_id を追加し、案件単位の送信履歴を記録できるようにする。
 * - recipient_type には新たに 'cancel' を運用上追加する（CHECK制約は無いためスキーマ変更不要）。
 * - 冪等性キーは `cancel:{project_id}:{email}` 形式（既存ユニークインデックスをそのまま利用）。
 */
exports.up = (pgm) => {
  // 中止連絡メールは report が無いケースがあるため report_id を nullable に
  pgm.alterColumn('email_logs', 'report_id', { notNull: false });

  pgm.addColumn('email_logs', {
    project_id: {
      type: 'uuid',
      notNull: false,
      references: 'projects(id)',
      onDelete: 'SET NULL',
    },
  });

  pgm.createIndex('email_logs', 'project_id', {
    where: 'project_id IS NOT NULL',
    name: 'idx_email_logs_project_id',
  });
};

exports.down = (pgm) => {
  pgm.dropIndex('email_logs', 'project_id', { name: 'idx_email_logs_project_id', ifExists: true });
  pgm.dropColumn('email_logs', 'project_id');
  // 既存データに report_id が NULL の行が残っている場合 notNull 復帰は失敗し得るため ifExists 的に best-effort
  pgm.alterColumn('email_logs', 'report_id', { notNull: true });
};
