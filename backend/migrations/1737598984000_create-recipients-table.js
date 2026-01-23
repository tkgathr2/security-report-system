exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable('recipients', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('uuid_generate_v4()')
    },
    company_name: {
      type: 'text',
      notNull: true
    },
    contact_name: {
      type: 'text',
      notNull: true
    },
    email: {
      type: 'text',
      notNull: true
    },
    is_active: {
      type: 'boolean',
      notNull: true,
      default: true
    },
    created_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('CURRENT_TIMESTAMP')
    },
    updated_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('CURRENT_TIMESTAMP')
    }
  });

  // UNIQUE constraint on (company_name, contact_name, email)
  pgm.addConstraint('recipients', 'recipients_company_contact_email_unique', {
    unique: ['company_name', 'contact_name', 'email']
  });

  // Index for searching by company_name
  pgm.createIndex('recipients', 'company_name');
};

exports.down = (pgm) => {
  pgm.dropTable('recipients');
};
