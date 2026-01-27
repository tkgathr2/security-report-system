import { useState, useEffect } from 'react'

type Screen = 'login' | 'csv' | 'projects' | 'reports'

interface AdminUser {
  id: string
  email: string
}

interface Project {
  id: string
  project_key: string
  client_name_raw: string
  work_date: string
  work_name: string
  location: string
  status: string
  unique_url: string
  url_expires_at: string
  created_at: string
  client_name: string | null
}

interface Report {
  id: string
  project_id: string
  supervisor_name: string
  writer_name: string
  weather: string
  status: string
  approved_at: string
  created_at: string
  pdf_generation_status: string
  pdf_size: number
  client_name_raw: string
  work_date: string
  work_name: string
  location: string
}

interface ImportResult {
  status: string
  message: string
  projects_created: number
  projects_updated: number
  casts_assigned: number
  rows_skipped: number
  pending_client_count: number
}

function App() {
  const [screen, setScreen] = useState<Screen>('login')
  const [admin, setAdmin] = useState<AdminUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  
  const [projects, setProjects] = useState<Project[]>([])
  const [reports, setReports] = useState<Report[]>([])
  const [importResult, setImportResult] = useState<ImportResult | null>(null)
  const [importing, setImporting] = useState(false)

  useEffect(() => {
    checkAuth()
  }, [])

  const checkAuth = async () => {
    try {
      const response = await fetch('/api/admin/me', {
        credentials: 'include'
      })
      if (response.ok) {
        const data = await response.json()
        setAdmin(data.admin)
        setScreen('csv')
      } else {
        setScreen('login')
      }
    } catch {
      setScreen('login')
    } finally {
      setLoading(false)
    }
  }

  const handleGoogleLogin = () => {
    window.location.href = '/api/admin/auth/google/start'
  }

  const handleLogout = async () => {
    try {
      await fetch('/api/admin/auth/logout', {
        method: 'POST',
        credentials: 'include'
      })
    } catch {
      // ignore
    }
    setAdmin(null)
    setScreen('login')
  }

  const fetchProjects = async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/admin/projects', {
        credentials: 'include'
      })
      if (!response.ok) throw new Error('Failed to fetch projects')
      const data = await response.json()
      setProjects(data.projects)
    } catch {
      setError('案件一覧の取得に失敗しました')
    } finally {
      setLoading(false)
    }
  }

  const fetchReports = async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/admin/reports', {
        credentials: 'include'
      })
      if (!response.ok) throw new Error('Failed to fetch reports')
      const data = await response.json()
      setReports(data.reports)
    } catch {
      setError('報告書一覧の取得に失敗しました')
    } finally {
      setLoading(false)
    }
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setImporting(true)
    setError(null)
    setImportResult(null)

    const formData = new FormData()
    formData.append('file', file)

    try {
      const response = await fetch('/api/admin/csv/import', {
        method: 'POST',
        credentials: 'include',
        body: formData
      })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.message || 'インポートに失敗しました')
      }
      setImportResult(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'インポートに失敗しました')
    } finally {
      setImporting(false)
      e.target.value = ''
    }
  }

  const handleDownloadPdf = (reportId: string) => {
    window.open(`/api/admin/reports/${reportId}/pdf`, '_blank')
  }

  const navigateTo = (newScreen: Screen) => {
    setScreen(newScreen)
    setError(null)
    if (newScreen === 'projects') fetchProjects()
    if (newScreen === 'reports') fetchReports()
  }

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '-'
    return new Date(dateStr).toLocaleDateString('ja-JP')
  }

  const formatDateTime = (dateStr: string) => {
    if (!dateStr) return '-'
    return new Date(dateStr).toLocaleString('ja-JP')
  }

  const getStatusLabel = (status: string) => {
    const labels: Record<string, string> = {
      'active': '有効',
      'pending_client': '会社未登録',
      'completed': '完了',
      'expired': '期限切れ'
    }
    return labels[status] || status
  }

  if (loading && screen === 'login') {
    return <div style={styles.container}><p>読み込み中...</p></div>
  }

  if (screen === 'login') {
    return (
      <div style={styles.container}>
        <div style={styles.loginBox}>
          <h1 style={styles.title}>デジタル警備報告書システム【ほうこちゃん】管理画面</h1>
          <p style={styles.subtitle}>管理者としてログインしてください</p>
          <button style={styles.googleButton} onClick={handleGoogleLogin}>
            Googleでログイン
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={styles.app}>
      <header style={styles.header}>
        <h1 style={styles.headerTitle}>デジタル警備報告書システム【ほうこちゃん】</h1>
        <div style={styles.headerRight}>
          <span style={styles.adminEmail}>{admin?.email}</span>
          <button style={styles.logoutButton} onClick={handleLogout}>ログアウト</button>
        </div>
      </header>

      <nav style={styles.nav}>
        <button 
          style={screen === 'csv' ? styles.navButtonActive : styles.navButton}
          onClick={() => navigateTo('csv')}
        >
          CSV取込
        </button>
        <button 
          style={screen === 'projects' ? styles.navButtonActive : styles.navButton}
          onClick={() => navigateTo('projects')}
        >
          案件一覧
        </button>
        <button 
          style={screen === 'reports' ? styles.navButtonActive : styles.navButton}
          onClick={() => navigateTo('reports')}
        >
          報告書一覧
        </button>
      </nav>

      <main style={styles.main}>
        {error && <div style={styles.error}>{error}</div>}

        {screen === 'csv' && (
          <div style={styles.section}>
            <h2>CSV取込</h2>
            <p>案件データのCSVファイルを選択してインポートします。</p>
            <input
              type="file"
              accept=".csv"
              onChange={handleFileUpload}
              disabled={importing}
              style={styles.fileInput}
            />
            {importing && <p>インポート中...</p>}
            {importResult && (
              <div style={styles.resultBox}>
                <h3>インポート結果</h3>
                <p>ステータス: {importResult.status}</p>
                <p>作成された案件: {importResult.projects_created}件</p>
                <p>更新された案件: {importResult.projects_updated}件</p>
                <p>割り当てられたキャスト: {importResult.casts_assigned}件</p>
                <p>スキップされた行: {importResult.rows_skipped}件</p>
                {importResult.pending_client_count > 0 && (
                  <p style={styles.warning}>
                    未登録会社: {importResult.pending_client_count}件（pending_client状態）
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {screen === 'projects' && (
          <div style={styles.section}>
            <h2>案件一覧</h2>
            {loading ? (
              <p>読み込み中...</p>
            ) : projects.length === 0 ? (
              <p>案件がありません</p>
            ) : (
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>実施日</th>
                    <th style={styles.th}>会社名</th>
                    <th style={styles.th}>作業名</th>
                    <th style={styles.th}>場所</th>
                    <th style={styles.th}>状態</th>
                    <th style={styles.th}>URL有効期限</th>
                  </tr>
                </thead>
                <tbody>
                  {projects.map(project => (
                    <tr key={project.id}>
                      <td style={styles.td}>{formatDate(project.work_date)}</td>
                      <td style={styles.td}>{project.client_name || project.client_name_raw}</td>
                      <td style={styles.td}>{project.work_name}</td>
                      <td style={styles.td}>{project.location}</td>
                      <td style={styles.td}>{getStatusLabel(project.status)}</td>
                      <td style={styles.td}>{formatDate(project.url_expires_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {screen === 'reports' && (
          <div style={styles.section}>
            <h2>報告書一覧</h2>
            {loading ? (
              <p>読み込み中...</p>
            ) : reports.length === 0 ? (
              <p>報告書がありません</p>
            ) : (
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>承認日時</th>
                    <th style={styles.th}>会社名</th>
                    <th style={styles.th}>実施日</th>
                    <th style={styles.th}>作業名</th>
                    <th style={styles.th}>監督者</th>
                    <th style={styles.th}>PDF</th>
                  </tr>
                </thead>
                <tbody>
                  {reports.map(report => (
                    <tr key={report.id}>
                      <td style={styles.td}>{formatDateTime(report.approved_at)}</td>
                      <td style={styles.td}>{report.client_name_raw}</td>
                      <td style={styles.td}>{formatDate(report.work_date)}</td>
                      <td style={styles.td}>{report.work_name}</td>
                      <td style={styles.td}>{report.supervisor_name}</td>
                      <td style={styles.td}>
                        {report.pdf_generation_status === 'success' ? (
                          <button 
                            style={styles.downloadButton}
                            onClick={() => handleDownloadPdf(report.id)}
                          >
                            ダウンロード ({Math.round(report.pdf_size / 1024)}KB)
                          </button>
                        ) : (
                          <span style={styles.pdfPending}>
                            {report.pdf_generation_status === 'pending' ? '生成中' : '未生成'}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </main>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: '100vh',
    backgroundColor: '#f5f5f5'
  },
  loginBox: {
    backgroundColor: 'white',
    padding: '40px',
    borderRadius: '8px',
    boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
    textAlign: 'center'
  },
  title: {
    margin: '0 0 10px 0',
    fontSize: '24px',
    color: '#333'
  },
  subtitle: {
    margin: '0 0 30px 0',
    color: '#666'
  },
  googleButton: {
    backgroundColor: '#4285f4',
    color: 'white',
    border: 'none',
    padding: '12px 24px',
    fontSize: '16px',
    borderRadius: '4px',
    cursor: 'pointer'
  },
  app: {
    minHeight: '100vh',
    backgroundColor: '#f5f5f5'
  },
  header: {
    backgroundColor: '#333',
    color: 'white',
    padding: '15px 20px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  headerTitle: {
    margin: 0,
    fontSize: '20px'
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: '15px'
  },
  adminEmail: {
    fontSize: '14px'
  },
  logoutButton: {
    backgroundColor: 'transparent',
    color: 'white',
    border: '1px solid white',
    padding: '6px 12px',
    borderRadius: '4px',
    cursor: 'pointer'
  },
  nav: {
    backgroundColor: 'white',
    padding: '10px 20px',
    borderBottom: '1px solid #ddd',
    display: 'flex',
    gap: '10px'
  },
  navButton: {
    backgroundColor: 'transparent',
    border: '1px solid #ddd',
    padding: '8px 16px',
    borderRadius: '4px',
    cursor: 'pointer'
  },
  navButtonActive: {
    backgroundColor: '#333',
    color: 'white',
    border: '1px solid #333',
    padding: '8px 16px',
    borderRadius: '4px',
    cursor: 'pointer'
  },
  main: {
    padding: '20px'
  },
  section: {
    backgroundColor: 'white',
    padding: '20px',
    borderRadius: '8px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
  },
  error: {
    backgroundColor: '#fee',
    color: '#c00',
    padding: '10px 15px',
    borderRadius: '4px',
    marginBottom: '20px'
  },
  fileInput: {
    display: 'block',
    margin: '20px 0'
  },
  resultBox: {
    backgroundColor: '#f0f8ff',
    padding: '15px',
    borderRadius: '4px',
    marginTop: '20px'
  },
  warning: {
    color: '#c60',
    fontWeight: 'bold'
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    marginTop: '15px'
  },
  th: {
    backgroundColor: '#f5f5f5',
    padding: '10px',
    textAlign: 'left',
    borderBottom: '2px solid #ddd',
    fontSize: '14px'
  },
  td: {
    padding: '10px',
    borderBottom: '1px solid #eee',
    fontSize: '14px'
  },
  downloadButton: {
    backgroundColor: '#4caf50',
    color: 'white',
    border: 'none',
    padding: '6px 12px',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '12px'
  },
  pdfPending: {
    color: '#999',
    fontSize: '12px'
  }
}

export default App
