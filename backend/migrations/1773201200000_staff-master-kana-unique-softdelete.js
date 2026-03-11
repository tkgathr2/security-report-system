exports.up = (pgm) => {
  pgm.sql(
    "ALTER TABLE staff_master DROP CONSTRAINT IF EXISTS staff_master_display_name_kana_unique;"
  );

  pgm.sql(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_master_display_name_kana_not_deleted ON staff_master (display_name_kana) WHERE deleted_at IS NULL;"
  );
};

exports.down = (pgm) => {
  pgm.sql(
    'DROP INDEX IF EXISTS idx_staff_master_display_name_kana_not_deleted;'
  );

  pgm.addConstraint('staff_master', 'staff_master_display_name_kana_unique', {
    unique: 'display_name_kana'
  });
};
