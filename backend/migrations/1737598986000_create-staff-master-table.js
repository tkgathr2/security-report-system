exports.up = (pgm) => {
  pgm.createTable('staff_master', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('uuid_generate_v4()')
    },
    display_name_kanji: {
      type: 'text',
      notNull: true
    },
    display_name_kana: {
      type: 'text',
      notNull: true
    },
    created_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('current_timestamp')
    },
    updated_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('current_timestamp')
    }
  });

  pgm.createIndex('staff_master', 'display_name_kana');
};

exports.down = (pgm) => {
  pgm.dropTable('staff_master');
};
