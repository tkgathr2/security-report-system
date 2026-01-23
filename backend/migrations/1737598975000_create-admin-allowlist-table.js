exports.up = (pgm) => {
  pgm.createTable('admin_allowlist', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('uuid_generate_v4()')
    },
    email: {
      type: 'text',
      notNull: true,
      unique: true
    },
    is_active: {
      type: 'boolean',
      notNull: true,
      default: true
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
    },
    created_by_admin_email: {
      type: 'text',
      notNull: true
    }
  });
};

exports.down = (pgm) => {
  pgm.dropTable('admin_allowlist');
};
