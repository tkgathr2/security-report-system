import { useState, useEffect, useRef } from 'react';
import './Cast.css';

const API_BASE = import.meta.env.VITE_API_URL || '';

interface StaffMember {
  id: string;
  display_name_kanji: string;
  display_name_kana: string;
}

export default function CastRegister() {
  const [email, setEmail] = useState('');
  const [nameKana, setNameKana] = useState('');
  const [nameKanji, setNameKanji] = useState('');
  const [selectedStaffId, setSelectedStaffId] = useState<string | null>(null);
  const [staffSuggestions, setStaffSuggestions] = useState<StaffMember[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const searchStaff = async () => {
      if (nameKana.length < 1) {
        setStaffSuggestions([]);
        return;
      }

      try {
        const res = await fetch(`${API_BASE}/api/cast/search-staff?q=${encodeURIComponent(nameKana)}`);
        const data = await res.json();
        setStaffSuggestions(data.staff || []);
        setShowSuggestions(true);
      } catch (err) {
        console.error('Staff search error:', err);
      }
    };

    const debounce = setTimeout(searchStaff, 300);
    return () => clearTimeout(debounce);
  }, [nameKana]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (suggestionsRef.current && !suggestionsRef.current.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelectStaff = (staff: StaffMember) => {
    setNameKana(staff.display_name_kana);
    setNameKanji(staff.display_name_kanji);
    setSelectedStaffId(staff.id);
    setShowSuggestions(false);
  };

  const handleKanaChange = (value: string) => {
    setNameKana(value);
    setSelectedStaffId(null);
    setNameKanji('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!selectedStaffId) {
      setError('スタッフを選択してください。カナを入力して候補から選んでください。');
      return;
    }

    setLoading(true);
    setError('');
    setMessage('');

    try {
      const res = await fetch(`${API_BASE}/api/cast/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          email,
          staffId: selectedStaffId,
          name: nameKanji
        }),
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
            onClick={() => { 
              setSent(false); 
              setEmail(''); 
              setNameKana('');
              setNameKanji('');
              setSelectedStaffId(null);
            }}
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
        <p className="cast-subtitle">お名前とメールアドレスを入力してください</p>

        <form onSubmit={handleSubmit}>
          <div className="cast-input-group" ref={suggestionsRef}>
            <label htmlFor="nameKana">お名前（カナで検索）</label>
            <input
              type="text"
              id="nameKana"
              value={nameKana}
              onChange={(e) => handleKanaChange(e.target.value)}
              onFocus={() => nameKana.length > 0 && setShowSuggestions(true)}
              placeholder="カナで入力してください（例：ヤマダ）"
              required
              disabled={loading}
              autoComplete="off"
            />
            {showSuggestions && staffSuggestions.length > 0 && (
              <div className="staff-suggestions">
                {staffSuggestions.map((staff) => (
                  <div
                    key={staff.id}
                    className="staff-suggestion-item"
                    onClick={() => handleSelectStaff(staff)}
                  >
                    <span className="staff-name-kanji">{staff.display_name_kanji}</span>
                    <span className="staff-name-kana">{staff.display_name_kana}</span>
                  </div>
                ))}
              </div>
            )}
            {nameKana.length > 0 && staffSuggestions.length === 0 && showSuggestions && (
              <div className="staff-suggestions">
                <div className="staff-suggestion-empty">
                  該当するスタッフが見つかりません
                </div>
              </div>
            )}
          </div>

          {selectedStaffId && (
            <div className="cast-input-group">
              <label>選択されたスタッフ</label>
              <div className="selected-staff">
                <span className="selected-staff-name">{nameKanji}</span>
                <span className="selected-staff-kana">（{nameKana}）</span>
              </div>
            </div>
          )}

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

          <button type="submit" className="cast-button" disabled={loading || !selectedStaffId}>
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
