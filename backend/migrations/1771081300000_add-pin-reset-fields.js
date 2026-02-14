exports.up = (pgm) => {
  pgm.addColumns('cast_users', {
    pin_reset_token: {
      type: 'text',
      notNull: false
    },
    pin_reset_token_expires: {
      type: 'timestamp',
      notNull: false
    }
  });

  pgm.createIndex('cast_users', 'pin_reset_token');
};

exports.down = (pgm) => {
  pgm.dropIndex('cast_users', 'pin_reset_token');
  pgm.dropColumns('cast_users', [
    'pin_reset_token',
    'pin_reset_token_expires'
  ]);
};
