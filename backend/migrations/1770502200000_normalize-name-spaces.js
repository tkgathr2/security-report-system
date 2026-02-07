exports.up = async (pgm) => {
  // Update staff_master: convert full-width spaces to half-width in display_name_kanji and display_name_kana
  await pgm.sql(`
    UPDATE staff_master 
    SET 
      display_name_kanji = TRIM(REGEXP_REPLACE(REPLACE(display_name_kanji, '　', ' '), '\\s+', ' ', 'g')),
      display_name_kana = TRIM(REGEXP_REPLACE(REPLACE(display_name_kana, '　', ' '), '\\s+', ' ', 'g')),
      updated_at = CURRENT_TIMESTAMP
    WHERE display_name_kanji LIKE '%　%' 
       OR display_name_kana LIKE '%　%'
       OR display_name_kanji ~ '\\s{2,}'
       OR display_name_kana ~ '\\s{2,}'
  `);

  // Update cast_users: convert full-width spaces to half-width in selected_name_kanji
  await pgm.sql(`
    UPDATE cast_users 
    SET 
      selected_name_kanji = TRIM(REGEXP_REPLACE(REPLACE(selected_name_kanji, '　', ' '), '\\s+', ' ', 'g')),
      updated_at = CURRENT_TIMESTAMP
    WHERE selected_name_kanji LIKE '%　%'
       OR selected_name_kanji ~ '\\s{2,}'
  `);

  // Update project_casts: convert full-width spaces to half-width in cast_name
  await pgm.sql(`
    UPDATE project_casts 
    SET 
      cast_name = TRIM(REGEXP_REPLACE(REPLACE(cast_name, '　', ' '), '\\s+', ' ', 'g'))
    WHERE cast_name LIKE '%　%'
       OR cast_name ~ '\\s{2,}'
  `);
};

exports.down = async () => {
  // This migration cannot be reversed as we don't know the original spacing
};
