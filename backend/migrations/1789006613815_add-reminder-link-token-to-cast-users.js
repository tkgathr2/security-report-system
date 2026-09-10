/**
 * 1789006613815_add-reminder-link-token-to-cast-users.js
 *
 * KZ-145: 日次リマインダーメール（dailyReminderService）が、ログインセッションと
 * 同じ列 cast_users.magic_link_token を使ってメールのマジックリンクを発行していたため、
 * 朝7時/夕方18時の一斉送信のたびに、既にログイン中のキャスト（ホーム画面に追加して
 * 常時ログイン）のセッションが無条件に上書きされ強制ログアウトしていた
 * （本番実測: 401「セッションが無効です」/ JWT の mlh 不一致で失効）。
 *
 * メール専用のトークン列 reminder_link_token / reminder_link_expires を新設し、
 * dailyReminderService はこちらだけを更新する（既存セッションの magic_link_token には触れない）。
 */
exports.up = async (pgm) => {
  pgm.addColumns('cast_users', {
    reminder_link_token: { type: 'text' },
    reminder_link_expires: { type: 'timestamptz' },
  });

  pgm.createIndex('cast_users', 'reminder_link_token');
};

exports.down = async (pgm) => {
  pgm.dropColumns('cast_users', ['reminder_link_token', 'reminder_link_expires']);
};
