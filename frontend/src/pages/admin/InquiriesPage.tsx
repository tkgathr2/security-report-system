import { useState, useEffect } from 'react'
import { COLORS } from '../../constants/admin'
import { styles } from '../../styles/adminStyles'

interface Inquiry {
  id: string
  cast_user_id: string
  cast_email: string
  cast_name: string | null
  category: string
  message: string
  status: string
  has_screenshot: boolean
  created_at: string
}

interface InquiriesPageProps {
  isMobile: boolean
}

const CATEGORY_LABELS: Record<string, string> = {
  bug: 'バグ報告',
  unclear: 'わかりにくい点',
  other: 'その他',
}

const STATUS_LABELS: Record<string, string> = {
  new: '新規',
  read: '確認済',
  resolved: '対応済',
}

const STATUS_COLORS: Record<string, string> = {
  new: COLORS.danger,
  read: COLORS.warning,
  resolved: COLORS.success,
}

export function InquiriesPage({ isMobile }: InquiriesPageProps) {
  const [inquiries, setInquiries] = useState<Inquiry[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedInquiry, setSelectedInquiry] = useState<Inquiry | null>(null)
  const [updatingStatus, setUpdatingStatus] = useState(false)

  const fetchInquiries = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/inquiries', { credentials: 'include' })
      if (res.ok) {
        const data = await res.json()
        setInquiries(data.inquiries || [])
      }
    } catch {
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchInquiries()
  }, [])

  const handleStatusUpdate = async (id: string, status: string) => {
    setUpdatingStatus(true)
    try {
      const res = await fetch(`/api/admin/inquiries/${id}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ status }),
      })
      if (res.ok) {
        setInquiries(prev => prev.map(i => i.id === id ? { ...i, status } : i))
        if (selectedInquiry?.id === id) {
          setSelectedInquiry(prev => prev ? { ...prev, status } : null)
        }
      }
    } catch {
    } finally {
      setUpdatingStatus(false)
    }
  }

  const formatDateTime = (dateStr: string) => {
    if (!dateStr) return '-'
    return new Date(dateStr).toLocaleString('ja-JP')
  }

  const newCount = inquiries.filter(i => i.status === 'new').length

  if (selectedInquiry) {
    return (
      <div>
        <button style={styles.backButton} onClick={() => setSelectedInquiry(null)}>
          ← 一覧に戻る
        </button>
        <h2 style={styles.pageTitle}>問合せ詳細</h2>

        <div style={{ background: COLORS.white, borderRadius: '12px', padding: '24px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: '16px', marginBottom: '20px' }}>
            <div>
              <span style={{ fontSize: '13px', color: COLORS.darkGray }}>送信者</span>
              <div style={{ fontWeight: 'bold', color: COLORS.text }}>{selectedInquiry.cast_name || selectedInquiry.cast_email}</div>
              {selectedInquiry.cast_name && <div style={{ fontSize: '13px', color: COLORS.darkGray }}>{selectedInquiry.cast_email}</div>}
            </div>
            <div>
              <span style={{ fontSize: '13px', color: COLORS.darkGray }}>カテゴリ</span>
              <div style={{ fontWeight: 'bold', color: COLORS.text }}>{CATEGORY_LABELS[selectedInquiry.category] || selectedInquiry.category}</div>
            </div>
            <div>
              <span style={{ fontSize: '13px', color: COLORS.darkGray }}>日時</span>
              <div style={{ fontWeight: 'bold', color: COLORS.text }}>{formatDateTime(selectedInquiry.created_at)}</div>
            </div>
            <div>
              <span style={{ fontSize: '13px', color: COLORS.darkGray }}>ステータス</span>
              <div>
                <span style={{ ...styles.statusBadge, backgroundColor: STATUS_COLORS[selectedInquiry.status] || COLORS.darkGray }}>
                  {STATUS_LABELS[selectedInquiry.status] || selectedInquiry.status}
                </span>
              </div>
            </div>
          </div>

          <div style={{ background: COLORS.lightGray, borderRadius: '8px', padding: '16px', marginBottom: '20px', whiteSpace: 'pre-wrap' as const, lineHeight: '1.6' }}>
            {selectedInquiry.message}
          </div>

          {selectedInquiry.has_screenshot && (
            <div style={{ marginBottom: '20px' }}>
              <span style={{ fontSize: '13px', color: COLORS.darkGray, display: 'block', marginBottom: '8px' }}>スクリーンショット</span>
              <img
                src={`/api/admin/inquiries/${selectedInquiry.id}/screenshot`}
                alt="スクリーンショット"
                style={{ maxWidth: '100%', maxHeight: '500px', borderRadius: '8px', border: `1px solid ${COLORS.gray}` }}
              />
            </div>
          )}

          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' as const }}>
            {selectedInquiry.status !== 'read' && (
              <button
                style={{ ...styles.primaryButton, backgroundColor: COLORS.warning, opacity: updatingStatus ? 0.6 : 1 }}
                onClick={() => handleStatusUpdate(selectedInquiry.id, 'read')}
                disabled={updatingStatus}
              >
                確認済にする
              </button>
            )}
            {selectedInquiry.status !== 'resolved' && (
              <button
                style={{ ...styles.primaryButton, backgroundColor: COLORS.success, opacity: updatingStatus ? 0.6 : 1 }}
                onClick={() => handleStatusUpdate(selectedInquiry.id, 'resolved')}
                disabled={updatingStatus}
              >
                対応済にする
              </button>
            )}
            {selectedInquiry.status !== 'new' && (
              <button
                style={{ ...styles.secondaryButton, opacity: updatingStatus ? 0.6 : 1 }}
                onClick={() => handleStatusUpdate(selectedInquiry.id, 'new')}
                disabled={updatingStatus}
              >
                新規に戻す
              </button>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <h2 style={{ ...styles.pageTitle, margin: 0 }}>
          問合せ一覧
          {newCount > 0 && (
            <span style={{
              marginLeft: '12px',
              fontSize: '14px',
              background: COLORS.danger,
              color: COLORS.white,
              borderRadius: '20px',
              padding: '2px 10px',
              fontWeight: 500,
              verticalAlign: 'middle',
            }}>
              {newCount}件 未対応
            </span>
          )}
        </h2>
        <button style={styles.primaryButton} onClick={fetchInquiries} disabled={loading}>
          {loading ? '読込中...' : '更新'}
        </button>
      </div>

      {loading ? (
        <p style={{ textAlign: 'center' as const, color: COLORS.darkGray, padding: '40px' }}>読み込み中...</p>
      ) : inquiries.length === 0 ? (
        <p style={styles.emptyMessage}>問合せはまだありません</p>
      ) : isMobile ? (
        <div style={{ display: 'flex', flexDirection: 'column' as const, gap: '12px' }}>
          {inquiries.map(inquiry => (
            <div
              key={inquiry.id}
              style={{
                background: COLORS.white,
                borderRadius: '12px',
                padding: '16px',
                boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
                cursor: 'pointer',
                borderLeft: `4px solid ${STATUS_COLORS[inquiry.status] || COLORS.darkGray}`,
              }}
              onClick={() => setSelectedInquiry(inquiry)}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ ...styles.statusBadge, backgroundColor: STATUS_COLORS[inquiry.status] || COLORS.darkGray }}>
                  {STATUS_LABELS[inquiry.status] || inquiry.status}
                </span>
                <span style={{ fontSize: '12px', color: COLORS.darkGray }}>{formatDateTime(inquiry.created_at)}</span>
              </div>
              <div style={{ fontWeight: 'bold', color: COLORS.text, marginBottom: '4px' }}>
                {inquiry.cast_name || inquiry.cast_email}
              </div>
              <div style={{ fontSize: '13px', color: COLORS.darkGray, marginBottom: '4px' }}>
                {CATEGORY_LABELS[inquiry.category] || inquiry.category}
                {inquiry.has_screenshot && ' 📎'}
              </div>
              <div style={{ fontSize: '14px', color: COLORS.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>
                {inquiry.message}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ background: COLORS.white, borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
          <div style={styles.tableContainer}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>ステータス</th>
                  <th style={styles.th}>送信者</th>
                  <th style={styles.th}>カテゴリ</th>
                  <th style={styles.th}>メッセージ</th>
                  <th style={styles.th}>添付</th>
                  <th style={styles.th}>日時</th>
                </tr>
              </thead>
              <tbody>
                {inquiries.map(inquiry => (
                  <tr
                    key={inquiry.id}
                    style={{ ...styles.tr, cursor: 'pointer' }}
                    onClick={() => setSelectedInquiry(inquiry)}
                  >
                    <td style={styles.td}>
                      <span style={{ ...styles.statusBadge, backgroundColor: STATUS_COLORS[inquiry.status] || COLORS.darkGray }}>
                        {STATUS_LABELS[inquiry.status] || inquiry.status}
                      </span>
                    </td>
                    <td style={styles.td}>{inquiry.cast_name || inquiry.cast_email}</td>
                    <td style={styles.td}>{CATEGORY_LABELS[inquiry.category] || inquiry.category}</td>
                    <td style={{ ...styles.td, maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>
                      {inquiry.message}
                    </td>
                    <td style={styles.td}>{inquiry.has_screenshot ? '📎' : '-'}</td>
                    <td style={{ ...styles.td, whiteSpace: 'nowrap' as const }}>{formatDateTime(inquiry.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
