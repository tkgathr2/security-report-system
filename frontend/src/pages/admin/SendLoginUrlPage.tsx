import { useState, useRef, useEffect } from 'react'
import { COLORS } from '../../constants/admin'
import { styles } from '../../styles/adminStyles'
import type { StaffMember } from '../../types/admin'

interface SendLoginUrlPageProps {
  staff: StaffMember[]
  isMobile: boolean
}

export function SendLoginUrlPage({ staff, isMobile }: SendLoginUrlPageProps) {
  const [emailInput, setEmailInput] = useState('')
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [castSearch, setCastSearch] = useState('')
  const [showDropdown, setShowDropdown] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const staffWithEmail = staff.filter(s => s.registered_email || s.email)

  const castMatches = castSearch.trim()
    ? staffWithEmail.filter(s =>
        s.display_name_kanji.includes(castSearch.trim()) ||
        s.display_name_kana.includes(castSearch.trim()) ||
        (s.registered_email || s.email || '').includes(castSearch.trim())
      )
    : []

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleSendByStaff = async (staffId: string) => {
    setSending(true)
    setResult(null)
    try {
      const res = await fetch('/api/admin/send-login-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ staff_id: staffId }),
      })
      const data = await res.json()
      if (res.ok) {
        setResult({ ok: true, message: data.message })
        setCastSearch('')
        setShowDropdown(false)
      } else {
        setResult({ ok: false, message: data.message || 'エラーが発生しました' })
      }
    } catch {
      setResult({ ok: false, message: '通信エラーが発生しました' })
    } finally {
      setSending(false)
    }
  }

  const handleSendByEmail = async () => {
    if (!emailInput.trim()) return
    setSending(true)
    setResult(null)
    try {
      const res = await fetch('/api/admin/send-login-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email: emailInput.trim() }),
      })
      const data = await res.json()
      if (res.ok) {
        setResult({ ok: true, message: data.message })
        setEmailInput('')
      } else {
        setResult({ ok: false, message: data.message || 'エラーが発生しました' })
      }
    } catch {
      setResult({ ok: false, message: '通信エラーが発生しました' })
    } finally {
      setSending(false)
    }
  }

  return (
    <div>
      <h2 style={styles.pageTitle}>ログインURL送信</h2>

      <div style={{ background: COLORS.white, borderRadius: '12px', padding: '24px', marginBottom: '20px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
        <h3 style={{ margin: '0 0 16px', fontSize: '16px', color: COLORS.text }}>キャストを検索して送信</h3>
        <div ref={dropdownRef} style={{ position: 'relative' as const }}>
          <label style={{ display: 'block', fontSize: '13px', color: COLORS.darkGray, marginBottom: '6px' }}>名前またはメールアドレスで検索</label>
          <input
            type="text"
            value={castSearch}
            onChange={(e) => { setCastSearch(e.target.value); setShowDropdown(true) }}
            onFocus={() => { if (castSearch.trim()) setShowDropdown(true) }}
            placeholder="名前またはメールアドレスを入力..."
            style={{ width: '100%', padding: '10px 12px', fontSize: '14px', border: `1px solid ${COLORS.gray}`, borderRadius: '6px', boxSizing: 'border-box' as const }}
          />
          {showDropdown && castSearch.trim() && (
            <div style={{
              position: 'absolute' as const,
              top: '100%',
              left: 0,
              right: 0,
              background: COLORS.white,
              border: `1px solid ${COLORS.gray}`,
              borderRadius: '0 0 8px 8px',
              boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
              maxHeight: '240px',
              overflowY: 'auto' as const,
              zIndex: 10,
            }}>
              {castMatches.length === 0 ? (
                <div style={{ padding: '12px 16px', color: COLORS.darkGray, fontSize: '14px' }}>該当なし</div>
              ) : (
                castMatches.map(s => (
                  <div
                    key={s.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '10px 16px',
                      borderBottom: `1px solid ${COLORS.lightGray}`,
                      cursor: 'pointer',
                    }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = '#f8f9fa' }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = '' }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 'bold', color: COLORS.text, fontSize: '14px' }}>{s.display_name_kanji}</div>
                      <div style={{ color: COLORS.darkGray, fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{s.registered_email || s.email}</div>
                    </div>
                    <button
                      style={{ ...styles.primaryButton, padding: '6px 16px', fontSize: '13px', marginLeft: '8px', opacity: sending ? 0.6 : 1 }}
                      onClick={() => handleSendByStaff(s.id)}
                      disabled={sending}
                    >
                      {sending ? '...' : '送信'}
                    </button>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      <div style={{ background: COLORS.white, borderRadius: '12px', padding: '24px', marginBottom: '20px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
        <h3 style={{ margin: '0 0 16px', fontSize: '16px', color: COLORS.text }}>メールアドレスを入力して送信</h3>
        <div style={{ display: 'flex', flexDirection: isMobile ? 'column' as const : 'row' as const, gap: '12px', alignItems: isMobile ? 'stretch' : 'flex-end' }}>
          <div style={{ flex: 1 }}>
            <label style={{ display: 'block', fontSize: '13px', color: COLORS.darkGray, marginBottom: '6px' }}>メールアドレス</label>
            <input
              type="email"
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
              placeholder="example@email.com"
              style={{ width: '100%', padding: '10px 12px', fontSize: '14px', border: `1px solid ${COLORS.gray}`, borderRadius: '6px', boxSizing: 'border-box' as const }}
              onKeyDown={(e) => { if (e.key === 'Enter' && emailInput.trim()) handleSendByEmail() }}
            />
          </div>
          <button
            style={{ ...styles.primaryButton, opacity: (!emailInput.trim() || sending) ? 0.6 : 1, whiteSpace: 'nowrap' as const }}
            onClick={handleSendByEmail}
            disabled={!emailInput.trim() || sending}
          >
            {sending ? '送信中...' : '送信'}
          </button>
        </div>
      </div>

      {result && (
        <div style={{
          background: result.ok ? '#e8f5e9' : '#ffebee',
          color: result.ok ? '#2e7d32' : '#c62828',
          padding: '16px',
          borderRadius: '8px',
          marginBottom: '20px',
          fontWeight: 500,
        }}>
          {result.message}
        </div>
      )}
    </div>
  )
}
