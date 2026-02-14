import { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import './Cast.css';

const API_BASE = import.meta.env.VITE_API_URL || '';

export default function CastResetPin() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token');

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState('');
  const [valid, setValid] = useState(false);
  const [success, setSuccess] = useState(false);

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

  useEffect(() => {
    if (!token) {
      setError('無効なリンクです');
      setLoading(false);
      return;
    }

    fetch(`${API_BASE}/api/cast/reset-pin/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.valid) {
          setValid(true);
          setEmail(data.email);
          setName(data.name || '');
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (pin !== confirmPin) {
      setError('暗証番号が一致しません');
      return;
    }

    if (!/^\d{4}$/.test(pin)) {
      setError('暗証番号は4桁の数字で入力してください');
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
        throw new Error(data.message || '暗証番号の再設定に失敗しました');
      }

      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : '暗証番号の再設定に失敗しました');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="cast-container">
        <div className="cast-card">
          <div className="cast-logo">ほうこちゃん</div>
          <p>確認中...</p>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="cast-container">
        <div className="cast-card">
          <div className="cast-logo">ほうこちゃん</div>
          <h1>暗証番号を再設定しました</h1>
          <p className="cast-message success">
            新しい暗証番号でログインしてください。
          </p>
          <button
            className="cast-button"
            onClick={() => navigate('/cast/login')}
          >
            ログイン画面へ
          </button>
        </div>
      </div>
    );
  }

  if (!valid) {
    return (
      <div className="cast-container">
        <div className="cast-card">
          <div className="cast-logo">ほうこちゃん</div>
          <h1>エラー</h1>
          <p className="cast-message error">{error}</p>
          <button
            className="cast-button"
            onClick={() => navigate('/cast/login')}
          >
            ログイン画面へ戻る
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="cast-container">
      <div className="cast-card">
        <div className="cast-logo">ほうこちゃん</div>
        <h1>暗証番号の再設定</h1>
        <p className="cast-subtitle">{name ? `${name} 様` : email}</p>

        <form onSubmit={handleSubmit}>
          <div className="cast-input-group">
            <label htmlFor="pin">新しい暗証番号（4ケタの数字）</label>
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
            <label htmlFor="confirmPin">新しい暗証番号（確認）</label>
            <input
              type="password"
              id="confirmPin"
              value={confirmPin}
              onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
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
            {submitting ? '設定中...' : '暗証番号を再設定する'}
          </button>
        </form>
      </div>
    </div>
  );
}
