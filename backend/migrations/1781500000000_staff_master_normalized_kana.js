// キャストカナの表記揺れ吸収（バグチェックラボ田所High#7 / 2026-06-16）。
// staff_master の display_name_kanji / display_name_kana を突合する際、
// 半角/全角スペース除去だけでは以下が取り逃され、別レコードを量産していた:
//   - ひらがな ⇄ カタカナ（やまだ vs ヤマダ）
//   - NFC 合成形 vs NFD 分離形（"ガ" vs "カ+゛"）
//   - 長音類のゆれ（ー / － / ‐ / −）
//   - 半角カナ ⇄ 全角カナ（濁点合成含む）
//
// 同じ正規化を Node 側 (staffResolver.ts: normalizeForLookup) と PostgreSQL 側
// (この関数 normalize_kana) で実装し、テストで出力が一致することを保証する。
//
// 既存設計（同姓同名でもNo違いは別人として共存）は維持するため、normalize_kana
// に対する unique index は作成しない（identity は procast_staff_no が担う）。

exports.up = (pgm) => {
  pgm.sql(`
    CREATE OR REPLACE FUNCTION normalize_kana(input text)
    RETURNS text
    LANGUAGE sql
    IMMUTABLE
    PARALLEL SAFE
    AS $func$
      SELECT
        regexp_replace(
          regexp_replace(
            translate(
              normalize(
                translate(
                  normalize(coalesce(input, ''), NFC),
                  'ｦｧｨｩｪｫｬｭｮｯｰｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝﾞﾟ',
                  E'ヲァィゥェォャュョッーアイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワン\\u3099\\u309A'
                ),
                NFC
              ),
              'ぁあぃいぅうぇえぉおかがきぎくぐけげこごさざしじすずせぜそぞただちぢっつづてでとどなにぬねのはばぱひびぴふぶぷへべぺほぼぽまみむめもゃやゅゆょよらりるれろゎわゐゑをんゔゕゖ',
              'ァアィイゥウェエォオカガキギクグケゲコゴサザシジスズセゼソゾタダチヂッツヅテデトドナニヌネノハバパヒビピフブプヘベペホボポマミムメモャヤュユョヨラリルレロヮワヰヱヲンヴヵヶ'
            ),
            '[‐−－ー\\-]',
            'ー',
            'g'
          ),
          E'[\\s\\u3000]+',
          '',
          'g'
        );
    $func$;
  `);

  // 動作確認用のスモークテスト（migration 実行時に assert）
  pgm.sql(`
    DO $$
    BEGIN
      IF normalize_kana('やまだ　たろう') <> normalize_kana('ヤマダ タロウ') THEN
        RAISE EXCEPTION 'normalize_kana: hiragana/katakana mismatch';
      END IF;
      IF normalize_kana('ガ') <> normalize_kana(E'\\u30ab\\u3099') THEN
        RAISE EXCEPTION 'normalize_kana: NFC/NFD mismatch';
      END IF;
      IF normalize_kana('ターロウ') <> normalize_kana('タ－ロウ') THEN
        RAISE EXCEPTION 'normalize_kana: prolonged sound mismatch';
      END IF;
      IF normalize_kana('ﾔﾏﾀﾞ ﾀﾛｳ') <> normalize_kana('ヤマダ タロウ') THEN
        RAISE EXCEPTION 'normalize_kana: hankaku-kana mismatch';
      END IF;
    END $$;
  `);
};

exports.down = (pgm) => {
  pgm.sql('DROP FUNCTION IF EXISTS normalize_kana(text);');
};
