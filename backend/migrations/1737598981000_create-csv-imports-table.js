exports.up = (pgm) => {
  pgm.createTable('csv_imports', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('uuid_generate_v4()')
    },
    imported_by_admin_email: {
      type: 'text',
      notNull: true
    },
    original_file_name: {
      type: 'text',
      notNull: true
    },
    detected_encoding: {
      type: 'text',
      notNull: true
    },
    status: {
      type: 'text',
      notNull: true
    },
    created_projects_count: {
      type: 'int',
      notNull: true
    },
    skipped_rows_count: {
      type: 'int',
      notNull: true
    },
    pending_client_rows_count: {
      type: 'int',
      notNull: true
    },
    errors_json: {
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
  pgm.dropTable('csv_imports');
};
