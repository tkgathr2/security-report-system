exports.up = (pgm) => {
  // Add authentication fields to cast_users
  pgm.addColumns('cast_users', {
    name: {
      type: 'text',
      notNull: false
    },
    email_verified: {
      type: 'boolean',
      notNull: true,
      default: false
    },
    verification_token: {
      type: 'text',
      notNull: false
    },
    verification_token_expires: {
      type: 'timestamp',
      notNull: false
    },
    magic_link_token: {
      type: 'text',
      notNull: false
    },
    magic_link_expires: {
      type: 'timestamp',
      notNull: false
    },
    last_login_at: {
      type: 'timestamp',
      notNull: false
    }
  });

  // Make pin_hash nullable for initial registration
  pgm.alterColumn('cast_users', 'pin_hash', {
    notNull: false
  });

  // Create index for verification token lookup
  pgm.createIndex('cast_users', 'verification_token');
  pgm.createIndex('cast_users', 'magic_link_token');
};

exports.down = (pgm) => {
  pgm.dropIndex('cast_users', 'magic_link_token');
  pgm.dropIndex('cast_users', 'verification_token');
  
  pgm.alterColumn('cast_users', 'pin_hash', {
    notNull: true
  });

  pgm.dropColumns('cast_users', [
    'name',
    'email_verified',
    'verification_token',
    'verification_token_expires',
    'magic_link_token',
    'magic_link_expires',
    'last_login_at'
  ]);
};
