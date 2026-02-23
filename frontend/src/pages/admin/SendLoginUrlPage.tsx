import { useState } from 'react'
import { COLORS } from '../../constants/admin'
import { styles } from '../../styles/adminStyles'
import type { StaffMember } from '../../types/admin'

interface SendLoginUrlPageProps {
  staff: StaffMember[]
  isMobile: boolean
}

export function SendLoginUrlPage({ staff, isMobile }: SendLoginUrlPageProps) {
  const [emailInput, setEmailInput] = useState('')
  const [selectedStaffId, setSelectedStaffId] = useState('')
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [searchQuery, setSearchQuery] = useState('')

  const staffWithEmail = staff.filter(s => s.registered_email || s.email)

  const filteredStaff = searchQuery
    ? staffWithEmail.filter(s =>
        s.display_name_kanji.includes(searchQuery) ||
        s.display_name_kana.includes(searchQuery) ||
        (s.registered_email || s.email || '').includes(searchQuery)
      )
    : staffWithEmail

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

  const handleSendBySelect = async () => {
    if (!selectedStaffId) return
    await handleSendByStaff(selectedStaffId)
    setSelectedStaffId('')
  }

  return (
    <div>
      <h2 style={styles.pageTitle}>ログインURL送信</h2>

      <div style={{ background: COLORS.white, borderRadius: '12px', padding: '24px', marginBottom: '20px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
        <h3 style={{ margin: '0 0 16px', fontSize: '16px', color: COLORS.text }}>キャストを選んで送信</h3>
        <div style={{ display: 'flex', flexDirection: isMobile ? 'column' as const : 'row' as const, gap: '12px', alignItems: isMobile ? 'stretch' : 'flex-end' }}>
          <div style={{ flex: 1 }}>
            <label style={{ display: 'block', fontSize: '13px', color: COLORS.darkGray, marginBottom: '6px' }}>キャスト</label>
            <select
              value={selectedStaffId}
              onChange={(e) => setSelectedStaffId(e.target.value)}
              style={{ width: '100%', padding: '10px 12px', fontSize: '14px', border: `1px solid ${COLORS.gray}`, borderRadius: '6px', backgroundColor: COLORS.white }}
            >
              <option value="">-- 選択してください --</option>
              {staffWithEmail.map(s => (
                <option key={s.id} value={s.id}>
                  {s.display_name_kanji} ({s.registered_email || s.email})
                </option>
              ))}
            </select>
          </div>
          <button
            style={{ ...styles.primaryButton, opacity: (!selectedStaffId || sending) ? 0.6 : 1, whiteSpace: 'nowrap' as const }}
            onClick={handleSendBySelect}
            disabled={!selectedStaffId || sending}
          >
            {sending ? '送信中...' : '送信'}
          </button>
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

      <div style={{ background: COLORS.white, borderRadius: '12px', padding: '24px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h3 style={{ margin: 0, fontSize: '16px', color: COLORS.text }}>登録済みキャスト一覧</h3>
          <span style={{ fontSize: '13px', color: COLORS.darkGray }}>
            {searchQuery ? `${filteredStaff.length}件 / ${staffWithEmail.length}件` : `${staffWithEmail.length}件`}
          </span>
        </div>
        <input
          type="text"
          style={{ ...styles.searchInput, marginBottom: '12px' }}
          placeholder="名前またはメールで検索..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        {filteredStaff.length === 0 ? (
          <p style={{ color: COLORS.darkGray, textAlign: 'center' as const, padding: '20px 0' }}>
            {staffWithEmail.length === 0 ? 'メールアドレスが登録されているキャストがいません' : '検索結果がありません'}
          </p>
        ) : isMobile ? (
          <div style={{ display: 'flex', flexDirection: 'column' as const, gap: '8px' }}>
            {filteredStaff.map(s => (
              <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px', background: '#f8f9fa', borderRadius: '8px' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 'bold', color: COLORS.text, fontSize: '14px' }}>{s.display_name_kanji}</div>
                  <div style={{ color: COLORS.darkGray, fontSize: '12px', marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{s.registered_email || s.email}</div>
                </div>
                <button
                  style={{ ...styles.primaryButton, padding: '6px 16px', fontSize: '13px', marginLeft: '8px', opacity: sending ? 0.6 : 1 }}
                  onClick={() => handleSendByStaff(s.id)}
                  disabled={sending}
                >
                  送信
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div style={styles.tableContainer}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>氏名</th>
                  <th style={styles.th}>メールアドレス</th>
                  <th style={styles.th}>操作</th>
                </tr>
              </thead>
              <tbody>
                {filteredStaff.map(s => (
                  <tr key={s.id} style={styles.tr}>
                    <td style={styles.td}>{s.display_name_kanji}</td>
                    <td style={styles.td}>{s.registered_email || s.email}</td>
                    <td style={styles.td}>
                      <button
                        style={{ ...styles.primaryButton, padding: '6px 16px', fontSize: '13px', opacity: sending ? 0.6 : 1 }}
                        onClick={() => handleSendByStaff(s.id)}
                        disabled={sending}
                      >
                        送信
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
