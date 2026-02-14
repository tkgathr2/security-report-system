import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import './Cast.css';

const API_BASE = import.meta.env.VITE_API_URL || '';

export default function CastLogin() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showMagicLink, setShowMagicLink] = useState(false);
  const [magicLinkSent, setMagicLinkSent] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem('castToken');
    if (token) {
      navigate('/cast/today');
    }
  }, [navigate]);

  const handleCtrlEnter = useCallback((e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      const form = document.querySelector('form') as HTMLFormElement | null;
      if (form) form.requestSubmit();
    }
  }, []);

  useEffect(() => {
    document.addEventListener('keydown', handleCtrlEnter);
    return () => document.removeEventListener('keydown', handleCtrlEnter);
  }, [handleCtrlEnter]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const res = await fetch(`${API_BASE}/api/cast/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, pin }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (data.redirect) {
          window.location.href = data.redirect;
          return;
        }
        throw new Error(data.message || 'ログインに失敗しました');
      }

      localStorage.setItem('castToken', data.token);
      localStorage.setItem('castUser', JSON.stringify(data.user));
      navigate('/cast/today');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ログインに失敗しました');
    } finally {
      setLoading(false);
    }
  };

  const handleMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const res = await fetch(`${API_BASE}/api/cast/magic-link`, {
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
        throw new Error(data.message || 'メール送信に失敗しました');
      }

      setMagicLinkSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'メール送信に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  if (magicLinkSent) {
    return (
      <div className="cast-container">
        <div className="cast-card">
          <div className="cast-logo">ほうこちゃん</div>
          <h1>メールを確認してください</h1>
          <p className="cast-message success">
            {email} にログインリンクを送信しました。<br />
            メール内のリンクをクリックしてログインしてください。
          </p>
          <button 
            className="cast-button secondary"
            onClick={() => { setMagicLinkSent(false); setShowMagicLink(false); }}
          >
            戻る
          </button>
        </div>
      </div>
    );
  }

  if (showMagicLink) {
    return (
      <div className="cast-container">
        <div className="cast-card">
          <div className="cast-logo">ほうこちゃん</div>
          <h1>メールでログイン</h1>
          <p className="cast-subtitle">メールアドレスにログインリンクを送信します</p>

          <form onSubmit={handleMagicLink}>
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

            <button type="submit" className="cast-button" disabled={loading}>
              {loading ? '送信中...' : 'ログインリンクを送信'}
            </button>
          </form>

          <div className="cast-links">
            <button 
              type="button" 
              className="cast-link-button"
              onClick={() => setShowMagicLink(false)}
            >
              暗証番号でログイン
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="cast-container">
      <div className="cast-card">
        <div className="cast-logo">ほうこちゃん</div>
        <h1>スタッフログイン</h1>

        <form onSubmit={handleLogin}>
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

          <div className="cast-input-group">
            <label htmlFor="pin">暗証番号</label>
            <input
              type="password"
              id="pin"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
              placeholder="••••"
              inputMode="numeric"
              pattern="\d{4}"
              maxLength={4}
              required
              disabled={loading}
            />
          </div>

          {error && <p className="cast-message error">{error}</p>}

          <button type="submit" className="cast-button" disabled={loading}>
            {loading ? 'ログイン中...' : 'ログイン'}
          </button>
        </form>

        <div className="cast-links">
          <a href="/cast/reset-pin">暗証番号を再設定する</a>
          <button 
            type="button" 
            className="cast-link-button"
            onClick={() => setShowMagicLink(true)}
          >
            メールでログイン
          </button>
          <a href="/cast/register">新規登録</a>
        </div>
      </div>
    </div>
  );
}
