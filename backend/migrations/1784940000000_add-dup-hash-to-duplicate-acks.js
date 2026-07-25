// ACK の粒度を「その人のその日」から「承認した重複の中身」へ変える（2026-07-25 バグチェック指摘）。
//
// 旧仕様は UNIQUE (staff_key, work_date) だったため、一度「このままでOK」を押すと
// その人のその日は永久に通知されなかった。後日プロキャス側でシフトが変わり
// 別の現場どうしの重複が発生しても、承認済みとして黙って握り潰される。
//
// dup_hash は「その日に関係している現場名の集合」から作る（順序非依存）。
// 中身が変われば別の重複として再通知される。
exports.up = function(pgm) {
  // 既存行は空文字で埋める（NULL を混ぜると UNIQUE が効かなくなる＝NULL != NULL）
  pgm.addColumn('duplicate_acks', {
    dup_hash: {
      type: 'text',
      notNull: true,
      default: '',
    },
  });

  pgm.dropConstraint('duplicate_acks', 'duplicate_acks_staff_key_work_date_unique');

  pgm.addConstraint('duplicate_acks', 'duplicate_acks_staff_key_work_date_dup_hash_unique', {
    unique: ['staff_key', 'work_date', 'dup_hash'],
  });

  // 照会は (staff_key, work_date) の組で引いてから dup_hash を突き合わせるため、
  // 先頭2列のインデックスがあれば足りる。
  pgm.createIndex('duplicate_acks', ['staff_key', 'work_date'], {
    name: 'duplicate_acks_staff_key_work_date_idx',
    ifNotExists: true,
  });
};

exports.down = function(pgm) {
  pgm.dropIndex('duplicate_acks', ['staff_key', 'work_date'], {
    name: 'duplicate_acks_staff_key_work_date_idx',
    ifExists: true,
  });
  pgm.dropConstraint('duplicate_acks', 'duplicate_acks_staff_key_work_date_dup_hash_unique');
  pgm.addConstraint('duplicate_acks', 'duplicate_acks_staff_key_work_date_unique', {
    unique: ['staff_key', 'work_date'],
  });
  pgm.dropColumn('duplicate_acks', 'dup_hash');
};
