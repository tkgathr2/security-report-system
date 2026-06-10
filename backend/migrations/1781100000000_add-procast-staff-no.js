// プロキャストのスタッフNoをキャスト台帳(staff_master)の一意キーに昇格させる。
// 背景: これまで取込・登録の突合キーが「名前(漢字/カナ)」しかなく、同姓同名の別人を
// 区別できなかった（同一レコードに吸収）。プロキャストCSVのスタッフNo.(B列)を
// staff_master に保持し、名前に依存しない照合を可能にする。
// 同時に kana のユニークindexを廃止し、同姓同名の別人レコードの共存を許す
// （手動登録の重複ガードはアプリ側チェックで維持）。

exports.up = (pgm) => {
  pgm.sql('ALTER TABLE staff_master ADD COLUMN IF NOT EXISTS procast_staff_no TEXT;');

  pgm.sql(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_master_procast_staff_no_not_deleted
     ON staff_master (procast_staff_no)
     WHERE deleted_at IS NULL AND procast_staff_no IS NOT NULL;`
  );

  // 既存データのバックフィル: project_casts の (staff_no, staff_id) 対応のうち
  // 1:1 が確定するものだけ staff_master.procast_staff_no に書き込む。
  // - staff_no = cast_name の行は除外（旧データでスタッフNo欄に名前が入っているフォールバック）
  // - 1人のstaffに複数Noが付く/1つのNoが複数staffに付く曖昧ケースは触らない（以後の取込で解決）
  pgm.sql(
    `WITH pairs AS (
       SELECT DISTINCT pc.staff_no, pc.staff_id
       FROM project_casts pc
       WHERE pc.staff_id IS NOT NULL
         AND pc.staff_no IS NOT NULL
         AND pc.staff_no <> ''
         AND pc.staff_no <> pc.cast_name
         AND pc.deleted_at IS NULL
     ),
     unambiguous AS (
       SELECT staff_no, MIN(staff_id::text)::uuid AS staff_id
       FROM pairs
       GROUP BY staff_no
       HAVING COUNT(DISTINCT staff_id) = 1
     ),
     single_no AS (
       SELECT u.staff_no, u.staff_id
       FROM unambiguous u
       JOIN pairs p ON p.staff_id = u.staff_id
       GROUP BY u.staff_no, u.staff_id
       HAVING COUNT(DISTINCT p.staff_no) = 1
     )
     UPDATE staff_master sm
     SET procast_staff_no = s.staff_no, updated_at = CURRENT_TIMESTAMP
     FROM single_no s
     WHERE sm.id = s.staff_id
       AND sm.procast_staff_no IS NULL
       AND sm.deleted_at IS NULL;`
  );

  // 同姓同名の別人を登録可能にするため、カナ名のユニークindexを廃止。
  pgm.sql('DROP INDEX IF EXISTS idx_staff_master_display_name_kana_not_deleted;');
};

exports.down = (pgm) => {
  pgm.sql(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_master_display_name_kana_not_deleted
     ON staff_master (display_name_kana) WHERE deleted_at IS NULL;`
  );
  pgm.sql('DROP INDEX IF EXISTS idx_staff_master_procast_staff_no_not_deleted;');
  pgm.sql('ALTER TABLE staff_master DROP COLUMN IF EXISTS procast_staff_no;');
};
