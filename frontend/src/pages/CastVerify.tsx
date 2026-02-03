import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import './Cast.css';

const API_BASE = import.meta.env.VITE_API_URL || '';

export default function CastVerify() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token');

  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState('');
  const [valid, setValid] = useState(false);

  useEffect(() => {
    if (!token) {
      setError('無効なリンクです');
      setLoading(false);
      return;
    }

    fetch(`${API_BASE}/api/cast/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.valid) {
          setValid(true);
          setEmail(data.email);
          if (data.existingName) setName(data.existingName);
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
      setError('PINコードが一致しません');
      return;
    }

    if (!/^\d{4}$/.test(pin)) {
      setError('PINコードは4桁の数字で入力してください');
      return;
    }

    setVerifying(true);

    try {
      const res = await fetch(`${API_BASE}/api/cast/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, name, pin }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.message || '登録に失敗しました');
      }

      localStorage.setItem('castToken', data.token);
      localStorage.setItem('castUser', JSON.stringify(data.user));
      navigate('/cast/today');
    } catch (err) {
      setError(err instanceof Error ? err.message : '登録に失敗しました');
    } finally {
      setVerifying(false);
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

  if (!valid) {
    return (
      <div className="cast-container">
        <div className="cast-card">
          <div className="cast-logo">ほうこちゃん</div>
          <h1>エラー</h1>
          <p className="cast-message error">{error}</p>
          <a href="/cast/register" className="cast-button">
            再度登録する
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="cast-container">
      <div className="cast-card">
        <div className="cast-logo">ほうこちゃん</div>
        <h1>登録を完了する</h1>
        <p className="cast-subtitle">{email}</p>

        <form onSubmit={handleSubmit}>
          <div className="cast-input-group">
            <label htmlFor="name">お名前</label>
            <input
              type="text"
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="山田 太郎"
              required
              disabled={verifying}
            />
            <small>CSVに登録されている名前と同じ名前を入力してください</small>
          </div>

          <div className="cast-input-group">
            <label htmlFor="pin">PINコード（4桁の数字）</label>
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
              disabled={verifying}
            />
          </div>

          <div className="cast-input-group">
            <label htmlFor="confirmPin">PINコード（確認）</label>
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
              disabled={verifying}
            />
          </div>

          {error && <p className="cast-message error">{error}</p>}

          <button type="submit" className="cast-button" disabled={verifying}>
            {verifying ? '登録中...' : '登録を完了する'}
          </button>
        </form>
      </div>
    </div>
  );
}
