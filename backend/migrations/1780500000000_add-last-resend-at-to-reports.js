/**
 * 報告書単位の手動再送（POST /api/admin/reports/:reportId/resend）の
 * クールダウン（レート制限）判定用カラム。
 *
 * email_logs の last_manual_resend_at（個別ログ再送のクールダウン）と同様に、
 * 報告書単位の再送にも直近の再送時刻を記録し、連打による取引先への重複送信を防ぐ。
 * NULL = これまで報告書単位の再送なし。
 */
exports.up = (pgm) => {
  pgm.addColumn('reports', {
    last_resend_at: {
      type: 'timestamptz',
      notNull: false,
      default: null,
      comment: '報告書単位の手動再送の最終実行時刻（クールダウン判定用）',
    },
  });
};

exports.down = (pgm) => {
  pgm.dropColumn('reports', 'last_resend_at');
};
