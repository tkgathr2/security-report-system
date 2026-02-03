exports.up = (pgm) => {
  pgm.addColumns('clients', {
    contact_name: {
      type: 'text',
      notNull: false
    },
    contact_title: {
      type: 'text',
      notNull: false
    },
    contact_email: {
      type: 'text',
      notNull: false
    }
  });
};

exports.down = (pgm) => {
  pgm.dropColumns('clients', ['contact_name', 'contact_title', 'contact_email']);
};
