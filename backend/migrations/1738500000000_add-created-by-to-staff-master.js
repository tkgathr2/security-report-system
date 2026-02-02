exports.up = (pgm) => {
  pgm.addColumn('staff_master', {
    created_by: { type: 'text', notNull: false }
  });

  // カナ氏名にUNIQUE制約を追加（同一人物判定キー）
  pgm.addConstraint('staff_master', 'staff_master_display_name_kana_unique', {
    unique: 'display_name_kana'
  });
};

exports.down = (pgm) => {
  pgm.dropConstraint('staff_master', 'staff_master_display_name_kana_unique');
  pgm.dropColumn('staff_master', 'created_by');
};
