exports.up = (pgm) => {
  pgm.createTable('reports', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('uuid_generate_v4()')
    },
    project_id: {
      type: 'uuid',
      notNull: true,
      references: 'projects(id)'
    },
    cast_user_id: {
      type: 'uuid',
      notNull: true,
      references: 'cast_users(id)'
    },
    supervisor_name: {
      type: 'text',
      notNull: true
    },
    writer_name: {
      type: 'text',
      notNull: true
    },
    weather: {
      type: 'text',
      notNull: true
    },
    guard_contents: {
      type: 'text[]',
      notNull: true
    },
    guard_other_text: {
      type: 'text'
    },
    overtime_hours: {
      type: 'int'
    },
    has_qualifier: {
      type: 'boolean',
      notNull: true
    },
    qualifier_name: {
      type: 'text'
    },
    signature_png: {
      type: 'bytea',
      notNull: true
    },
    pdf_bytes: {
      type: 'bytea',
      notNull: true
    },
    status: {
      type: 'text',
      notNull: true
    },
    approved_at: {
      type: 'timestamp',
      notNull: true
    },
    created_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('current_timestamp')
    },
    pdf_generation_status: {
      type: 'text',
      notNull: true,
      default: 'success'
    },
    pdf_generated_at: {
      type: 'timestamp'
    }
  });
};

exports.down = (pgm) => {
  pgm.dropTable('reports');
};
