/**
 * EmailLogsPage — 送信ログ一覧・手動再送 画面
 * 仕様書 v1.0 F-4/F-5
 */
import { useState, useEffect, useCallback } from 'react'
import { COLORS } from '../../constants/admin'
import { styles } from '../../styles/adminStyles'

interface EmailLog {
  id: string
  report_id: string
  company_id: string | null
  recipient_email: string
  recipient_type: string
  status: string
  error_message: string | null
  retry_count: number
  sent_at: string | null
  created_at: string
  company_name: string | null
  work_date: string | null
  work_name: string | null
}

export function EmailLogsPage() {
  const [logs, setLogs] = useState<EmailLog[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('')
  const [resendingId, setResendingId] = useState<string | null>(null)

  const fetchLogs = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ limit: '50' })
      if (statusFilter) params.set('status', statusFilter)
      const res = await fetch(`/api/admin/email-logs?${params}`, { credentials: 'include' })
      if (res.ok) {
        const data = await res.json()
        setLogs(data.logs || [])
        setTotal(data.total || 0)
      }
    } catch (err) {
      console.error('Failed to fetch email logs:', err)
    } finally {
      setLoading(false)
    }
  }, [statusFilter])

  useEffect(() => {
    fetchLogs()
  }, [fetchLogs])

  const handleResend = async (logId: string) => {
    if (!confirm('このメールを再送信しますか？')) return
    setResendingId(logId)
    try {
      const res = await fetch(`/api/admin/email-logs/${logId}/resend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      })
      const data = await res.json()
      if (data.success) {
        alert('再送信が完了しました')
        await fetchLogs()
      } else {
        alert(`再送信に失敗しました: ${data.error || '不明なエラー'}`)
      }
    } catch (err) {
      alert('通信エラーが発生しました')
    } finally {
      setResendingId(null)
    }
  }

  const statusBadge = (status: string) => {
    const colors: Record<string, { bg: string; text: string }> = {
      sent: { bg: '#d4edda', text: '#155724' },
      failed: { bg: '#f8d7da', text: '#721c24' },
      pending: { bg: '#fff3cd', text: '#856404' },
      skipped: { bg: '#e2e3e5', text: '#383d41' },
    }
    const c = colors[status] || colors.skipped
    return (
      <span
        style={{
          display: 'inline-block',
          padding: '2px 8px',
          borderRadius: '12px',
          fontSize: '11px',
          fontWeight: 600,
          backgroundColor: c.bg,
          color: c.text,
        }}
      >
        {status === 'sent' ? '送信済' : status === 'failed' ? '失敗' : status === 'pending' ? '処理中' : 'スキップ'}
      </span>
    )
  }

  const recipientTypeName = (type: string) => {
    switch (type) {
      case 'client': return '取引先'
      case 'writer': return '記入者'
      case 'admin': return '管理者'
      default: return type
    }
  }

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '-'
    const d = new Date(dateStr)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }

  return (
    <div>
      <h2 style={styles.pageTitle}>メール送信ログ</h2>
      <p style={styles.description}>
        報告書承認時のメール送信履歴です。失敗した送信は手動で再送できます。
      </p>

      {/* フィルター */}
      <div style={{ marginBottom: '16px', display: 'flex', gap: '8px', alignItems: 'center' }}>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          style={{ ...styles.input, width: '150px', fontSize: '13px' }}
        >
          <option value="">すべて</option>
          <option value="sent">送信済</option>
          <option value="failed">失敗</option>
          <option value="pending">処理中</option>
          <option value="skipped">スキップ</option>
        </select>
        <span style={{ fontSize: '13px', color: COLORS.darkGray }}>{total}件</span>
      </div>

      {loading ? (
        <p>読み込み中...</p>
      ) : logs.length === 0 ? (
        <p style={styles.emptyMessage}>送信ログはありません</p>
      ) : (
        <div style={styles.tableContainer}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>日時</th>
                <th style={styles.th}>状態</th>
                <th style={styles.th}>種別</th>
                <th style={styles.th}>宛先</th>
                <th style={styles.th}>会社名</th>
                <th style={styles.th}>作業名</th>
                <th style={styles.th}>実施日</th>
                <th style={styles.th}>リトライ</th>
                <th style={styles.th}>操作</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id} style={styles.tr}>
                  <td style={{ ...styles.td, fontSize: '12px', whiteSpace: 'nowrap' }}>
                    {formatDate(log.sent_at || log.created_at)}
                  </td>
                  <td style={styles.td}>{statusBadge(log.status)}</td>
                  <td style={{ ...styles.td, fontSize: '12px' }}>{recipientTypeName(log.recipient_type)}</td>
                  <td style={{ ...styles.td, fontSize: '12px' }}>{log.recipient_email}</td>
                  <td style={{ ...styles.td, fontSize: '12px' }}>{log.company_name || '-'}</td>
                  <td style={{ ...styles.td, fontSize: '12px' }}>{log.work_name || '-'}</td>
                  <td style={{ ...styles.td, fontSize: '12px', whiteSpace: 'nowrap' }}>
                    {log.work_date ? String(log.work_date).split('T')[0] : '-'}
                  </td>
                  <td style={{ ...styles.td, textAlign: 'center', fontSize: '12px' }}>{log.retry_count}</td>
                  <td style={styles.td}>
                    {log.status === 'failed' && (
                      <button
                        onClick={() => handleResend(log.id)}
                        disabled={resendingId === log.id}
                        style={{
                          ...styles.primaryButton,
                          fontSize: '11px',
                          padding: '3px 8px',
                          opacity: resendingId === log.id ? 0.5 : 1,
                        }}
                      >
                        {resendingId === log.id ? '再送中...' : '再送'}
                      </button>
                    )}
                    {log.error_message && (
                      <span
                        title={log.error_message}
                        style={{ cursor: 'help', marginLeft: '4px', fontSize: '12px' }}
                      >
                        ⚠️
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
