import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './Cast.css';

const API_BASE = import.meta.env.VITE_API_URL || '';

export default function CastMailHelp() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ registered: boolean; message: string } | null>(null);
  const [pin, setPin] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState('');

  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setResult(null);

    if (!emailRegex.test(email.trim())) {
      setError('正しいメールアドレスを入力してください');
      setLoading(false);
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/api/cast/mail-help`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.message || 'エラーが発生しました');
      }

      setResult({ registered: data.registered, message: data.message });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'エラーが発生しました');
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginLoading(true);
    setLoginError('');

    try {
      const res = await fetch(`${API_BASE}/api/cast/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), pin }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.message || 'ログインに失敗しました');
      }

      localStorage.setItem('castToken', data.token);
      localStorage.setItem('castUser', JSON.stringify(data.user));
      navigate('/cast/today');
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : 'ログインに失敗しました');
    } finally {
      setLoginLoading(false);
    }
  };

  if (result && !result.registered) {
    return (
      <div className="cast-container">
        <div className="cast-card">
          <div className="cast-logo">デジタル警備報告書システム<br />【ほうこちゃん】</div>
          <h1>メールを確認して下さい</h1>
          <p className="cast-message success">
            {result.message}
          </p>
          <p style={{ color: '#333', fontSize: '15px', lineHeight: 1.8, textAlign: 'center', margin: '20px 0' }}>
            <strong>{email}</strong> にメールを送りました。<br />
            メール内のリンクから登録を続けて下さい。
          </p>
          <div className="cast-links">
            <a href="/cast/register">スタッフ登録に戻る</a>
          </div>
        </div>
      </div>
    );
  }

  if (result && result.registered) {
    return (
      <div className="cast-container">
        <div className="cast-card">
          <div className="cast-logo">デジタル警備報告書システム<br />【ほうこちゃん】</div>
          <h1>ログインして下さい</h1>
          <p className="cast-message success">
            {result.message}
          </p>

          <form onSubmit={handleLogin}>
            <div className="cast-input-group">
              <label htmlFor="login-email">メールアドレス</label>
              <input
                type="email"
                id="login-email"
                value={email}
                readOnly
                style={{ background: '#f5f5f5' }}
              />
            </div>

            <div className="cast-input-group">
              <label htmlFor="login-pin">暗証番号</label>
              <input
                type="password"
                id="login-pin"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                placeholder="••••"
                inputMode="numeric"
                pattern="\d{4}"
                maxLength={4}
                required
                disabled={loginLoading}
                autoFocus
              />
            </div>

            {loginError && <p className="cast-message error">{loginError}</p>}

            <button type="submit" className="cast-button" disabled={loginLoading}>
              {loginLoading ? 'ログイン中...' : 'ログイン'}
            </button>
          </form>

          <div className="cast-links">
            <a href="/cast/reset-pin">暗証番号を忘れた方はこちら</a>
            <a href="/cast/register">スタッフ登録に戻る</a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="cast-container">
      <div className="cast-card">
        <div className="cast-logo">デジタル警備報告書システム<br />【ほうこちゃん】</div>
        <h1>メールアドレスで確認</h1>
        <p className="cast-subtitle">メールアドレスを入力して下さい</p>

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
              autoFocus
            />
          </div>

          {error && <p className="cast-message error">{error}</p>}

          <button type="submit" className="cast-button" disabled={loading}>
            {loading ? '確認中...' : '確認する'}
          </button>
        </form>

        <div className="cast-links">
          <a href="/cast/register">スタッフ登録に戻る</a>
        </div>
      </div>
    </div>
  );
}
