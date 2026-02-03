import { useState, useEffect } from 'react'

// Company logo URL from kotsuyudo.com
const COMPANY_LOGO_URL = 'https://storage.googleapis.com/studio-design-asset-files/projects/9YWy6mwXOM/s-916x174_v-fs_webp_c479912b-ce1f-4198-95fa-49599e599ced_small.webp'

// Color palette (matching company HP kotsuyudo.com)
const COLORS = {
  primary: '#E67E22',
  primaryDark: '#D35400',
  secondary: '#2C3E50',
  secondaryLight: '#34495E',
  white: '#FFFFFF',
  lightGray: '#F8F9FA',
  gray: '#E9ECEF',
  darkGray: '#6C757D',
  text: '#333333',
  success: '#27AE60',
  warning: '#F39C12',
  danger: '#E74C3C',
}

type Screen = 'dashboard' | 'csv' | 'projects' | 'reports' | 'staff'

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

interface StaffMember {
  id: string
  display_name_kanji: string
  display_name_kana: string
  created_at: string
  updated_at: string
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

interface DashboardStats {
  total_projects: number
  active_projects: number
  total_reports: number
  pending_reports: number
  total_staff: number
}

function AdminApp() {
  const [screen, setScreen] = useState<Screen>('dashboard')
  const [admin, setAdmin] = useState<AdminUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  
  const [projects, setProjects] = useState<Project[]>([])
  const [reports, setReports] = useState<Report[]>([])
  const [staff, setStaff] = useState<StaffMember[]>([])
  const [importResult, setImportResult] = useState<ImportResult | null>(null)
  const [importing, setImporting] = useState(false)
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [showStaffModal, setShowStaffModal] = useState(false)
  const [newStaff, setNewStaff] = useState({ display_name_kanji: '', display_name_kana: '' })
  const [creating, setCreating] = useState(false)
  const [staffImporting, setStaffImporting] = useState(false)
  const [staffImportResult, setStaffImportResult] = useState<{ inserted: number; updated: number; skipped: number } | null>(null)
  const [isDragging, setIsDragging] = useState(false)

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
        fetchDashboardStats()
      }
    } catch {
      // ignore
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
  }

  const fetchDashboardStats = async () => {
    try {
      const [projectsRes, reportsRes, staffRes] = await Promise.all([
        fetch('/api/admin/projects', { credentials: 'include' }),
        fetch('/api/admin/reports', { credentials: 'include' }),
        fetch('/api/admin/staff', { credentials: 'include' })
      ])
      
      const projectsData = projectsRes.ok ? await projectsRes.json() : { projects: [] }
      const reportsData = reportsRes.ok ? await reportsRes.json() : { reports: [] }
      const staffData = staffRes.ok ? await staffRes.json() : { staff: [] }
      
      setStats({
        total_projects: projectsData.projects?.length || 0,
        active_projects: projectsData.projects?.filter((p: Project) => p.status === 'active').length || 0,
        total_reports: reportsData.reports?.length || 0,
        pending_reports: reportsData.reports?.filter((r: Report) => r.pdf_generation_status === 'pending').length || 0,
        total_staff: staffData.staff?.length || 0
      })
    } catch {
      // ignore
    }
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

  const fetchStaff = async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/admin/staff', {
        credentials: 'include'
      })
      if (!response.ok) throw new Error('Failed to fetch staff')
      const data = await response.json()
      setStaff(data.staff || [])
    } catch {
      setError('スタッフ一覧の取得に失敗しました')
    } finally {
      setLoading(false)
    }
  }

  const handleCreateStaff = async () => {
    if (!newStaff.display_name_kanji.trim() || !newStaff.display_name_kana.trim()) {
      setError('氏名（漢字）と氏名（カナ）を入力してください')
      return
    }

    setCreating(true)
    setError(null)

    try {
      const response = await fetch('/api/admin/staff', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newStaff)
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.message || '登録に失敗しました')
      }

      setShowStaffModal(false)
      setNewStaff({ display_name_kanji: '', display_name_kana: '' })
      fetchStaff()
    } catch (err) {
      setError(err instanceof Error ? err.message : '登録に失敗しました')
    } finally {
      setCreating(false)
    }
  }

  const handleStaffCsvImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setStaffImporting(true)
    setError(null)
    setStaffImportResult(null)

    const formData = new FormData()
    formData.append('file', file)

    try {
      const response = await fetch('/api/admin/staff/import', {
        method: 'POST',
        credentials: 'include',
        body: formData
      })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.message || 'インポートに失敗しました')
      }
      setStaffImportResult(data)
      fetchStaff()
      fetchDashboardStats()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'インポートに失敗しました')
    } finally {
      setStaffImporting(false)
      e.target.value = ''
    }
  }

  const uploadCsvFile = async (file: File) => {
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
      fetchDashboardStats()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'インポートに失敗しました')
    } finally {
      setImporting(false)
    }
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    await uploadCsvFile(file)
    e.target.value = ''
  }

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)

    const files = e.dataTransfer.files
    if (files.length > 0) {
      const file = files[0]
      if (file.name.endsWith('.csv')) {
        await uploadCsvFile(file)
      } else {
        setError('CSVファイルのみアップロードできます')
      }
    }
  }

  const handleDownloadPdf = (reportId: string) => {
    window.open(`/api/admin/reports/${reportId}/pdf`, '_blank')
  }

  const navigateTo = (newScreen: Screen) => {
    setScreen(newScreen)
    setError(null)
    if (newScreen === 'dashboard') fetchDashboardStats()
    if (newScreen === 'projects') fetchProjects()
    if (newScreen === 'reports') fetchReports()
    if (newScreen === 'staff') fetchStaff()
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

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      'active': COLORS.success,
      'pending_client': COLORS.warning,
      'completed': COLORS.primary,
      'expired': COLORS.darkGray
    }
    return colors[status] || COLORS.darkGray
  }

  if (loading && !admin) {
    return (
      <div style={styles.loadingContainer}>
        <p>読み込み中...</p>
      </div>
    )
  }

  if (!admin) {
    return (
      <div style={styles.loginContainer}>
        <div style={styles.loginBox}>
          <div style={styles.loginLogo}>
            <img src={COMPANY_LOGO_URL} alt="日本交通誘導" style={styles.loginLogoImage} />
          </div>
          <h2 style={styles.loginSubtitle}>デジタル警備報告書システム<br />【ほうこちゃん】</h2>
          <p style={styles.loginDesc}>管理者としてログインしてください</p>
          <button style={styles.googleButton} onClick={handleGoogleLogin}>
            <svg style={styles.googleIcon} viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            Googleでログイン
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={styles.app}>
      {/* Header */}
      <header style={styles.header}>
        <div style={styles.headerLeft}>
          <button style={styles.menuButton} onClick={() => setSidebarOpen(!sidebarOpen)}>
            &#9776;
          </button>
                    <div style={styles.headerLogo}>
                      <img src={COMPANY_LOGO_URL} alt="日本交通誘導" style={styles.headerLogoImage} />
                    </div>
        </div>
        <div style={styles.headerRight}>
          <span style={styles.adminEmail}>{admin?.email}</span>
          <button style={styles.logoutButton} onClick={handleLogout}>ログアウト</button>
        </div>
      </header>

      <div style={styles.body}>
        {/* Sidebar */}
        <aside style={{...styles.sidebar, ...(sidebarOpen ? {} : styles.sidebarClosed)}}>
          <nav style={styles.sidebarNav}>
            <button 
              style={screen === 'dashboard' ? styles.sidebarItemActive : styles.sidebarItem}
              onClick={() => navigateTo('dashboard')}
            >
              <span style={styles.sidebarIcon}>&#128202;</span>
              <span style={styles.sidebarText}>ダッシュボード</span>
            </button>
            <button 
              style={screen === 'csv' ? styles.sidebarItemActive : styles.sidebarItem}
              onClick={() => navigateTo('csv')}
            >
              <span style={styles.sidebarIcon}>&#128193;</span>
              <span style={styles.sidebarText}>CSV取込</span>
            </button>
            <button 
              style={screen === 'projects' ? styles.sidebarItemActive : styles.sidebarItem}
              onClick={() => navigateTo('projects')}
            >
              <span style={styles.sidebarIcon}>&#128203;</span>
              <span style={styles.sidebarText}>案件一覧</span>
            </button>
            <button 
              style={screen === 'reports' ? styles.sidebarItemActive : styles.sidebarItem}
              onClick={() => navigateTo('reports')}
            >
              <span style={styles.sidebarIcon}>&#128196;</span>
              <span style={styles.sidebarText}>報告書一覧</span>
            </button>
            <button 
              style={screen === 'staff' ? styles.sidebarItemActive : styles.sidebarItem}
              onClick={() => navigateTo('staff')}
            >
              <span style={styles.sidebarIcon}>&#128101;</span>
              <span style={styles.sidebarText}>スタッフ管理</span>
            </button>
          </nav>
        </aside>

        {/* Main Content */}
        <main style={styles.main}>
          {error && <div style={styles.error}>{error}</div>}

          {/* Dashboard */}
          {screen === 'dashboard' && (
            <div>
              <h2 style={styles.pageTitle}>ダッシュボード</h2>
              <div style={styles.statsGrid}>
                <div style={styles.statCard} onClick={() => navigateTo('projects')}>
                  <div style={styles.statIcon}>&#128203;</div>
                  <div style={styles.statContent}>
                    <div style={styles.statValue}>{stats?.total_projects || 0}</div>
                    <div style={styles.statLabel}>総案件数</div>
                  </div>
                </div>
                <div style={{...styles.statCard, ...styles.statCardActive}} onClick={() => navigateTo('projects')}>
                  <div style={styles.statIcon}>&#9989;</div>
                  <div style={styles.statContent}>
                    <div style={styles.statValue}>{stats?.active_projects || 0}</div>
                    <div style={styles.statLabel}>有効な案件</div>
                  </div>
                </div>
                <div style={styles.statCard} onClick={() => navigateTo('reports')}>
                  <div style={styles.statIcon}>&#128196;</div>
                  <div style={styles.statContent}>
                    <div style={styles.statValue}>{stats?.total_reports || 0}</div>
                    <div style={styles.statLabel}>報告書数</div>
                  </div>
                </div>
                <div style={styles.statCard} onClick={() => navigateTo('staff')}>
                  <div style={styles.statIcon}>&#128101;</div>
                  <div style={styles.statContent}>
                    <div style={styles.statValue}>{stats?.total_staff || 0}</div>
                    <div style={styles.statLabel}>スタッフ数</div>
                  </div>
                </div>
              </div>

              <div style={styles.quickActions}>
                <h3 style={styles.sectionTitle}>クイックアクション</h3>
                <div style={styles.actionButtons}>
                  <button style={styles.actionButton} onClick={() => navigateTo('csv')}>
                    <span style={styles.actionIcon}>&#128193;</span>
                    CSVをインポート
                  </button>
                  <button style={styles.actionButton} onClick={() => navigateTo('reports')}>
                    <span style={styles.actionIcon}>&#128196;</span>
                    報告書を確認
                  </button>
                  <button style={styles.actionButton} onClick={() => navigateTo('staff')}>
                    <span style={styles.actionIcon}>&#128101;</span>
                    スタッフを管理
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* CSV Import */}
          {screen === 'csv' && (
            <div>
              <h2 style={styles.pageTitle}>CSV取込</h2>
              <div style={styles.card}>
                <h3 style={styles.cardTitle}>案件データのインポート</h3>
                <p style={styles.cardDesc}>案件データのCSVファイルを選択またはドラッグ＆ドロップしてインポートします。</p>
                <div 
                  style={{
                    ...styles.uploadArea,
                    ...(isDragging ? styles.uploadAreaDragging : {})
                  }}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                >
                  <input
                    type="file"
                    accept=".csv"
                    onChange={handleFileUpload}
                    disabled={importing}
                    style={styles.fileInput}
                    id="csv-upload"
                  />
                  <label htmlFor="csv-upload" style={styles.uploadLabel}>
                    <span style={styles.uploadIcon}>{isDragging ? '&#128229;' : '&#128193;'}</span>
                    <span>{importing ? 'インポート中...' : (isDragging ? 'ここにドロップ' : 'CSVファイルを選択またはドラッグ＆ドロップ')}</span>
                  </label>
                </div>
                {importResult && (
                  <div style={styles.resultBox}>
                    <h4 style={styles.resultTitle}>インポート結果</h4>
                    <div style={styles.resultGrid}>
                      <div style={styles.resultItem}>
                        <span style={styles.resultLabel}>作成された案件</span>
                        <span style={styles.resultValue}>{importResult.projects_created}件</span>
                      </div>
                      <div style={styles.resultItem}>
                        <span style={styles.resultLabel}>更新された案件</span>
                        <span style={styles.resultValue}>{importResult.projects_updated}件</span>
                      </div>
                      <div style={styles.resultItem}>
                        <span style={styles.resultLabel}>割り当てられたキャスト</span>
                        <span style={styles.resultValue}>{importResult.casts_assigned}件</span>
                      </div>
                      <div style={styles.resultItem}>
                        <span style={styles.resultLabel}>スキップされた行</span>
                        <span style={styles.resultValue}>{importResult.rows_skipped}件</span>
                      </div>
                    </div>
                    {importResult.pending_client_count > 0 && (
                      <div style={styles.warningBox}>
                        未登録会社: {importResult.pending_client_count}件（pending_client状態）
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Projects List */}
          {screen === 'projects' && (
            <div>
              <h2 style={styles.pageTitle}>案件一覧</h2>
              <div style={styles.card}>
                {loading ? (
                  <p>読み込み中...</p>
                ) : projects.length === 0 ? (
                  <p style={styles.emptyMessage}>案件がありません</p>
                ) : (
                  <div style={styles.tableContainer}>
                    <table style={styles.table}>
                      <thead>
                        <tr>
                          <th style={styles.th}>実施日</th>
                          <th style={styles.th}>会社名</th>
                          <th style={styles.th}>作業名</th>
                          <th style={styles.th}>場所</th>
                          <th style={styles.th}>状態</th>
                          <th style={styles.th}>URL有効期限</th>
                          <th style={styles.th}>操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {projects.map(project => (
                          <tr key={project.id} style={styles.tr}>
                            <td style={styles.td}>{formatDate(project.work_date)}</td>
                            <td style={styles.td}>{project.client_name || project.client_name_raw}</td>
                            <td style={styles.td}>{project.work_name}</td>
                            <td style={styles.td}>{project.location}</td>
                            <td style={styles.td}>
                              <span style={{...styles.statusBadge, backgroundColor: getStatusColor(project.status)}}>
                                {getStatusLabel(project.status)}
                              </span>
                            </td>
                            <td style={styles.td}>{formatDate(project.url_expires_at)}</td>
                            <td style={styles.td}>
                              <div style={{ display: 'flex', gap: '8px' }}>
                                <button 
                                  style={styles.smallButton}
                                  onClick={() => {
                                    const url = `${window.location.origin}/report/${project.unique_url}`
                                    navigator.clipboard.writeText(url)
                                    alert('URLをコピーしました')
                                  }}
                                >
                                  URLコピー
                                </button>
                                <button 
                                  style={styles.linkButton}
                                  onClick={() => window.open(`/report/${project.unique_url}`, '_blank')}
                                >
                                  報告画面
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Reports List */}
          {screen === 'reports' && (
            <div>
              <h2 style={styles.pageTitle}>報告書一覧</h2>
              <div style={styles.card}>
                {loading ? (
                  <p>読み込み中...</p>
                ) : reports.length === 0 ? (
                  <p style={styles.emptyMessage}>報告書がありません</p>
                ) : (
                  <div style={styles.tableContainer}>
                    <table style={styles.table}>
                      <thead>
                        <tr>
                          <th style={styles.th}>承認日時</th>
                          <th style={styles.th}>会社名</th>
                          <th style={styles.th}>実施日</th>
                          <th style={styles.th}>作業名</th>
                          <th style={styles.th}>監督者</th>
                          <th style={styles.th}>記入者</th>
                          <th style={styles.th}>PDF</th>
                        </tr>
                      </thead>
                      <tbody>
                        {reports.map(report => (
                          <tr key={report.id} style={styles.tr}>
                            <td style={styles.td}>{formatDateTime(report.approved_at)}</td>
                            <td style={styles.td}>{report.client_name_raw}</td>
                            <td style={styles.td}>{formatDate(report.work_date)}</td>
                            <td style={styles.td}>{report.work_name}</td>
                            <td style={styles.td}>{report.supervisor_name}</td>
                            <td style={styles.td}>{report.writer_name}</td>
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
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Staff Management */}
          {screen === 'staff' && (
            <div>
              <div style={styles.pageHeader}>
                <h2 style={{...styles.pageTitle, margin: 0}}>スタッフ管理</h2>
                <div style={{ display: 'flex', gap: '12px' }}>
                  <label style={styles.secondaryButton}>
                    <input
                      type="file"
                      accept=".csv"
                      onChange={handleStaffCsvImport}
                      disabled={staffImporting}
                      style={{ display: 'none' }}
                    />
                    {staffImporting ? 'インポート中...' : 'CSVインポート'}
                  </label>
                  <button style={styles.primaryButton} onClick={() => setShowStaffModal(true)}>
                    + 新規登録
                  </button>
                </div>
              </div>

              {/* Staff Import Result */}
              {staffImportResult && (
                <div style={styles.staffImportResult}>
                  <span style={styles.staffImportResultText}>
                    インポート完了: 追加 {staffImportResult.inserted}件、更新 {staffImportResult.updated}件、スキップ {staffImportResult.skipped}件
                  </span>
                  <button
                    style={styles.staffImportResultClose}
                    onClick={() => setStaffImportResult(null)}
                  >
                    ×
                  </button>
                </div>
              )}

              <div style={styles.card}>
                {loading ? (
                  <p>読み込み中...</p>
                ) : staff.length === 0 ? (
                  <p style={styles.emptyMessage}>スタッフが登録されていません</p>
                ) : (
                  <div style={styles.tableContainer}>
                    <table style={styles.table}>
                      <thead>
                        <tr>
                          <th style={styles.th}>氏名（漢字）</th>
                          <th style={styles.th}>氏名（カナ）</th>
                          <th style={styles.th}>登録日</th>
                        </tr>
                      </thead>
                      <tbody>
                        {staff.map(member => (
                          <tr key={member.id} style={styles.tr}>
                            <td style={styles.td}>{member.display_name_kanji}</td>
                            <td style={styles.td}>{member.display_name_kana}</td>
                            <td style={styles.td}>{formatDate(member.created_at)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* New Staff Modal */}
              {showStaffModal && (
                <div style={styles.modalOverlay} onClick={() => setShowStaffModal(false)}>
                  <div style={styles.modal} onClick={e => e.stopPropagation()}>
                    <h3 style={styles.modalTitle}>スタッフ新規登録</h3>
                    <div style={styles.formGroup}>
                      <label style={styles.label}>氏名（漢字）</label>
                      <input
                        type="text"
                        style={styles.input}
                        value={newStaff.display_name_kanji}
                        onChange={e => setNewStaff({ ...newStaff, display_name_kanji: e.target.value })}
                        placeholder="例：山田 太郎"
                      />
                    </div>
                    <div style={styles.formGroup}>
                      <label style={styles.label}>氏名（カナ）</label>
                      <input
                        type="text"
                        style={styles.input}
                        value={newStaff.display_name_kana}
                        onChange={e => setNewStaff({ ...newStaff, display_name_kana: e.target.value })}
                        placeholder="例：ヤマダ タロウ"
                      />
                    </div>
                    <div style={styles.modalActions}>
                      <button
                        style={styles.cancelButton}
                        onClick={() => setShowStaffModal(false)}
                        disabled={creating}
                      >
                        キャンセル
                      </button>
                      <button
                        style={styles.primaryButton}
                        onClick={handleCreateStaff}
                        disabled={creating}
                      >
                        {creating ? '登録中...' : '登録'}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  loadingContainer: {
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: '100vh',
    backgroundColor: COLORS.lightGray
  },
  loginContainer: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: '100vh',
    backgroundColor: COLORS.secondary,
    backgroundImage: 'linear-gradient(135deg, #2C3E50 0%, #34495E 100%)'
  },
  loginBox: {
    backgroundColor: COLORS.white,
    padding: '50px 40px',
    borderRadius: '12px',
    boxShadow: '0 10px 40px rgba(0,0,0,0.2)',
    textAlign: 'center',
    maxWidth: '400px',
    width: '90%'
  },
    loginLogo: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: '20px'
    },
    loginLogoImage: {
      maxWidth: '280px',
      height: 'auto'
    },
  loginSubtitle: {
    margin: '0 0 10px 0',
    fontSize: '18px',
    color: COLORS.primary,
    fontWeight: 500
  },
  loginDesc: {
    margin: '0 0 30px 0',
    color: COLORS.darkGray,
    fontSize: '14px'
  },
  googleButton: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '12px',
    width: '100%',
    backgroundColor: COLORS.white,
    color: COLORS.text,
    border: `1px solid ${COLORS.gray}`,
    padding: '14px 24px',
    fontSize: '16px',
    borderRadius: '8px',
    cursor: 'pointer',
    fontWeight: 500
  },
  googleIcon: {
    width: '20px',
    height: '20px'
  },
  app: {
    minHeight: '100vh',
    backgroundColor: COLORS.lightGray,
    display: 'flex',
    flexDirection: 'column'
  },
  header: {
    backgroundColor: COLORS.secondary,
    color: COLORS.white,
    padding: '0 20px',
    height: '60px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '15px'
  },
  menuButton: {
    backgroundColor: 'transparent',
    border: 'none',
    color: COLORS.white,
    fontSize: '24px',
    cursor: 'pointer',
    padding: '5px 10px'
  },
    headerLogo: {
      display: 'flex',
      alignItems: 'center'
    },
    headerLogoImage: {
      height: '36px',
      width: 'auto'
    },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: '15px'
  },
  adminEmail: {
    fontSize: '14px',
    opacity: 0.9
  },
  logoutButton: {
    backgroundColor: 'transparent',
    color: COLORS.white,
    border: '1px solid rgba(255,255,255,0.3)',
    padding: '8px 16px',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '14px'
  },
  body: {
    display: 'flex',
    flex: 1
  },
  sidebar: {
    width: '240px',
    backgroundColor: COLORS.white,
    borderRight: `1px solid ${COLORS.gray}`,
    transition: 'width 0.3s',
    overflow: 'hidden'
  },
  sidebarClosed: {
    width: '0px'
  },
  sidebarNav: {
    padding: '20px 0'
  },
  sidebarItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    width: '100%',
    padding: '14px 20px',
    backgroundColor: 'transparent',
    border: 'none',
    cursor: 'pointer',
    fontSize: '15px',
    color: COLORS.text,
    textAlign: 'left' as const
  },
  sidebarItemActive: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    width: '100%',
    padding: '14px 20px',
    backgroundColor: COLORS.primary,
    border: 'none',
    cursor: 'pointer',
    fontSize: '15px',
    color: COLORS.white,
    textAlign: 'left' as const,
    borderLeft: `4px solid ${COLORS.primaryDark}`
  },
  sidebarIcon: {
    fontSize: '18px'
  },
  sidebarText: {
    fontWeight: 500
  },
  main: {
    flex: 1,
    padding: '24px',
    overflowY: 'auto' as const
  },
  pageTitle: {
    margin: '0 0 24px 0',
    fontSize: '24px',
    color: COLORS.secondary,
    fontWeight: 'bold'
  },
  sectionTitle: {
    margin: '0 0 16px 0',
    fontSize: '18px',
    color: COLORS.secondary,
    fontWeight: 600
  },
  error: {
    backgroundColor: '#FEE2E2',
    color: COLORS.danger,
    padding: '12px 16px',
    borderRadius: '8px',
    marginBottom: '20px',
    border: `1px solid ${COLORS.danger}`
  },
  card: {
    backgroundColor: COLORS.white,
    padding: '24px',
    borderRadius: '12px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.05)'
  },
  cardTitle: {
    margin: '0 0 8px 0',
    fontSize: '18px',
    color: COLORS.secondary,
    fontWeight: 600
  },
  cardDesc: {
    margin: '0 0 20px 0',
    color: COLORS.darkGray,
    fontSize: '14px'
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: '20px',
    marginBottom: '30px'
  },
  statCard: {
    backgroundColor: COLORS.white,
    padding: '24px',
    borderRadius: '12px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
    cursor: 'pointer',
    border: '2px solid transparent'
  },
  statCardActive: {
    borderColor: COLORS.primary
  },
  statIcon: {
    fontSize: '32px'
  },
  statContent: {},
  statValue: {
    fontSize: '28px',
    fontWeight: 'bold',
    color: COLORS.secondary
  },
  statLabel: {
    fontSize: '14px',
    color: COLORS.darkGray
  },
  quickActions: {
    backgroundColor: COLORS.white,
    padding: '24px',
    borderRadius: '12px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.05)'
  },
  actionButtons: {
    display: 'flex',
    gap: '16px',
    flexWrap: 'wrap' as const
  },
  actionButton: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '14px 24px',
    backgroundColor: COLORS.primary,
    color: COLORS.white,
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '15px',
    fontWeight: 500
  },
  actionIcon: {
    fontSize: '18px'
  },
  uploadArea: {
    position: 'relative' as const,
    border: `2px dashed ${COLORS.gray}`,
    borderRadius: '12px',
    padding: '40px 20px',
    textAlign: 'center' as const,
    transition: 'all 0.3s ease',
    backgroundColor: COLORS.white
  },
  uploadAreaDragging: {
    borderColor: COLORS.primary,
    backgroundColor: `${COLORS.primary}10`,
    transform: 'scale(1.02)'
  },
  fileInput: {
    position: 'absolute' as const,
    opacity: 0,
    width: '100%',
    height: '100%',
    cursor: 'pointer'
  },
  uploadLabel: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    gap: '12px',
    padding: '40px',
    border: `2px dashed ${COLORS.gray}`,
    borderRadius: '12px',
    cursor: 'pointer',
    backgroundColor: COLORS.lightGray
  },
  uploadIcon: {
    fontSize: '48px'
  },
  resultBox: {
    marginTop: '24px',
    padding: '20px',
    backgroundColor: '#E8F5E9',
    borderRadius: '8px',
    border: `1px solid ${COLORS.success}`
  },
  resultTitle: {
    margin: '0 0 16px 0',
    fontSize: '16px',
    color: COLORS.success,
    fontWeight: 600
  },
  resultGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
    gap: '12px'
  },
  resultItem: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '4px'
  },
  resultLabel: {
    fontSize: '12px',
    color: COLORS.darkGray
  },
  resultValue: {
    fontSize: '18px',
    fontWeight: 'bold',
    color: COLORS.text
  },
  warningBox: {
    marginTop: '16px',
    padding: '12px',
    backgroundColor: '#FFF3E0',
    borderRadius: '6px',
    color: COLORS.warning,
    fontWeight: 500
  },
  tableContainer: {
    overflowX: 'auto' as const
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse' as const
  },
  th: {
    backgroundColor: COLORS.secondary,
    color: COLORS.white,
    padding: '14px 12px',
    textAlign: 'left' as const,
    fontSize: '14px',
    fontWeight: 600,
    whiteSpace: 'nowrap' as const
  },
  tr: {
    borderBottom: `1px solid ${COLORS.gray}`
  },
  td: {
    padding: '14px 12px',
    fontSize: '14px',
    color: COLORS.text
  },
  statusBadge: {
    display: 'inline-block',
    padding: '4px 10px',
    borderRadius: '20px',
    fontSize: '12px',
    fontWeight: 500,
    color: COLORS.white
  },
  smallButton: {
    padding: '6px 12px',
    backgroundColor: COLORS.secondary,
    color: COLORS.white,
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '12px'
  },
  linkButton: {
    padding: '6px 12px',
    backgroundColor: COLORS.primary,
    color: COLORS.white,
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '12px'
  },
  downloadButton: {
    backgroundColor: COLORS.primary,
    color: COLORS.white,
    border: 'none',
    padding: '8px 14px',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: 500
  },
  pdfPending: {
    color: COLORS.darkGray,
    fontSize: '13px'
  },
  emptyMessage: {
    textAlign: 'center' as const,
    color: COLORS.darkGray,
    padding: '40px'
  },
  pageHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '24px'
  },
  primaryButton: {
    backgroundColor: COLORS.primary,
    color: COLORS.white,
    border: 'none',
    padding: '12px 24px',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '15px',
    fontWeight: 500
  },
  modalOverlay: {
    position: 'fixed' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000
  },
  modal: {
    backgroundColor: COLORS.white,
    padding: '32px',
    borderRadius: '12px',
    width: '400px',
    maxWidth: '90%',
    boxShadow: '0 10px 40px rgba(0,0,0,0.2)'
  },
  modalTitle: {
    margin: '0 0 24px 0',
    fontSize: '20px',
    color: COLORS.secondary,
    fontWeight: 600
  },
  formGroup: {
    marginBottom: '20px'
  },
  label: {
    display: 'block',
    marginBottom: '8px',
    fontSize: '14px',
    fontWeight: 500,
    color: COLORS.text
  },
  input: {
    width: '100%',
    padding: '12px',
    fontSize: '15px',
    border: `1px solid ${COLORS.gray}`,
    borderRadius: '8px',
    boxSizing: 'border-box' as const
  },
  modalActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '12px',
    marginTop: '24px'
  },
  cancelButton: {
    backgroundColor: COLORS.white,
    color: COLORS.text,
    border: `1px solid ${COLORS.gray}`,
    padding: '12px 24px',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '15px'
  },
  secondaryButton: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.white,
    color: COLORS.secondary,
    border: `1px solid ${COLORS.secondary}`,
    padding: '12px 24px',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '15px',
    fontWeight: 500
  },
  staffImportResult: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#E8F5E9',
    border: `1px solid ${COLORS.success}`,
    borderRadius: '8px',
    padding: '12px 16px',
    marginBottom: '16px'
  },
  staffImportResultText: {
    color: COLORS.success,
    fontWeight: 500,
    fontSize: '14px'
  },
  staffImportResultClose: {
    backgroundColor: 'transparent',
    border: 'none',
    color: COLORS.success,
    fontSize: '20px',
    cursor: 'pointer',
    padding: '0 4px'
  }
}

export default AdminApp
