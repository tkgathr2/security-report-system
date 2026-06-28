// H-CA3: Replace global UNIQUE on cast_users.email with a partial unique index
// scoped to active (non-deleted) rows. This allows soft-deleted rows to coexist
// while still preventing duplicate active registrations for the same email.
// The global constraint (cast_users_email_key) is dropped first; the partial
// index takes over enforcement for all active records.
exports.up = async (pgm) => {
  // Drop the global UNIQUE constraint added by the original create-table migration.
  // If it was already dropped by a prior migration this is a no-op.
  pgm.sql(`
    ALTER TABLE cast_users
    DROP CONSTRAINT IF EXISTS cast_users_email_key;
  `);

  // Partial unique index: only active (non-deleted) rows must have unique emails.
  pgm.sql(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_cast_users_email_active
    ON cast_users (LOWER(email))
    WHERE deleted_at IS NULL;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP INDEX IF EXISTS idx_cast_users_email_active;`);
  pgm.sql(`
    ALTER TABLE cast_users
    ADD CONSTRAINT cast_users_email_key UNIQUE (email);
  `);
};
