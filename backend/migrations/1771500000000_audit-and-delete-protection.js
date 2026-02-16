exports.up = (pgm) => {
  pgm.addColumns('admin_audit_logs', {
    actor_type: {
      type: 'text',
      notNull: true,
      default: "'admin'"
    },
    ip_address: {
      type: 'text'
    }
  });

  pgm.createIndex('admin_audit_logs', 'created_at');
  pgm.createIndex('admin_audit_logs', 'action');
  pgm.createIndex('admin_audit_logs', 'admin_email');

  const tables = [
    'staff_master',
    'cast_users',
    'clients',
    'projects',
    'project_casts',
    'reports',
    'recipients',
    'report_recipients'
  ];

  pgm.sql(`
    CREATE OR REPLACE FUNCTION prevent_physical_delete()
    RETURNS TRIGGER AS $$
    BEGIN
      RAISE EXCEPTION 'Physical DELETE is not allowed on table %. Use soft delete (SET deleted_at = NOW()) instead.', TG_TABLE_NAME;
      RETURN NULL;
    END;
    $$ LANGUAGE plpgsql;
  `);

  for (const table of tables) {
    pgm.sql(`
      CREATE TRIGGER prevent_delete_${table}
      BEFORE DELETE ON ${table}
      FOR EACH ROW
      EXECUTE FUNCTION prevent_physical_delete();
    `);
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
    'report_recipients'
  ];

  for (const table of tables) {
    pgm.sql(`DROP TRIGGER IF EXISTS prevent_delete_${table} ON ${table};`);
  }

  pgm.sql('DROP FUNCTION IF EXISTS prevent_physical_delete();');

  pgm.dropIndex('admin_audit_logs', 'admin_email');
  pgm.dropIndex('admin_audit_logs', 'action');
  pgm.dropIndex('admin_audit_logs', 'created_at');

  pgm.dropColumns('admin_audit_logs', ['actor_type', 'ip_address']);
};
