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
  const [pendingStaff, setPendingStaff] = useState<StaffMember | null>(null)
  const [staffEmailInput, setStaffEmailInput] = useState('')
  const dropdownRef = useRef<HTMLDivElement>(null)

  const castMatches = castSearch.trim()
    ? staff.filter(s =>
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

  const handleSendByStaff = async (s: StaffMember, overrideEmail?: string) => {
    const staffEmail = overrideEmail || s.registered_email || s.email
    if (!staffEmail) {
      setPendingStaff(s)
      setStaffEmailInput('')
      setShowDropdown(false)
      return
    }
    setSending(true)
    setResult(null)
    try {
      const res = await fetch('/api/admin/send-login-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ staff_id: s.id, email: overrideEmail || undefined }),
      })
      const data = await res.json()
      if (res.ok) {
        setResult({ ok: true, message: data.message })
        setCastSearch('')
        setShowDropdown(false)
        setPendingStaff(null)
        setStaffEmailInput('')
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

  const getInitials = (name: string) => {
    return name.replace(/\s+/g, '').slice(0, 2)
  }

  return (
    <div>
      <h2 style={styles.pageTitle}>URL送信</h2>

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

      <div style={{ background: COLORS.white, borderRadius: '12px', padding: isMobile ? '20px' : '28px', marginBottom: '24px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '20px' }}>
          <span style={{ fontSize: '20px' }}>&#128269;</span>
          <h3 style={{ margin: 0, fontSize: '17px', color: COLORS.text }}>キャストを検索して送信</h3>
        </div>
        <div ref={dropdownRef} style={{ position: 'relative' as const }}>
          <input
            type="text"
            value={castSearch}
            onChange={(e) => { setCastSearch(e.target.value); setShowDropdown(true) }}
            onFocus={() => { if (castSearch.trim()) setShowDropdown(true) }}
            placeholder="名前またはメールアドレスを入力..."
            style={{
              width: '100%',
              padding: '12px 16px',
              fontSize: '15px',
              border: showDropdown && castSearch.trim() ? `2px solid ${COLORS.primary}` : `1px solid ${COLORS.gray}`,
              borderRadius: showDropdown && castSearch.trim() ? '10px 10px 0 0' : '10px',
              boxSizing: 'border-box' as const,
              outline: 'none',
            }}
          />
          {showDropdown && castSearch.trim() && (
            <div style={{
              border: `1px solid ${COLORS.gray}`,
              borderTop: 'none',
              borderRadius: '0 0 10px 10px',
              overflow: 'hidden',
              maxHeight: '300px',
              overflowY: 'auto' as const,
            }}>
              {castMatches.length === 0 ? (
                <div style={{ padding: '14px 16px', color: COLORS.darkGray, fontSize: '14px' }}>該当なし</div>
              ) : (
                castMatches.map(s => (
                  <div
                    key={s.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      padding: '14px 16px',
                      borderBottom: `1px solid ${COLORS.lightGray}`,
                    }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = '#f8f9fa' }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = '' }}
                  >
                    <div style={{
                      width: '40px',
                      height: '40px',
                      borderRadius: '50%',
                      background: `linear-gradient(135deg, ${COLORS.primary}, #F39C12)`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: COLORS.white,
                      fontWeight: 'bold',
                      fontSize: '14px',
                      flexShrink: 0,
                    }}>
                      {getInitials(s.display_name_kanji)}
                    </div>
                    <div style={{ marginLeft: '14px', flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, color: COLORS.text, fontSize: '15px' }}>{s.display_name_kanji}</div>
                      <div style={{ color: COLORS.darkGray, fontSize: '13px', marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{s.registered_email || s.email}</div>
                    </div>
                    <button
                      style={{ ...styles.primaryButton, padding: '8px 20px', fontSize: '14px', marginLeft: '8px', borderRadius: '8px', opacity: sending ? 0.6 : 1 }}
                      onClick={() => handleSendByStaff(s)}
                      disabled={sending}
                    >
                      {sending ? '...' : (s.registered_email || s.email) ? '送信' : 'メール入力'}
                    </button>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {pendingStaff && (
        <div style={{ background: '#FFF8E1', borderRadius: '12px', padding: isMobile ? '20px' : '28px', marginBottom: '24px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)', border: `1px solid ${COLORS.primary}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
            <span style={{ fontSize: '20px' }}>&#9993;&#65039;</span>
            <h3 style={{ margin: 0, fontSize: '17px', color: COLORS.text }}>
              {pendingStaff.display_name_kanji} のメールアドレスを入力
            </h3>
            <button onClick={() => setPendingStaff(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', fontSize: '18px', cursor: 'pointer', color: COLORS.darkGray }}>&#10005;</button>
          </div>
          <div style={{ display: 'flex', flexDirection: isMobile ? 'column' as const : 'row' as const, gap: '12px', alignItems: isMobile ? 'stretch' : 'center' }}>
            <input
              type="email"
              value={staffEmailInput}
              onChange={(e) => setStaffEmailInput(e.target.value)}
              placeholder="example@email.com"
              style={{ flex: 1, padding: '12px 16px', fontSize: '15px', border: `1px solid ${COLORS.gray}`, borderRadius: '10px', boxSizing: 'border-box' as const }}
              onKeyDown={(e) => { if (e.key === 'Enter' && staffEmailInput.trim()) handleSendByStaff(pendingStaff, staffEmailInput.trim()) }}
              autoFocus
            />
            <button
              style={{ ...styles.primaryButton, padding: '12px 24px', fontSize: '14px', borderRadius: '10px', opacity: (!staffEmailInput.trim() || sending) ? 0.6 : 1, whiteSpace: 'nowrap' as const }}
              onClick={() => handleSendByStaff(pendingStaff, staffEmailInput.trim())}
              disabled={!staffEmailInput.trim() || sending}
            >
              {sending ? '送信中...' : '送信'}
            </button>
          </div>
        </div>
      )}

      <div style={{ background: COLORS.white, borderRadius: '12px', padding: isMobile ? '20px' : '28px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '20px' }}>
          <span style={{ fontSize: '20px' }}>&#9993;&#65039;</span>
          <h3 style={{ margin: 0, fontSize: '17px', color: COLORS.text }}>メールアドレスを直接入力して送信</h3>
        </div>
        <div style={{ display: 'flex', flexDirection: isMobile ? 'column' as const : 'row' as const, gap: '12px', alignItems: isMobile ? 'stretch' : 'center' }}>
          <input
            type="email"
            value={emailInput}
            onChange={(e) => setEmailInput(e.target.value)}
            placeholder="example@email.com"
            style={{ flex: 1, padding: '12px 16px', fontSize: '15px', border: `1px solid ${COLORS.gray}`, borderRadius: '10px', boxSizing: 'border-box' as const }}
            onKeyDown={(e) => { if (e.key === 'Enter' && emailInput.trim()) handleSendByEmail() }}
          />
          <button
            style={{ ...styles.primaryButton, padding: '12px 24px', fontSize: '14px', borderRadius: '10px', opacity: (!emailInput.trim() || sending) ? 0.6 : 1, whiteSpace: 'nowrap' as const }}
            onClick={handleSendByEmail}
            disabled={!emailInput.trim() || sending}
          >
            {sending ? '送信中...' : '送信'}
          </button>
        </div>
      </div>
    </div>
  )
}
