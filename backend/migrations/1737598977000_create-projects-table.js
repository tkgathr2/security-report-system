exports.up = (pgm) => {
  pgm.createTable('projects', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('uuid_generate_v4()')
    },
    project_key: {
      type: 'text',
      notNull: true,
      unique: true
    },
    client_id: {
      type: 'uuid',
      references: 'clients(id)'
    },
    client_name_raw: {
      type: 'text',
      notNull: true
    },
    work_date: {
      type: 'date',
      notNull: true
    },
    work_name: {
      type: 'text',
      notNull: true
    },
    location: {
      type: 'text',
      notNull: true
    },
    start_time: {
      type: 'text'
    },
    end_time: {
      type: 'text'
    },
    break_time: {
      type: 'text'
    },
    work_title_raw: {
      type: 'text',
      notNull: true
    },
    qualifier_hint: {
      type: 'text'
    },
    unique_url: {
      type: 'text',
      notNull: true,
      unique: true
    },
    url_expires_at: {
      type: 'timestamp',
      notNull: true
    },
    status: {
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
};

exports.down = (pgm) => {
  pgm.dropTable('projects');
};
