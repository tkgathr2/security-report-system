import './Cast.css';
import './CastHelpInstall.css';

export default function CastHelpInstall() {
  return (
    <div className="cast-container">
      <div className="cast-card wide">
        <div className="cast-logo">デジタル警備報告書システム<br />【ほうこちゃん】</div>

        <h1>ホーム画面への追加方法</h1>
        <p className="cast-subtitle">
          ホーム画面に追加すると、アプリのようにワンタップで今日の現場を確認できます。
        </p>

        <div className="install-section">
          <h2 className="install-section-title">iPhone（Safari）の場合</h2>

          <div className="install-step">
            <div className="install-step-number">1</div>
            <div className="install-step-content">
              <p className="install-step-text">
                <strong>Safari</strong>でこのサイトを開きます。
              </p>
              <div className="install-step-url">
                https://security-report.up.railway.app/cast/today
              </div>
              <p className="install-step-note">
                ※ Chrome や LINE のブラウザでは「ホームに追加」が表示されません。必ず <strong>Safari</strong> を使ってください。
              </p>
            </div>
          </div>

          <div className="install-step">
            <div className="install-step-number">2</div>
            <div className="install-step-content">
              <p className="install-step-text">
                画面下部の <strong>共有ボタン</strong>（□に↑のマーク）をタップします。
              </p>
              <div className="install-step-icon-hint">
                <span className="install-share-icon">&#x2B06;&#xFE0F;</span>
                <span>Safari画面の下にある四角に上矢印のボタン</span>
              </div>
            </div>
          </div>

          <div className="install-step">
            <div className="install-step-number">3</div>
            <div className="install-step-content">
              <p className="install-step-text">
                メニューをスクロールして<strong>「ホーム画面に追加」</strong>をタップします。
              </p>
            </div>
          </div>

          <div className="install-step">
            <div className="install-step-number">4</div>
            <div className="install-step-content">
              <p className="install-step-text">
                名前はそのまま（「ほうこちゃん」）で、右上の<strong>「追加」</strong>をタップします。
              </p>
            </div>
          </div>

          <div className="install-step">
            <div className="install-step-number done">✓</div>
            <div className="install-step-content">
              <p className="install-step-text">
                ホーム画面にアイコンが追加されます。<br />
                タップするだけで今日の現場が表示されます！
              </p>
            </div>
          </div>
        </div>

        <div className="install-section">
          <h2 className="install-section-title">Android（Chrome）の場合</h2>

          <div className="install-step">
            <div className="install-step-number">1</div>
            <div className="install-step-content">
              <p className="install-step-text">
                <strong>Chrome</strong>でこのサイトを開きます。
              </p>
              <div className="install-step-url">
                https://security-report.up.railway.app/cast/today
              </div>
            </div>
          </div>

          <div className="install-step">
            <div className="install-step-number">2</div>
            <div className="install-step-content">
              <p className="install-step-text">
                画面右上の<strong>「︙」</strong>（メニュー）をタップします。
              </p>
            </div>
          </div>

          <div className="install-step">
            <div className="install-step-number">3</div>
            <div className="install-step-content">
              <p className="install-step-text">
                <strong>「ホーム画面に追加」</strong>または<strong>「アプリをインストール」</strong>をタップします。
              </p>
            </div>
          </div>

          <div className="install-step">
            <div className="install-step-number done">✓</div>
            <div className="install-step-content">
              <p className="install-step-text">
                ホーム画面にアイコンが追加されます！
              </p>
            </div>
          </div>
        </div>

        <div className="install-section">
          <h2 className="install-section-title">ブックマークの場合</h2>
          <p className="install-note">
            ホーム画面に追加できない場合は、以下のURLをブックマークしてください。
          </p>
          <div className="install-step-url" style={{ marginBottom: '16px' }}>
            https://security-report.up.railway.app/cast/today
          </div>
          <p className="install-note">
            ログイン済みであれば、このURLを開くだけで今日の現場が表示されます。
          </p>
        </div>

        <a href="/cast/today" className="cast-button" style={{ marginTop: '24px' }}>
          今日の現場に戻る
        </a>
      </div>
    </div>
  );
}
