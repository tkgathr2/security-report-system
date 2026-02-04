exports.up = (pgm) => {
  pgm.addColumns('cast_users', {
    staff_id: {
      type: 'uuid',
      references: 'staff_master(id)',
      onDelete: 'SET NULL'
    }
  });
};

exports.down = (pgm) => {
  pgm.dropColumns('cast_users', ['staff_id']);
};
