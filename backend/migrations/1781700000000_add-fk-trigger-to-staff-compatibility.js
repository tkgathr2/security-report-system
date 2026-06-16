/**
 * 管制ナレッジ補強 v1.1
 * - staff_compatibility.staff_a_id / staff_b_id に staff_master(id) への FK を追加
 *   （ON DELETE NO ACTION = 物理削除を弾く。staff_master は論理削除運用のため安全）
 * - staff_compatibility に BEFORE UPDATE trigger を追加し updated_at を自動更新
 *
 * 注意:
 *  - FK は IF NOT EXISTS が使えないので pg_constraint で存在確認してから ADD
 *  - 既存パターン同様、起動時補正(backend/src/index.ts)にも同内容の冪等ガードを並置
 */
exports.up = (pgm) => {
  // ── FK 追加（既存制約名と衝突しないよう一意名） ─────────────────────────
  pgm.sql(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'staff_compatibility_staff_a_fk'
      ) THEN
        ALTER TABLE staff_compatibility
          ADD CONSTRAINT staff_compatibility_staff_a_fk
          FOREIGN KEY (staff_a_id) REFERENCES staff_master(id);
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'staff_compatibility_staff_b_fk'
      ) THEN
        ALTER TABLE staff_compatibility
          ADD CONSTRAINT staff_compatibility_staff_b_fk
          FOREIGN KEY (staff_b_id) REFERENCES staff_master(id);
      END IF;
    END $$;
  `);

  // ── updated_at 自動更新 trigger ───────────────────────────────────────
  pgm.sql(`
    CREATE OR REPLACE FUNCTION set_staff_compatibility_updated_at()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);
  pgm.sql(`
    DROP TRIGGER IF EXISTS trg_staff_compatibility_updated_at ON staff_compatibility;
    CREATE TRIGGER trg_staff_compatibility_updated_at
      BEFORE UPDATE ON staff_compatibility
      FOR EACH ROW EXECUTE FUNCTION set_staff_compatibility_updated_at();
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TRIGGER IF EXISTS trg_staff_compatibility_updated_at ON staff_compatibility;`);
  pgm.sql(`DROP FUNCTION IF EXISTS set_staff_compatibility_updated_at();`);
  pgm.sql(`
    ALTER TABLE staff_compatibility
      DROP CONSTRAINT IF EXISTS staff_compatibility_staff_a_fk,
      DROP CONSTRAINT IF EXISTS staff_compatibility_staff_b_fk;
  `);
};
