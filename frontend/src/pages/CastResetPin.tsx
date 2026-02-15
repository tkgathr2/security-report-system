import { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import './Cast.css';

const API_BASE = import.meta.env.VITE_API_URL || '';

export default function CastResetPin() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [userName, setUserName] = useState('');
  const [pin, setPin] = useState('');
  const [pinConfirm, setPinConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  const [requestEmail, setRequestEmail] = useState('');
  const [requestLoading, setRequestLoading] = useState(false);
  const [requestSent, setRequestSent] = useState(false);
  const [requestError, setRequestError] = useState('');

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }

    fetch(`${API_BASE}/api/cast/reset-pin/verify?token=${token}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.valid) {
          setUserName(data.name || '');
        } else {
          setError(data.message || 'リンクが無効または期限切れです');
        }
      })
      .catch(() => {
        setError('エラーが発生しました');
      })
      .finally(() => {
        setLoading(false);
      });
  }, [token]);

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

  const handleResetConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (pin.length !== 4 || !/^\d{4}$/.test(pin)) {
      setError('暗証番号は4桁の数字で入力してください');
      return;
    }

    if (pin !== pinConfirm) {
      setError('暗証番号が一致しません');
      return;
    }

    setSubmitting(true);

    try {
      const res = await fetch(`${API_BASE}/api/cast/reset-pin/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, pin }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.message || '再設定に失敗しました');
      }

      localStorage.setItem('castToken', data.token);
      localStorage.setItem('castUser', JSON.stringify(data.user));
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : '再設定に失敗しました');
    } finally {
      setSubmitting(false);
    }
  };

  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

  const handleRequestReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setRequestError('');
    setRequestLoading(true);

    if (!emailRegex.test(requestEmail.trim())) {
      setRequestError('正しいメールアドレスを入力してください');
      setRequestLoading(false);
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/api/cast/reset-pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: requestEmail }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.message || 'メール送信に失敗しました');
      }

      setRequestSent(true);
    } catch (err) {
      setRequestError(err instanceof Error ? err.message : 'メール送信に失敗しました');
    } finally {
      setRequestLoading(false);
    }
  };

  if (success) {
    return (
      <div className="cast-container">
        <div className="cast-card">
          <div className="cast-logo">ほうこちゃん</div>
          <h1>再設定完了</h1>
          <p className="cast-message success">
            暗証番号を再設定しました。
          </p>
          <button
            className="cast-button"
            onClick={() => navigate('/cast/today')}
          >
            今日の現場を見る
          </button>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="cast-container">
        <div className="cast-card">
          <div className="cast-logo">ほうこちゃん</div>
          <p style={{ textAlign: 'center' }}>読み込み中...</p>
        </div>
      </div>
    );
  }

  if (token && !error && userName !== undefined) {
    return (
      <div className="cast-container">
        <div className="cast-card">
          <div className="cast-logo">ほうこちゃん</div>
          <h1>暗証番号の再設定</h1>
          {userName && <p className="cast-subtitle">{userName} 様</p>}

          <form onSubmit={handleResetConfirm}>
            <div className="cast-input-group">
              <label htmlFor="pin">新しい暗証番号（4桁）</label>
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
                disabled={submitting}
              />
            </div>

            <div className="cast-input-group">
              <label htmlFor="pinConfirm">暗証番号の確認</label>
              <input
                type="password"
                id="pinConfirm"
                value={pinConfirm}
                onChange={(e) => setPinConfirm(e.target.value.replace(/\D/g, '').slice(0, 4))}
                placeholder="••••"
                inputMode="numeric"
                pattern="\d{4}"
                maxLength={4}
                required
                disabled={submitting}
              />
            </div>

            {error && <p className="cast-message error">{error}</p>}

            <button type="submit" className="cast-button" disabled={submitting}>
              {submitting ? '設定中...' : '暗証番号を再設定'}
            </button>
          </form>

          <div className="cast-links">
            <a href="/cast/login">ログインページへ戻る</a>
          </div>
        </div>
      </div>
    );
  }

  if (error && token) {
    return (
      <div className="cast-container">
        <div className="cast-card">
          <div className="cast-logo">ほうこちゃん</div>
          <h1>エラー</h1>
          <p className="cast-message error">{error}</p>
          <a href="/cast/reset-pin" className="cast-button">
            再度リセットを申請する
          </a>
          <div className="cast-links">
            <a href="/cast/login">ログインページへ戻る</a>
          </div>
        </div>
      </div>
    );
  }

  if (requestSent) {
    return (
      <div className="cast-container">
        <div className="cast-card">
          <div className="cast-logo">ほうこちゃん</div>
          <h1>メールを確認してください</h1>
          <p className="cast-message success">
            {requestEmail} に暗証番号の再設定リンクを送信しました。<br />
            メール内のリンクをクリックして新しい暗証番号を設定してください。
          </p>
          <div className="cast-links">
            <a href="/cast/login">ログインページへ戻る</a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="cast-container">
      <div className="cast-card">
        <div className="cast-logo">ほうこちゃん</div>
        <h1>暗証番号の再設定</h1>
        <p className="cast-subtitle">登録済みのメールアドレスを入力してください</p>

        <form onSubmit={handleRequestReset}>
          <div className="cast-input-group">
            <label htmlFor="email">メールアドレス</label>
            <input
              type="email"
              id="email"
              value={requestEmail}
              onChange={(e) => setRequestEmail(e.target.value)}
              placeholder="example@email.com"
              required
              disabled={requestLoading}
            />
          </div>

          {requestError && <p className="cast-message error">{requestError}</p>}

          <button type="submit" className="cast-button" disabled={requestLoading}>
            {requestLoading ? '送信中...' : '再設定メールを送信'}
          </button>
        </form>

        <div className="cast-links">
          <a href="/cast/login">ログインページへ戻る</a>
        </div>
      </div>
    </div>
  );
}
