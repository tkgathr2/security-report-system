/**
 * 案件単位の「中止連絡メール」手動再送（POST /api/admin/projects/:projectId/cancel/resend）の
 * クールダウン（レート制限）判定用カラム。
 *
 * reports.last_resend_at（報告書単位の再送クールダウン）と同様に、
 * 中止連絡メールの再送にも直近の再送時刻を記録し、連打による取引先への重複送信を防ぐ。
 * NULL = これまで中止連絡メールの再送なし。
 */
exports.up = (pgm) => {
  pgm.addColumn('projects', {
    last_cancel_resend_at: {
      type: 'timestamptz',
      notNull: false,
      default: null,
      comment: '中止連絡メールの手動再送の最終実行時刻（クールダウン判定用）',
    },
  });
};

exports.down = (pgm) => {
  pgm.dropColumn('projects', 'last_cancel_resend_at');
};
