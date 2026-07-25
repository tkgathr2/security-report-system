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

  // この UNIQUE が作る索引は先頭2列 (staff_key, work_date) の検索にも使えるため、
  // 照会用の通常インデックスは別に作らない（作ると索引が二重化して
  // ACK insert ごとに無駄な書き込みが増える）。
  pgm.addConstraint('duplicate_acks', 'duplicate_acks_staff_key_work_date_dup_hash_unique', {
    unique: ['staff_key', 'work_date', 'dup_hash'],
  });
};

exports.down = function(pgm) {
  pgm.dropConstraint('duplicate_acks', 'duplicate_acks_staff_key_work_date_dup_hash_unique');
  pgm.addConstraint('duplicate_acks', 'duplicate_acks_staff_key_work_date_unique', {
    unique: ['staff_key', 'work_date'],
  });
  pgm.dropColumn('duplicate_acks', 'dup_hash');
};
