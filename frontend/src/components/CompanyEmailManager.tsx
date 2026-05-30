/**
 * CompanyEmailManager — 会社ごとの通知先メール管理コンポーネント
 *
 * 会社編集モーダル内に埋め込んで使う。
 * - 登録済み通知先メールの一覧表示
 * - 新規追加（メールアドレス + 任意ラベル）
 * - 削除（論理削除）
 */
import { useState, useEffect, useCallback } from 'react'
import { COLORS } from '../constants/admin'
import { styles } from '../styles/adminStyles'

interface CompanyEmail {
  id: string
  email: string
  label: string | null
  is_active: boolean
  created_at: string
}

interface CompanyEmailManagerProps {
  companyId: string
  companyName: string
}

export function CompanyEmailManager({ companyId, companyName }: CompanyEmailManagerProps) {
  const [emails, setEmails] = useState<CompanyEmail[]>([])
  const [loading, setLoading] = useState(true)
  const [newEmail, setNewEmail] = useState('')
  const [newLabel, setNewLabel] = useState('')
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState('')

  const fetchEmails = useCallback(async () => {
    try {
      setLoading(true)
      const res = await fetch(`/api/admin/companies/${companyId}/emails`, {
        credentials: 'include',
      })
      if (res.ok) {
        const data = await res.json()
        setEmails(data.emails || [])
      }
    } catch (err) {
      console.error('Failed to fetch company emails:', err)
    } finally {
      setLoading(false)
    }
  }, [companyId])

  useEffect(() => {
    fetchEmails()
  }, [fetchEmails])

  const handleAdd = async () => {
    if (!newEmail.trim()) return
    setError('')
    setAdding(true)
    try {
      const res = await fetch(`/api/admin/companies/${companyId}/emails`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email: newEmail.trim(), label: newLabel.trim() || null }),
      })
      const data = await res.json()
      if (res.ok) {
        setNewEmail('')
        setNewLabel('')
        await fetchEmails()
      } else {
        setError(data.message || 'エラーが発生しました')
      }
    } catch (err) {
      setError('通信エラーが発生しました')
    } finally {
      setAdding(false)
    }
  }

  const handleDelete = async (emailId: string, emailAddr: string) => {
    if (!confirm(`通知先メール「${emailAddr}」を削除しますか？`)) return
    try {
      const res = await fetch(`/api/admin/companies/${companyId}/emails/${emailId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      })
      if (res.ok) {
        await fetchEmails()
      }
    } catch (err) {
      console.error('Failed to delete company email:', err)
    }
  }

  return (
    <div style={{ marginTop: '16px', borderTop: `1px solid ${COLORS.lightGray}`, paddingTop: '16px' }}>
      <h4 style={{ margin: '0 0 8px 0', fontSize: '14px', color: COLORS.darkGray }}>
        📧 報告書メール通知先
      </h4>
      <p style={{ fontSize: '12px', color: COLORS.darkGray, margin: '0 0 12px 0' }}>
        報告書が承認されると、ここに登録されたメールアドレスにPDF付きで自動送信されます。
      </p>

      {loading ? (
        <p style={{ fontSize: '13px', color: COLORS.darkGray }}>読み込み中...</p>
      ) : (
        <>
          {/* 登録済みメール一覧 */}
          {emails.length > 0 ? (
            <div style={{ marginBottom: '12px' }}>
              {emails.map((em) => (
                <div
                  key={em.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '6px 8px',
                    backgroundColor: '#f8f9fa',
                    borderRadius: '4px',
                    marginBottom: '4px',
                    fontSize: '13px',
                  }}
                >
                  <div>
                    <span style={{ fontWeight: 500 }}>{em.email}</span>
                    {em.label && (
                      <span style={{ color: COLORS.darkGray, marginLeft: '8px', fontSize: '12px' }}>
                        ({em.label})
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => handleDelete(em.id, em.email)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: COLORS.danger,
                      cursor: 'pointer',
                      fontSize: '12px',
                      padding: '2px 6px',
                    }}
                  >
                    削除
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p style={{ fontSize: '13px', color: COLORS.darkGray, fontStyle: 'italic', marginBottom: '12px' }}>
              通知先メールが未登録です
            </p>
          )}

          {/* 新規追加フォーム */}
          <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 200px' }}>
              <label style={{ fontSize: '12px', color: COLORS.darkGray, display: 'block', marginBottom: '2px' }}>
                メールアドレス
              </label>
              <input
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="example@company.com"
                style={{ ...styles.input, fontSize: '13px', padding: '6px 8px' }}
                onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
              />
            </div>
            <div style={{ flex: '0 1 150px' }}>
              <label style={{ fontSize: '12px', color: COLORS.darkGray, display: 'block', marginBottom: '2px' }}>
                ラベル（任意）
              </label>
              <input
                type="text"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="担当者名等"
                style={{ ...styles.input, fontSize: '13px', padding: '6px 8px' }}
                onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
              />
            </div>
            <button
              onClick={handleAdd}
              disabled={adding || !newEmail.trim()}
              style={{
                ...styles.primaryButton,
                fontSize: '13px',
                padding: '6px 12px',
                whiteSpace: 'nowrap',
                opacity: adding || !newEmail.trim() ? 0.5 : 1,
              }}
            >
              {adding ? '追加中...' : '追加'}
            </button>
          </div>

          {error && (
            <p style={{ color: COLORS.danger, fontSize: '12px', marginTop: '4px' }}>{error}</p>
          )}
        </>
      )}
    </div>
  )
}
