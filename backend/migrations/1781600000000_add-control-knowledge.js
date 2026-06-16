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
  pgm.addColumns('staff_master', {
    solo_ok: {
      type: 'boolean',
      notNull: true,
      default: false,
    },
    night_ok: {
      type: 'boolean',
      notNull: true,
      default: true,
    },
    control_note: {
      type: 'text',
      notNull: false,
      default: null,
    },
  });

  // ── staff_compatibility テーブル新設 ─────────────────────────────────────
  pgm.createTable('staff_compatibility', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    staff_a_id: {
      type: 'uuid',
      notNull: true,
    },
    staff_b_id: {
      type: 'uuid',
      notNull: true,
    },
    kind: {
      type: 'text',
      notNull: true,
    },
    note: {
      type: 'text',
      notNull: false,
      default: null,
    },
    created_by: {
      type: 'text',
      notNull: false,
      default: null,
    },
    created_at: {
      type: 'timestamptz',
      default: pgm.func('NOW()'),
    },
    updated_at: {
      type: 'timestamptz',
      default: pgm.func('NOW()'),
    },
    deleted_at: {
      type: 'timestamptz',
      notNull: false,
      default: null,
    },
  });

  // a != b 制約
  pgm.addConstraint('staff_compatibility', 'staff_compatibility_no_self', {
    check: 'staff_a_id <> staff_b_id',
  });

  // 論理削除を除いた同ペア+kind の重複防止（partial unique index）
  pgm.createIndex('staff_compatibility', ['staff_a_id', 'staff_b_id', 'kind'], {
    name: 'idx_staff_compatibility_pair_kind_active',
    unique: true,
    where: 'deleted_at IS NULL',
  });
};

exports.down = (pgm) => {
  pgm.dropIndex('staff_compatibility', ['staff_a_id', 'staff_b_id', 'kind'], {
    name: 'idx_staff_compatibility_pair_kind_active',
    ifExists: true,
  });
  pgm.dropTable('staff_compatibility');
  pgm.dropColumns('staff_master', ['solo_ok', 'night_ok', 'control_note']);
};
