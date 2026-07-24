// 「1日1現場」重複をSlackボタンで西村さんが個別にACKできるようにする(2026-07-24 社長指示)。
// staff_key + work_date の組でACK済みかどうかを管理する。
exports.up = function(pgm) {
  pgm.createTable('duplicate_acks', {
    id: 'id',
    staff_key: {
      type: 'text',
      notNull: true,
    },
    work_date: {
      type: 'date',
      notNull: true,
    },
    acked_by: {
      type: 'text',
    },
    acked_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  });

  pgm.addConstraint('duplicate_acks', 'duplicate_acks_staff_key_work_date_unique', {
    unique: ['staff_key', 'work_date'],
  });
};

exports.down = function(pgm) {
  pgm.dropTable('duplicate_acks');
};
