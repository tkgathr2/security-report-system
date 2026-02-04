exports.up = (pgm) => {
  pgm.addColumns('staff_master', {
    email: {
      type: 'text',
      notNull: false
    }
  });
};

exports.down = (pgm) => {
  pgm.dropColumns('staff_master', ['email']);
};
