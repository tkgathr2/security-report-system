import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import './Cast.css';

const API_BASE = import.meta.env.VITE_API_URL || '';

export default function CastMagic() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token');

  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) {
      setError('無効なリンクです');
      return;
    }

    // Remove token from URL history for security
    window.history.replaceState({}, '', window.location.pathname);

    fetch(`${API_BASE}/api/cast/magic`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token })
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.token) {
          localStorage.setItem('castToken', data.token);
          localStorage.setItem('castUser', JSON.stringify(data.user));
          navigate('/cast/today');
        } else {
          setError(data.message || 'リンクが無効または期限切れです');
        }
      })
      .catch(() => {
        setError('エラーが発生しました');
      });
  }, [token, navigate]);

  if (error) {
    return (
      <div className="cast-container">
        <div className="cast-card">
          <div className="cast-logo">デジタル警備報告書システム<br />【ほうこちゃん】</div>
          <h1>エラー</h1>
          <p className="cast-message error">{error}</p>
          <a href="/cast/login" className="cast-button">
            ログインページへ
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="cast-container">
      <div className="cast-card">
        <div className="cast-logo">デジタル警備報告書システム<br />【ほうこちゃん】</div>
        <p>ログイン中...</p>
      </div>
    </div>
  );
}
