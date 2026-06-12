// スタッフNoキー化(1781100000000)の取りこぼし修正。
// 旧複合ユニークindex idx_staff_master_name_unique (display_name_kanji, display_name_kana)
// が残存しており、同姓同名（または既存レコードと別Noの同名）の新規作成が23505で弾かれ、
// CSV取込のトランザクション全体が中断していた（2026-06-12 西村さん報告・本番/versionで実証）。
// 識別は procast_staff_no が担うため、名前系のユニークindexはすべて廃止する。

exports.up = (pgm) => {
  pgm.sql('DROP INDEX IF EXISTS idx_staff_master_name_unique;');
};

exports.down = (pgm) => {
  pgm.sql(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_master_name_unique
     ON staff_master (display_name_kanji, display_name_kana)
     WHERE deleted_at IS NULL;`
  );
};
