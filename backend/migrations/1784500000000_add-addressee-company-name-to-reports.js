/**
 * 御中宛先（元請け会社名）を現場ごとに手入力できるようにするためのカラム。
 * 未入力時はPDF生成時にpartner_company_nameへフォールバックする。
 */
exports.up = (pgm) => {
  pgm.addColumn('reports', {
    addressee_company_name: {
      type: 'text',
      notNull: false,
      default: null,
      comment: '御中宛先（元請け会社名）。未入力ならpartner_company_nameを使用',
    },
  });
};

exports.down = (pgm) => {
  pgm.dropColumn('reports', 'addressee_company_name');
};
