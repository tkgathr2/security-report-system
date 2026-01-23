exports.up = (pgm) => {
  pgm.sql(`
    INSERT INTO admin_allowlist (email, is_active, created_by_admin_email)
    VALUES ('atsuhiro@takagi.bz', true, 'system')
    ON CONFLICT (email) DO NOTHING
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DELETE FROM admin_allowlist WHERE email = 'atsuhiro@takagi.bz'
  `);
};
