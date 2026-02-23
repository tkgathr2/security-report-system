import './Cast.css';

export default function CastMailHelp() {
  const mailtoUrl = `mailto:register@nihon-kotsu-yudo.co.jp?subject=${encodeURIComponent('メールアドレス登録')}&body=${encodeURIComponent('このまま送って下さい')}`;

  return (
    <div className="cast-container">
      <div className="cast-card">
        <div className="cast-logo">デジタル警備報告書システム【ほうこちゃん】</div>
        <h1>メールで登録</h1>

        <p style={{ color: '#333', fontSize: '15px', lineHeight: 1.8, margin: '20px 0' }}>
          下記を押すとメールが起動するので<br />
          <strong>そのまま何もせず送って下さい</strong>
        </p>

        <a href={mailtoUrl} className="cast-button" style={{ marginBottom: '20px' }}>
          メールを起動する
        </a>

        <p style={{ color: '#333', fontSize: '15px', lineHeight: 1.8, margin: '20px 0' }}>
          メールが届くので登録を続けて下さい
        </p>

        <div className="cast-links">
          <a href="/cast/register">スタッフ登録に戻る</a>
        </div>
      </div>
    </div>
  );
}
