exports.up = (pgm) => {
  pgm.createTable('admin_audit_logs', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('uuid_generate_v4()')
    },
    admin_email: {
      type: 'text',
      notNull: true
    },
    action: {
      type: 'text',
      notNull: true
    },
    target_type: {
      type: 'text',
      notNull: true
    },
    target_id: {
      type: 'text'
    },
    payload_json: {
      type: 'jsonb',
      notNull: true
    },
    created_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('current_timestamp')
    }
  });
};

exports.down = (pgm) => {
  pgm.dropTable('admin_audit_logs');
};
