exports.up = (pgm) => {
  pgm.sql(`ALTER TABLE reports ADD COLUMN IF NOT EXISTS guards_json JSONB`);
  pgm.sql(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS supervisor_name TEXT`);
  pgm.sql(`ALTER TABLE admin_allowlist ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'admin'`);

  pgm.sql(`
    CREATE TABLE IF NOT EXISTS access_requests (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email TEXT NOT NULL,
      display_name TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      reviewed_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      reviewed_at TIMESTAMPTZ
    )
  `);

  pgm.sql(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  pgm.sql(`
    UPDATE admin_allowlist
    SET role = 'super_admin'
    WHERE LOWER(email) = LOWER('atsuhiro@takagi.bz')
      AND (role IS NULL OR role != 'super_admin')
  `);
};

exports.down = (pgm) => {
  pgm.sql(`ALTER TABLE reports DROP COLUMN IF EXISTS guards_json`);
  pgm.sql(`ALTER TABLE projects DROP COLUMN IF EXISTS supervisor_name`);
  pgm.sql(`ALTER TABLE admin_allowlist DROP COLUMN IF EXISTS role`);
  pgm.sql(`DROP TABLE IF EXISTS access_requests`);
  pgm.sql(`DROP TABLE IF EXISTS app_settings`);
};
