exports.up = (pgm) => {
  pgm.createTable('project_casts', {
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
    staff_no: {
      type: 'text',
      notNull: true
    },
    cast_name: {
      type: 'text',
      notNull: true
    },
    row_index: {
      type: 'int',
      notNull: true
    }
  });

  pgm.addConstraint('project_casts', 'project_casts_project_id_staff_no_unique', {
    unique: ['project_id', 'staff_no']
  });
};

exports.down = (pgm) => {
  pgm.dropTable('project_casts');
};
