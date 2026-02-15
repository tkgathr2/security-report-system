exports.up = async (pgm) => {
  // Already applied in production - indexes for admin projects list
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_projects_work_date ON projects (work_date)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_projects_status ON projects (status)`);
};

exports.down = async (pgm) => {
  pgm.sql(`DROP INDEX IF EXISTS idx_projects_work_date`);
  pgm.sql(`DROP INDEX IF EXISTS idx_projects_status`);
};
