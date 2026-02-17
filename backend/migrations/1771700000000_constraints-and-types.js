exports.up = (pgm) => {
  pgm.sql(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_access_requests_email_pending
    ON access_requests (LOWER(email))
    WHERE status = 'pending';
  `);

  pgm.sql(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_cast_users_staff_id_unique
    ON cast_users (staff_id)
    WHERE staff_id IS NOT NULL AND deleted_at IS NULL;
  `);

  pgm.sql(`
    ALTER TABLE projects
    ALTER COLUMN url_expires_at TYPE TIMESTAMPTZ
    USING url_expires_at AT TIME ZONE 'UTC';
  `);

  pgm.sql(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_master_name_unique
    ON staff_master (display_name_kanji, display_name_kana)
    WHERE deleted_at IS NULL;
  `);

  pgm.sql(`
    CREATE OR REPLACE FUNCTION prevent_physical_delete()
    RETURNS TRIGGER AS $$
    BEGIN
      IF current_setting('app.allow_physical_delete', true) = 'true' THEN
        RETURN OLD;
      END IF;
      RAISE EXCEPTION 'Physical DELETE is not allowed on table %. Use soft delete (SET deleted_at = NOW()) instead.', TG_TABLE_NAME;
      RETURN NULL;
    END;
    $$ LANGUAGE plpgsql;
  `);
};

exports.down = (pgm) => {
  pgm.sql('DROP INDEX IF EXISTS idx_access_requests_email_pending;');
  pgm.sql('DROP INDEX IF EXISTS idx_cast_users_staff_id_unique;');
  pgm.sql('DROP INDEX IF EXISTS idx_staff_master_name_unique;');
  pgm.sql(`
    ALTER TABLE projects
    ALTER COLUMN url_expires_at TYPE TIMESTAMP
    USING url_expires_at AT TIME ZONE 'UTC';
  `);
  pgm.sql(`
    CREATE OR REPLACE FUNCTION prevent_physical_delete()
    RETURNS TRIGGER AS $$
    BEGIN
      RAISE EXCEPTION 'Physical DELETE is not allowed on table %. Use soft delete (SET deleted_at = NOW()) instead.', TG_TABLE_NAME;
      RETURN NULL;
    END;
    $$ LANGUAGE plpgsql;
  `);
};
