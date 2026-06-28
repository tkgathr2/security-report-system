/**
 * 1784200000000_create-reminder-sends.js
 *
 * reminder_sends テーブル: cast_user_id 単位でのリマインダー送信記録。
 * 従来の data_monitor_notifications はタイミング(morning/evening)単位での
 * バッチ dedup しか持たず、同一スタッフへの重複送信を防げなかった。
 * このテーブルにより (cast_user_id, target_date, timing) の一意制約で
 * 個人単位の重複を防ぐ。
 */
exports.up = async (pgm) => {
  pgm.createTable('reminder_sends', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    cast_user_id: { type: 'uuid', notNull: true },
    target_date: { type: 'date', notNull: true },
    timing: { type: 'text', notNull: true }, // 'morning' | 'evening'
    sent_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('NOW()'),
    },
  });

  pgm.addConstraint(
    'reminder_sends',
    'reminder_sends_timing_check',
    "CHECK (timing IN ('morning', 'evening'))"
  );

  pgm.createIndex(
    'reminder_sends',
    ['cast_user_id', 'target_date', 'timing'],
    {
      unique: true,
      name: 'reminder_sends_unique_per_user_date_timing',
    }
  );
};

exports.down = async (pgm) => {
  pgm.dropTable('reminder_sends');
};
