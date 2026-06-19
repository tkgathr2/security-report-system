/**
 * 管制ナレッジ v1.0
 * - staff_master に solo_ok / night_ok / control_note を追加
 * - 相性ペア管理テーブル staff_compatibility を新設
 *
 * 注意:
 *  - 範囲型は一切使わない（型不一致デプロイ全断の過去事例に従い単純型のみ）
 *  - UUID デフォルトは既存 migration に合わせ gen_random_uuid() を使う
 */
exports.up = (pgm) => {
  // ── staff_master への列追加 ──────────────────────────────────────────────
  // IF NOT EXISTS を使って冪等にする（既にカラムが存在する環境でも安全に実行可能）
  pgm.sql(`ALTER TABLE staff_master ADD COLUMN IF NOT EXISTS solo_ok BOOLEAN NOT NULL DEFAULT false`);
  pgm.sql(`ALTER TABLE staff_master ADD COLUMN IF NOT EXISTS night_ok BOOLEAN NOT NULL DEFAULT true`);
  pgm.sql(`ALTER TABLE staff_master ADD COLUMN IF NOT EXISTS control_note TEXT DEFAULT NULL`);

  // ── staff_compatibility テーブル新設（IF NOT EXISTS で冪等化）───────────
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS staff_compatibility (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      staff_a_id UUID NOT NULL,
      staff_b_id UUID NOT NULL,
      kind TEXT NOT NULL,
      note TEXT DEFAULT NULL,
      created_by TEXT DEFAULT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      deleted_at TIMESTAMPTZ DEFAULT NULL
    )
  `);

  // a != b 制約（既存なら無視）
  pgm.sql(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'staff_compatibility_no_self'
      ) THEN
        ALTER TABLE staff_compatibility ADD CONSTRAINT staff_compatibility_no_self CHECK (staff_a_id <> staff_b_id);
      END IF;
    END $$
  `);

  // 論理削除を除いた同ペア+kind の重複防止（partial unique index・既存なら無視）
  pgm.sql(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_compatibility_pair_kind_active
      ON staff_compatibility (staff_a_id, staff_b_id, kind)
      WHERE deleted_at IS NULL
  `);
};

exports.down = (pgm) => {
  pgm.dropIndex('staff_compatibility', ['staff_a_id', 'staff_b_id', 'kind'], {
    name: 'idx_staff_compatibility_pair_kind_active',
    ifExists: true,
  });
  pgm.dropTable('staff_compatibility');
  pgm.dropColumns('staff_master', ['solo_ok', 'night_ok', 'control_note']);
};
