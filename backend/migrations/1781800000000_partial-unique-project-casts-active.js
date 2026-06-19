/**
 * project_casts の UNIQUE(project_id, staff_no) を partial unique に変える。
 *
 * 背景: PR #475 の D&D 配置編集で削除→再 assign が
 *  duplicate key value violates unique constraint で 500 になっていた。
 *  原因: project_casts は soft delete（deleted_at で UPDATE）だが、UNIQUE 制約は
 *  deleted_at を見ない＝既に解除された row と新しい assign が衝突する。
 *
 * 対策: 既存の制約を落とし、deleted_at IS NULL でフィルタする partial unique index へ。
 *  active な assignment だけが UNIQUE になり、soft-deleted は対象外になる。
 */
exports.up = (pgm) => {
  pgm.dropConstraint('project_casts', 'project_casts_project_id_staff_no_unique', { ifExists: true });
  // IF NOT EXISTS で冪等化（既にインデックスが存在する環境でも安全に実行可能）
  pgm.sql(`
    CREATE UNIQUE INDEX IF NOT EXISTS project_casts_project_id_staff_no_active_unique
      ON project_casts (project_id, staff_no)
      WHERE deleted_at IS NULL
  `);
};

exports.down = (pgm) => {
  pgm.dropIndex('project_casts', ['project_id', 'staff_no'], {
    name: 'project_casts_project_id_staff_no_active_unique',
    ifExists: true,
  });
  pgm.addConstraint('project_casts', 'project_casts_project_id_staff_no_unique', {
    unique: ['project_id', 'staff_no'],
  });
};
