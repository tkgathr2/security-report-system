exports.up = async (pgm) => {
  // ============================================================
  // Phase 1: cast_users - Consolidate staff_id / selected_staff_id
  // ============================================================

  // Copy selected_staff_id → staff_id where staff_id is NULL
  pgm.sql(`
    UPDATE cast_users
    SET staff_id = selected_staff_id
    WHERE staff_id IS NULL AND selected_staff_id IS NOT NULL
  `);

  // For cast_users with name but no staff_id, create staff_master entries
  pgm.sql(`
    INSERT INTO staff_master (display_name_kanji, display_name_kana, created_at, updated_at, created_by)
    SELECT cu.name, cu.name, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'data-normalization'
    FROM cast_users cu
    WHERE cu.staff_id IS NULL
      AND cu.name IS NOT NULL AND cu.name != ''
      AND NOT EXISTS (
        SELECT 1 FROM staff_master sm
        WHERE REPLACE(REPLACE(sm.display_name_kanji, ' ', ''), E'\\u3000', '')
            = REPLACE(REPLACE(cu.name, ' ', ''), E'\\u3000', '')
      )
  `);

  // Link those cast_users to newly created staff_master entries
  pgm.sql(`
    UPDATE cast_users cu
    SET staff_id = sm.id
    FROM staff_master sm
    WHERE cu.staff_id IS NULL
      AND cu.name IS NOT NULL AND cu.name != ''
      AND REPLACE(REPLACE(sm.display_name_kanji, ' ', ''), E'\\u3000', '')
        = REPLACE(REPLACE(cu.name, ' ', ''), E'\\u3000', '')
  `);

  // Drop redundant columns from cast_users
  pgm.dropColumn('cast_users', 'name');
  pgm.dropColumn('cast_users', 'selected_name_kanji');
  pgm.dropColumn('cast_users', 'selected_staff_id');

  // ============================================================
  // Phase 2: project_casts - Add staff_id FK, remove cast_name
  // ============================================================

  pgm.addColumn('project_casts', {
    staff_id: { type: 'uuid', references: '"staff_master"', onDelete: 'SET NULL' }
  });

  // Populate staff_id from staff_master matching by name (space-normalized)
  pgm.sql(`
    UPDATE project_casts pc
    SET staff_id = sm.id
    FROM staff_master sm
    WHERE REPLACE(REPLACE(pc.cast_name, ' ', ''), E'\\u3000', '')
        = REPLACE(REPLACE(sm.display_name_kanji, ' ', ''), E'\\u3000', '')
  `);

  // Create staff_master entries for unmatched project_casts
  pgm.sql(`
    INSERT INTO staff_master (display_name_kanji, display_name_kana, created_at, updated_at, created_by)
    SELECT DISTINCT pc.cast_name, pc.cast_name, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'data-normalization'
    FROM project_casts pc
    WHERE pc.staff_id IS NULL
      AND pc.cast_name IS NOT NULL AND pc.cast_name != ''
      AND NOT EXISTS (
        SELECT 1 FROM staff_master sm
        WHERE REPLACE(REPLACE(sm.display_name_kanji, ' ', ''), E'\\u3000', '')
            = REPLACE(REPLACE(pc.cast_name, ' ', ''), E'\\u3000', '')
      )
  `);

  // Re-link after creating new entries
  pgm.sql(`
    UPDATE project_casts pc
    SET staff_id = sm.id
    FROM staff_master sm
    WHERE pc.staff_id IS NULL
      AND pc.cast_name IS NOT NULL
      AND REPLACE(REPLACE(pc.cast_name, ' ', ''), E'\\u3000', '')
        = REPLACE(REPLACE(sm.display_name_kanji, ' ', ''), E'\\u3000', '')
  `);

  // Drop cast_name
  pgm.dropColumn('project_casts', 'cast_name');

  // ============================================================
  // Phase 3: projects - Ensure all have client_id, remove client_name_raw
  // ============================================================

  // Create client entries for unmatched projects
  pgm.sql(`
    INSERT INTO clients (name, name_normalized, emails, is_active)
    SELECT DISTINCT p.client_name_raw,
           LOWER(REGEXP_REPLACE(
             REGEXP_REPLACE(
               REGEXP_REPLACE(p.client_name_raw, '[（）()]', '', 'g'),
             '[\\s　]+', '', 'g'),
           '株式会社|有限会社|合同会社', '', 'g')),
           '{}'::text[],
           true
    FROM projects p
    WHERE p.client_id IS NULL
      AND p.client_name_raw IS NOT NULL AND p.client_name_raw != ''
      AND NOT EXISTS (
        SELECT 1 FROM clients c WHERE c.name = p.client_name_raw
      )
    ON CONFLICT (name_normalized) DO NOTHING
  `);

  // Link projects to clients by exact name match
  pgm.sql(`
    UPDATE projects p
    SET client_id = c.id
    FROM clients c
    WHERE c.name = p.client_name_raw AND p.client_id IS NULL
  `);

  // Link remaining by normalized name
  pgm.sql(`
    UPDATE projects p
    SET client_id = c.id
    FROM clients c
    WHERE p.client_id IS NULL
      AND p.client_name_raw IS NOT NULL
      AND c.name_normalized = LOWER(REGEXP_REPLACE(
        REGEXP_REPLACE(
          REGEXP_REPLACE(p.client_name_raw, '[（）()]', '', 'g'),
        '[\\s　]+', '', 'g'),
      '株式会社|有限会社|合同会社', '', 'g'))
  `);

  // Drop client_name_raw
  pgm.dropColumn('projects', 'client_name_raw');

  // ============================================================
  // Phase 4: reports - Add writer_staff_id FK, remove writer_name
  // ============================================================

  pgm.addColumn('reports', {
    writer_staff_id: { type: 'uuid', references: '"staff_master"', onDelete: 'SET NULL' }
  });

  // Populate writer_staff_id from cast_users
  pgm.sql(`
    UPDATE reports r
    SET writer_staff_id = cu.staff_id
    FROM cast_users cu
    WHERE r.cast_user_id = cu.id AND cu.staff_id IS NOT NULL
  `);

  // Drop writer_name
  pgm.dropColumn('reports', 'writer_name');
};

