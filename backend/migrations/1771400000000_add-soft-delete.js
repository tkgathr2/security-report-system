exports.up = (pgm) => {
  const tables = [
    'staff_master',
    'cast_users',
    'clients',
    'projects',
    'project_casts',
    'reports',
    'recipients',
    'report_recipients',
  ];

  for (const table of tables) {
    pgm.addColumn(table, {
      deleted_at: {
        type: 'timestamp',
        default: null
      }
    });
    pgm.createIndex(table, 'deleted_at', {
      where: 'deleted_at IS NULL'
    });
  }
};

exports.down = (pgm) => {
  const tables = [
    'staff_master',
    'cast_users',
    'clients',
    'projects',
    'project_casts',
    'reports',
    'recipients',
    'report_recipients',
  ];

  for (const table of tables) {
    pgm.dropIndex(table, 'deleted_at');
    pgm.dropColumn(table, 'deleted_at');
  }
};
