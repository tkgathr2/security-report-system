exports.up = (pgm) => {
  pgm.createTable('report_drafts', {
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
    payload_json: {
      type: 'jsonb',
      notNull: true
    },
    client_updated_at: {
      type: 'timestamp',
      notNull: true
    },
    server_updated_at: {
      type: 'timestamp',
      notNull: true
    }
  });

  pgm.addConstraint('report_drafts', 'report_drafts_project_id_cast_user_id_unique', {
    unique: ['project_id', 'cast_user_id']
  });
};

exports.down = (pgm) => {
  pgm.dropTable('report_drafts');
};
