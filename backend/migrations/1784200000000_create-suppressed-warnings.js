exports.shapeChange = function(pgm) {
  pgm.createTable('suppressed_warnings', {
    id: 'id',
    client_id: {
      type: 'varchar',
      notNull: true,
      references: '"clients"',
      onDelete: 'cascade',
    },
    created_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('CURRENT_TIMESTAMP'),
    },
  });

  pgm.addConstraint('suppressed_warnings', 'suppressed_warnings_client_id_unique', {
    unique: ['client_id'],
  });
};
