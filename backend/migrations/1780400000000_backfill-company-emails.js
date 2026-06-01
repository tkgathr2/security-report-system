/**
 * メール通知先の一本化（段1: バックフィル）
 *
 * 会社(clients)のメールは歴史的に3系統に散らばっている:
 *   ① clients.contact_email（単一カラム・後付け・現在は最後のフォールバック）
 *   ①' clients.emails text[]（配列・旧経路の主送信先）
 *   ②  company_emails テーブル（新通知先・複数・送信ログ/冪等性あり）
 *
 * 将来 ② に一本化するため、まず ①・①' の既存アドレスを ② company_emails へ
 * 非破壊・冪等にバックフィルする。
 *
 * 安全性:
 * - 既存の company_emails には触れない（追加のみ）。
 * - 部分ユニークインデックス (company_id, email) WHERE deleted_at IS NULL に対し
 *   ON CONFLICT DO NOTHING で重複を吸収（再実行しても二重登録されない）。
 * - 送信は一切発生しない（フィーチャーフラグ email_notification_enabled とは無関係）。
 * - 移行行は label='legacy-import' で識別できるようにし、down で除去できるようにする。
 *
 * 正規化: 既存 contact_email は admin.ts で trim+lowercase 正規化されているため、
 * ここでも btrim + lower で揃える。空文字・NULL・形式不正（@と.を含まない）は除外。
 */
const LEGACY_LABEL = 'legacy-import';

exports.up = (pgm) => {
  pgm.sql(`
    INSERT INTO company_emails (company_id, email, label, is_active)
    SELECT c.id,
           lower(btrim(src.email)) AS email,
           '${LEGACY_LABEL}' AS label,
           true AS is_active
    FROM clients c
    CROSS JOIN LATERAL (
      SELECT unnest(c.emails) AS email
      UNION
      SELECT c.contact_email AS email
    ) src
    WHERE c.deleted_at IS NULL
      AND src.email IS NOT NULL
      AND btrim(src.email) <> ''
      AND position('@' IN btrim(src.email)) > 1
      AND btrim(src.email) LIKE '%@%.%'
    ON CONFLICT (company_id, email) WHERE deleted_at IS NULL DO NOTHING;
  `);
};

exports.down = (pgm) => {
  // 移行で投入した行のみ除去（手動登録分は残す）。
  pgm.sql(`DELETE FROM company_emails WHERE label = '${LEGACY_LABEL}';`);
};
