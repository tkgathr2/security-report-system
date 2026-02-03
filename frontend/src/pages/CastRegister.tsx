import { useState } from 'react';
import './Cast.css';

const API_BASE = import.meta.env.VITE_API_URL || '';

export default function CastRegister() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setMessage('');

    try {
      const res = await fetch(`${API_BASE}/api/cast/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (data.redirect) {
          window.location.href = data.redirect;
          return;
        }
        throw new Error(data.message || '登録に失敗しました');
      }

      setMessage(data.message);
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : '登録に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  if (sent) {
    return (
      <div className="cast-container">
        <div className="cast-card">
          <div className="cast-logo">ほうこちゃん</div>
          <h1>メールを確認してください</h1>
          <p className="cast-message success">
            {email} に確認メールを送信しました。<br />
            メール内のリンクをクリックして登録を完了してください。
          </p>
          <button 
            className="cast-button secondary"
            onClick={() => { setSent(false); setEmail(''); }}
          >
            別のメールアドレスで登録
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="cast-container">
      <div className="cast-card">
        <div className="cast-logo">ほうこちゃん</div>
        <h1>スタッフ登録</h1>
        <p className="cast-subtitle">メールアドレスを入力してください</p>

        <form onSubmit={handleSubmit}>
          <div className="cast-input-group">
            <label htmlFor="email">メールアドレス</label>
            <input
              type="email"
              id="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="example@email.com"
              required
              disabled={loading}
            />
          </div>

          {error && <p className="cast-message error">{error}</p>}
          {message && <p className="cast-message success">{message}</p>}

          <button type="submit" className="cast-button" disabled={loading}>
            {loading ? '送信中...' : '確認メールを送信'}
          </button>
        </form>

        <div className="cast-links">
          <a href="/cast/login">既にアカウントをお持ちの方はこちら</a>
        </div>
      </div>
    </div>
  );
}
