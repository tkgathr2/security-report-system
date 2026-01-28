exports.up = (pgm) => {
  pgm.addColumns('cast_users', {
    selected_staff_id: {
      type: 'uuid',
      references: 'staff_master(id)',
      onDelete: 'SET NULL'
    },
    selected_name_kanji: {
      type: 'text'
    }
  });
};

exports.down = (pgm) => {
  pgm.dropColumns('cast_users', ['selected_staff_id', 'selected_name_kanji']);
};
