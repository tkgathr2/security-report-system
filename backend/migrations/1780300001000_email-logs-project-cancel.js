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
  // 案件中止メールのログ（report_id IS NULL）は project_id 削除で参照を失うため、
  // report_id の NOT NULL 復帰前に削除しておく。
  // これをしないと、中止メール送信後に down を流すと SET NOT NULL が
  // 「column contains null values」で失敗し、切り戻しが途中停止する。
  pgm.sql('DELETE FROM email_logs WHERE report_id IS NULL');
  pgm.alterColumn('email_logs', 'report_id', { notNull: true });
};
