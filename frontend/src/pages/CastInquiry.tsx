import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import './Cast.css';

const API_BASE = import.meta.env.VITE_API_URL || '';

export default function CastInquiry() {
  const navigate = useNavigate();
  const [category, setCategory] = useState('bug');
  const [message, setMessage] = useState('');
  const [screenshot, setScreenshot] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    setScreenshot(file);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(file ? URL.createObjectURL(file) : null);
  };

  const handleRemoveFile = () => {
    setScreenshot(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  const handleSubmit = async () => {
    if (!message.trim()) return;

    const token = localStorage.getItem('castToken');
    if (!token) {
      navigate('/cast/login');
      return;
    }

    setSending(true);
    setResult(null);

    const formData = new FormData();
    formData.append('category', category);
    formData.append('message', message.trim());
    if (screenshot) {
      formData.append('screenshot', screenshot);
    }

    try {
      const res = await fetch(`${API_BASE}/api/cast/inquiry`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData,
      });

      if (res.status === 401) {
        localStorage.removeItem('castToken');
        localStorage.removeItem('castUser');
        navigate('/cast/login');
        return;
      }

      const data = await res.json();
      if (res.ok) {
        setResult({ ok: true, message: data.message });
        setMessage('');
        handleRemoveFile();
      } else {
        setResult({ ok: false, message: data.message || '送信に失敗しました' });
      }
    } catch {
      setResult({ ok: false, message: '通信エラーが発生しました' });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="cast-container">
      <div className="cast-card wide">
        <div className="cast-header">
          <div className="cast-logo">ほうこちゃん</div>
          <button className="cast-logout" onClick={() => navigate('/cast/today')}>
            戻る
          </button>
        </div>

        <h1>お問い合わせ</h1>
        <p className="cast-subtitle">
          バグや分かりにくい点がありましたらお知らせください
        </p>

        {result && (
          <p className={`cast-message ${result.ok ? 'success' : 'error'}`}>
            {result.message}
          </p>
        )}

        {!result?.ok && (
          <>
            <div className="cast-input-group">
              <label>カテゴリ</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                style={{
                  width: '100%',
                  padding: '14px 16px',
                  fontSize: '16px',
                  border: '2px solid #e0e0e0',
                  borderRadius: '8px',
                  boxSizing: 'border-box',
                  background: 'white',
                }}
              >
                <option value="bug">バグ報告</option>
                <option value="unclear">わかりにくい点</option>
                <option value="other">その他</option>
              </select>
            </div>

            <div className="cast-input-group">
              <label>メッセージ</label>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="お問い合わせ内容をご記入ください"
                maxLength={2000}
                rows={5}
                style={{
                  width: '100%',
                  padding: '14px 16px',
                  fontSize: '16px',
                  border: '2px solid #e0e0e0',
                  borderRadius: '8px',
                  boxSizing: 'border-box',
                  resize: 'vertical',
                  fontFamily: 'inherit',
                }}
              />
              <small>{message.length} / 2000</small>
            </div>

            <div className="cast-input-group">
              <label>スクリーンショット（任意）</label>
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp"
                onChange={handleFileChange}
                style={{
                  width: '100%',
                  padding: '10px 0',
                  fontSize: '14px',
                  boxSizing: 'border-box',
                }}
              />
              <small>PNG, JPEG, GIF, WebP (最大5MB)</small>
              {previewUrl && (
                <div style={{ marginTop: '12px', position: 'relative' }}>
                  <img
                    src={previewUrl}
                    alt="プレビュー"
                    style={{
                      maxWidth: '100%',
                      maxHeight: '200px',
                      borderRadius: '8px',
                      border: '1px solid #e0e0e0',
                    }}
                  />
                  <button
                    onClick={handleRemoveFile}
                    style={{
                      position: 'absolute',
                      top: '4px',
                      right: '4px',
                      background: 'rgba(220,38,38,0.9)',
                      color: 'white',
                      border: 'none',
                      borderRadius: '50%',
                      width: '28px',
                      height: '28px',
                      cursor: 'pointer',
                      fontSize: '14px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    x
                  </button>
                </div>
              )}
            </div>

            <button
              className="cast-button"
              onClick={handleSubmit}
              disabled={sending || !message.trim()}
            >
              {sending ? '送信中...' : '送信する'}
            </button>
          </>
        )}

        {result?.ok && (
          <div style={{ textAlign: 'center', marginTop: '20px' }}>
            <button className="cast-button" onClick={() => navigate('/cast/today')}>
              現場一覧に戻る
            </button>
            <button
              className="cast-button secondary"
              onClick={() => setResult(null)}
            >
              続けて問い合わせる
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
