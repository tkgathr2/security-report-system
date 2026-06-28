/**
 * clients の UNIQUE(name_normalized) を partial unique に変える。
 *
 * 背景: プロキャス自動同期(CSV取込)で、過去にソフト削除した同名 client が
 *  非partialの UNIQUE(name_normalized) スロットを占有していると、新規 client の
 *  INSERT ... ON CONFLICT DO NOTHING が衝突して 0 行になり、retry SELECT も
 *  deleted_at IS NULL 限定のため死んだ行を引けず clientId=null になる。
 *  結果「クライアントIDが取得できませんでした」で毎回同じ行(行82/83)が落ちていた。
 *  原因: clients は soft delete(deleted_at)だが UNIQUE 制約が deleted_at を見ない。
 *  PR #480 (1781800000000 project_casts) と同じ問題の clients 版取り残し。
 *
 * 対策: 既存の制約を落とし、deleted_at IS NULL でフィルタする partial unique index へ。
 *  生きている client だけが UNIQUE になり、soft-deleted は対象外＝新規作成が通る。
 *  ※本番DB事前確認で deleted_at IS NULL の name_normalized 重複=0 を確認済み(安全に作成可)。
 */
exports.up = (pgm) => {
  pgm.dropConstraint('clients', 'clients_name_normalized_key', { ifExists: true });
  // IF NOT EXISTS で冪等化（既にインデックスが存在する環境でも安全に実行可能）
  pgm.sql(`
    CREATE UNIQUE INDEX IF NOT EXISTS clients_name_normalized_active_unique
      ON clients (name_normalized)
      WHERE deleted_at IS NULL
  `);
};

exports.down = (pgm) => {
  pgm.dropIndex('clients', ['name_normalized'], {
    name: 'clients_name_normalized_active_unique',
    ifExists: true,
  });
  pgm.addConstraint('clients', 'clients_name_normalized_key', {
    unique: ['name_normalized'],
  });
};
