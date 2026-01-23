exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable('report_recipients', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('uuid_generate_v4()')
    },
    report_id: {
      type: 'uuid',
      notNull: true,
      references: 'reports(id)',
      onDelete: 'CASCADE'
    },
    recipient_id: {
      type: 'uuid',
      notNull: true,
      references: 'recipients(id)',
      onDelete: 'CASCADE'
    },
    created_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('CURRENT_TIMESTAMP')
    }
  });

  // UNIQUE constraint on (report_id, recipient_id)
  pgm.addConstraint('report_recipients', 'report_recipients_report_recipient_unique', {
    unique: ['report_id', 'recipient_id']
  });

  // Indexes for foreign keys
  pgm.createIndex('report_recipients', 'report_id');
  pgm.createIndex('report_recipients', 'recipient_id');
};

exports.down = (pgm) => {
  pgm.dropTable('report_recipients');
};
