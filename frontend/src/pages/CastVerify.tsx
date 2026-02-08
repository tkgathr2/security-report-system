import { useState, useEffect, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import './Cast.css';

const API_BASE = import.meta.env.VITE_API_URL || '';

interface StaffMember {
  id: string;
  display_name_kanji: string;
  display_name_kana: string;
}

export default function CastVerify() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token');

  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [email, setEmail] = useState('');
  const [nameKana, setNameKana] = useState('');
  const [nameKanji, setNameKanji] = useState('');
  const [selectedStaffId, setSelectedStaffId] = useState<string | null>(null);
  const [staffSuggestions, setStaffSuggestions] = useState<StaffMember[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState('');
  const [valid, setValid] = useState(false);
  const suggestionsRef = useRef<HTMLDivElement>(null);

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

  // Staff search effect
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

  // Click outside handler
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
    setError('');

    if (!selectedStaffId) {
      setError('スタッフを選択してください。カナを入力して候補から選んでください。');
      return;
    }

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
        body: JSON.stringify({ token, staffId: selectedStaffId, name: nameKanji, pin }),
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

  const handleKeyDown = (e: React.KeyboardEvent, action: () => void) => {
    if (e.ctrlKey && e.key === 'Enter') {
      e.preventDefault();
      action();
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
              disabled={verifying}
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
            <label htmlFor="pin">PINコード（4桁の数字）</label>
            <input
              type="password"
              id="pin"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
              onKeyDown={(e) => handleKeyDown(e, () => { if (selectedStaffId && pin && confirmPin) { const form = e.currentTarget.form; if (form) form.requestSubmit(); } })}
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
              onKeyDown={(e) => handleKeyDown(e, () => { if (selectedStaffId && pin && confirmPin) { const form = e.currentTarget.form; if (form) form.requestSubmit(); } })}
              placeholder="••••"
              inputMode="numeric"
              pattern="\d{4}"
              maxLength={4}
              required
              disabled={verifying}
            />
          </div>

          {error && <p className="cast-message error">{error}</p>}

          <button type="submit" className="cast-button" disabled={verifying || !selectedStaffId}>
            {verifying ? '登録中...' : '登録を完了する'}
          </button>
        </form>
      </div>
    </div>
  );
}