exports.down = async (pgm) => {
  // Re-add dropped columns
  pgm.addColumn('cast_users', {
    name: { type: 'text' },
    selected_name_kanji: { type: 'text' },
    selected_staff_id: { type: 'uuid', references: '"staff_master"', onDelete: 'SET NULL' }
  });
  pgm.addColumn('project_casts', {
    cast_name: { type: 'text' }
  });
  pgm.addColumn('projects', {
    client_name_raw: { type: 'text' }
  });
  pgm.addColumn('reports', {
    writer_name: { type: 'text' }
  });

  // Restore data from referenced tables
  pgm.sql(`
    UPDATE cast_users cu
    SET name = sm.display_name_kanji,
        selected_name_kanji = sm.display_name_kanji,
        selected_staff_id = cu.staff_id
    FROM staff_master sm WHERE cu.staff_id = sm.id
  `);
  pgm.sql(`
    UPDATE project_casts pc
    SET cast_name = sm.display_name_kanji
    FROM staff_master sm WHERE pc.staff_id = sm.id
  `);
  pgm.sql(`
    UPDATE projects p
    SET client_name_raw = c.name
    FROM clients c WHERE p.client_id = c.id
  `);
  pgm.sql(`
    UPDATE reports r
    SET writer_name = sm.display_name_kanji
    FROM staff_master sm WHERE r.writer_staff_id = sm.id
  `);

  // Drop new columns
  pgm.dropColumn('reports', 'writer_staff_id');
  pgm.dropColumn('project_casts', 'staff_id');
};
