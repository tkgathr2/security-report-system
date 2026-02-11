import { useState, useEffect, useCallback } from 'react'
import './App.css'

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

type Screen = 'dashboard' | 'csv' | 'projects' | 'reports' | 'staff' | 'import_history' | 'clients' | 'cast_users'

interface AdminUser {
  id: string
  email: string
}

interface ProjectCast {
  staff_no: string
  cast_name: string
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
  casts?: ProjectCast[]
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
  email: string | null
  registered_email: string | null
  cast_user_id: string | null
  created_at: string
  updated_at: string
}

interface ImportResult {
  ok: boolean
  status: string
  created_projects_count: number
  existing_projects_count: number
  skipped_rows_count: number
  pending_client_rows_count: number
  staff_auto_added_count: number
  duplicate_cast_assignments: number
  errors: Array<{ row: number; reason: string }>
}

interface DashboardStats {
  total_projects: number
  active_projects: number
  total_reports: number
  pending_reports: number
  total_staff: number
}

interface CsvImportHistory {
  id: string
  imported_by_admin_email: string
  original_file_name: string
  detected_encoding: string
  status: string
  created_projects_count: number
  skipped_rows_count: number
  pending_client_rows_count: number
  errors_json: string
  created_at: string
}

interface Client {
  id: string
  name: string
  name_normalized: string
  emails: string[]
  is_active: boolean
  contact_name: string | null
  contact_title: string | null
  contact_email: string | null
  created_at: string
  updated_at: string
}

interface CastUser {
  id: string
  email: string
  name: string | null
  selected_staff_id: string | null
  selected_name_kanji: string | null
  staff_name_kanji: string | null
  staff_name_kana: string | null
  created_at: string
  updated_at: string
}

function AdminApp() {
  const [screen, setScreen] = useState<Screen>('dashboard')
  const [admin, setAdmin] = useState<AdminUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768)
  const [sidebarOpen, setSidebarOpen] = useState(window.innerWidth > 768)
  
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
    const [sortColumn, setSortColumn] = useState<keyof Project | null>(null)
    const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc')
    const [importHistory, setImportHistory] = useState<CsvImportHistory[]>([])
    const [selectedImport, setSelectedImport] = useState<CsvImportHistory | null>(null)
    const [importedProjects, setImportedProjects] = useState<Project[]>([])
    const [loadingImportProjects, setLoadingImportProjects] = useState(false)
        const [clients, setClients] = useState<Client[]>([])
        const [editingClient, setEditingClient] = useState<Client | null>(null)
        const [savingClient, setSavingClient] = useState(false)
                const [castUsers, setCastUsers] = useState<CastUser[]>([])
                const [editingCastUser, setEditingCastUser] = useState<CastUser | null>(null)
                const [savingCastUser, setSavingCastUser] = useState(false)
                const [editingStaff, setEditingStaff] = useState<StaffMember | null>(null)
                const [savingStaff, setSavingStaff] = useState(false)
                const [staffSearchQuery, setStaffSearchQuery] = useState('')
                const [castsModalProject, setCastsModalProject] = useState<Project | null>(null)

                // MVP: Single date navigation (no infinite scroll)
                const [selectedDate, setSelectedDate] = useState<string>(() => {
                  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' })
                })

          useEffect(() => {
      checkAuth()
    }, [])

    useEffect(() => {
      const handleResize = () => {
        const mobile = window.innerWidth <= 768
        setIsMobile(mobile)
        if (!mobile && !sidebarOpen) {
          setSidebarOpen(true)
        }
      }
      window.addEventListener('resize', handleResize)
      return () => window.removeEventListener('resize', handleResize)
    }, [sidebarOpen])

    const handleCtrlEnter = useCallback((e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault()
        if (showStaffModal && !creating) {
          handleCreateStaff()
        } else if (editingStaff && !savingStaff) {
          handleUpdateStaff()
        } else if (editingClient && !savingClient) {
          handleUpdateClient()
        } else if (editingCastUser && !savingCastUser) {
          handleUpdateCastUser()
        }
      }
    }, [showStaffModal, creating, editingStaff, savingStaff, editingClient, savingClient, editingCastUser, savingCastUser])

    useEffect(() => {
      document.addEventListener('keydown', handleCtrlEnter)
      return () => document.removeEventListener('keydown', handleCtrlEnter)
    }, [handleCtrlEnter])

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
      const [projectsRes, reportsRes, staffRes, clientsRes] = await Promise.all([
        fetch('/api/admin/projects', { credentials: 'include' }),
        fetch('/api/admin/reports', { credentials: 'include' }),
        fetch('/api/admin/staff', { credentials: 'include' }),
        fetch('/api/admin/clients', { credentials: 'include' })
      ])
      
      const projectsData = projectsRes.ok ? await projectsRes.json() : { projects: [] }
      const reportsData = reportsRes.ok ? await reportsRes.json() : { reports: [] }
      const staffData = staffRes.ok ? await staffRes.json() : { staff: [] }
      const clientsData = clientsRes.ok ? await clientsRes.json() : { clients: [] }
      
      setClients(clientsData.clients || [])
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

    const fetchProjectsByDate = async (dateStr: string) => {
      setLoading(true)
      setError(null)
      try {
        const response = await fetch(`/api/admin/projects?date=${dateStr}`, {
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

  const fetchReports= async () => {
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

  const fetchImportHistory = async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/admin/csv/imports', {
        credentials: 'include'
      })
      if (!response.ok) throw new Error('Failed to fetch import history')
      const data = await response.json()
      setImportHistory(data.imports || [])
    } catch {
      setError('インポート履歴の取得に失敗しました')
    } finally {
      setLoading(false)
    }
  }

  const fetchImportedProjects = async (importId: string) => {
    setLoadingImportProjects(true)
    try {
      const response = await fetch(`/api/admin/csv/imports/${importId}/projects`, {
        credentials: 'include'
      })
      if (!response.ok) throw new Error('Failed to fetch imported projects')
      const data = await response.json()
      setImportedProjects(data.projects || [])
    } catch {
      setError('インポート案件の取得に失敗しました')
    } finally {
      setLoadingImportProjects(false)
    }
  }

    const handleSelectImport = (importItem: CsvImportHistory) => {
      setSelectedImport(importItem)
      fetchImportedProjects(importItem.id)
    }

    const fetchClients = async () => {
      setLoading(true)
      setError(null)
      try {
        const response = await fetch('/api/admin/clients', {
          credentials: 'include'
        })
        if (!response.ok) throw new Error('Failed to fetch clients')
        const data = await response.json()
        setClients(data.clients || [])
      } catch {
        setError('会社一覧の取得に失敗しました')
      } finally {
        setLoading(false)
      }
    }

        const handleUpdateClient = async () => {
          if (!editingClient) return
          setSavingClient(true)
          setError(null)
          try {
            const response = await fetch(`/api/admin/clients/${editingClient.id}`, {
              method: 'PUT',
              credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                name: editingClient.name,
                contact_name: editingClient.contact_name,
                contact_title: editingClient.contact_title,
                contact_email: editingClient.contact_email,
                emails: editingClient.emails
              })
            })
            if (!response.ok) {
              const data = await response.json()
              throw new Error(data.message || '更新に失敗しました')
            }
            setEditingClient(null)
            fetchClients()
          } catch (err) {
            setError(err instanceof Error ? err.message : '更新に失敗しました')
          } finally {
            setSavingClient(false)
          }
        }

        const fetchCastUsers = async () => {
          setLoading(true)
          setError(null)
          try {
            const response = await fetch('/api/admin/cast-users', {
              credentials: 'include'
            })
            if (!response.ok) throw new Error('Failed to fetch cast users')
            const data = await response.json()
            setCastUsers(data.users || [])
          } catch {
            setError('キャスト一覧の取得に失敗しました')
          } finally {
            setLoading(false)
          }
        }

        const handleUpdateCastUser = async () => {
          if (!editingCastUser) return
          setSavingCastUser(true)
          setError(null)
          try {
            const response = await fetch(`/api/admin/cast-users/${editingCastUser.id}/name`, {
              method: 'PUT',
              credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                staff_name_kanji: editingCastUser.name,
                reason: '管理者による名前変更'
              })
            })
            if (!response.ok) {
              const data = await response.json()
              throw new Error(data.message || '更新に失敗しました')
            }
            setEditingCastUser(null)
            fetchCastUsers()
          } catch (err) {
            setError(err instanceof Error ? err.message : '更新に失敗しました')
          } finally {
            setSavingCastUser(false)
          }
        }

        const handleDeleteCastUser = async (userId: string, userEmail: string) => {
          if (!confirm(`${userEmail} を削除しますか？この操作は取り消せません。`)) return
          setError(null)
          try {
            const response = await fetch(`/api/admin/cast-users/${userId}`, {
              method: 'DELETE',
              credentials: 'include'
            })
            if (!response.ok) {
              const data = await response.json()
              throw new Error(data.message || '削除に失敗しました')
            }
            fetchCastUsers()
          } catch (err) {
            setError(err instanceof Error ? err.message : '削除に失敗しました')
          }
        }

        const handleDeleteProjectsWithoutCasts = async () => {
          if (!confirm('キャストがいない案件をすべて削除しますか？この操作は取り消せません。')) return
          setError(null)
          try {
            const response = await fetch('/api/admin/projects/without-casts', {
              method: 'DELETE',
              credentials: 'include'
            })
            if (!response.ok) {
              const data = await response.json()
              throw new Error(data.message || '削除に失敗しました')
            }
            const data = await response.json()
            alert(data.message)
            fetchProjectsByDate(selectedDate)
            fetchDashboardStats()
          } catch (err) {
            setError(err instanceof Error ? err.message : '削除に失敗しました')
          }
        }

          const handleCreateStaff= async () => {
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

    const handleUpdateStaff = async () => {
      if (!editingStaff) return
      setSavingStaff(true)
      setError(null)
      try {
        const response = await fetch(`/api/admin/staff/${editingStaff.id}`, {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            display_name_kanji: editingStaff.display_name_kanji,
            display_name_kana: editingStaff.display_name_kana,
            email: editingStaff.email
          })
        })
        if (!response.ok) {
          const data = await response.json()
          throw new Error(data.message || '更新に失敗しました')
        }
        setEditingStaff(null)
        fetchStaff()
      } catch (err) {
        setError(err instanceof Error ? err.message : '更新に失敗しました')
      } finally {
        setSavingStaff(false)
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
        // 形式エラーの場合、詳細情報を含めたエラーメッセージを表示
        if (data.error === 'CSV_FORMAT_INVALID' && data.details) {
          const emptyFields = data.details.empty_fields || data.details.missing_headers || []
          if (emptyFields.length > 0) {
            throw new Error(`${data.message} 以下の項目が入っていません: ${emptyFields.join(', ')}`)
          }
        }
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
                  setSelectedImport(null)
                  setImportedProjects([])
                  if (isMobile) setSidebarOpen(false)
                  if (newScreen === 'dashboard') fetchDashboardStats()
                  if (newScreen === 'projects') fetchProjectsByDate(selectedDate)
                  if (newScreen === 'reports') fetchReports()
                  if (newScreen === 'staff') fetchStaff()
                  if (newScreen === 'import_history') fetchImportHistory()
                  if (newScreen === 'clients') fetchClients()
                  if (newScreen === 'cast_users') fetchCastUsers()
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

  const handleSort = (column: keyof Project) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      setSortColumn(column)
      setSortDirection('asc')
    }
  }

  const sortedProjects = [...projects].sort((a, b) => {
    if (!sortColumn) return 0
    const aVal = a[sortColumn] ?? ''
    const bVal = b[sortColumn] ?? ''
    const comparison = String(aVal).localeCompare(String(bVal), 'ja')
    return sortDirection === 'asc' ? comparison : -comparison
  })

  const getSortIndicator = (column: keyof Project) => {
    if (sortColumn !== column) return ' ↕'
    return sortDirection === 'asc' ? ' ↑' : ' ↓'
  }

  const filteredStaff = staff.filter(member => {
    if (!staffSearchQuery.trim()) return true
    const query = staffSearchQuery.toLowerCase()
    return (
      member.display_name_kanji.toLowerCase().includes(query) ||
      member.display_name_kana.toLowerCase().includes(query) ||
      (member.email && member.email.toLowerCase().includes(query))
    )
  })

  const filteredProjects = sortedProjects

  // Group projects by date
  const projectsByDate = filteredProjects.reduce((acc, project) => {
    const date = project.work_date
    if (!acc[date]) {
      acc[date] = []
    }
    acc[date].push(project)
    return acc
  }, {} as Record<string, Project[]>)

  // Get sorted dates (ascending order)
  const sortedDates = Object.keys(projectsByDate).sort()
  
  // Get today's date in JST for highlighting
  const todayStr = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' })
  
  // Parse date parts for custom formatting
  const parseDateParts = (dateStr: string) => {
    const datePart = dateStr.split('T')[0]
    const [year, month, day] = datePart.split('-')
    const date = new Date(datePart + 'T12:00:00')
    const days = ['日', '月', '火', '水', '木', '金', '土']
    const dayOfWeek = days[date.getDay()]
    const isToday = datePart === todayStr
    const isWeekend = date.getDay() === 0 || date.getDay() === 6
    return { year, month, day, dayOfWeek, isToday, isWeekend, datePart }
  }
  
  // Render date header - Design 1: カレンダー風
  const renderDateHeader = (dateStr: string, count: number) => {
    const { year, month, day, dayOfWeek, isToday, isWeekend } = parseDateParts(dateStr)
    
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        padding: '12px 16px',
        backgroundColor: isToday ? COLORS.primary : (isWeekend ? '#fff5f5' : '#f8f9fa'),
        color: isToday ? 'white' : (isWeekend ? '#e53e3e' : COLORS.darkGray),
        borderRadius: '8px 8px 0 0',
        position: 'sticky',
        top: 0,
        zIndex: 10,
        gap: '16px'
      }}>
        <div style={{
          fontSize: '32px',
          fontWeight: 'bold',
          lineHeight: 1,
          minWidth: '50px',
          textAlign: 'center'
        }}>
          {day}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '14px', opacity: 0.8 }}>{year}年{parseInt(month)}月</div>
          <div style={{ fontSize: '16px', fontWeight: 'bold' }}>{dayOfWeek}曜日{isToday ? ' (今日)' : ''}</div>
        </div>
        <div style={{
          backgroundColor: isToday ? 'rgba(255,255,255,0.2)' : COLORS.primary,
          color: 'white',
          padding: '4px 12px',
          borderRadius: '16px',
          fontSize: '14px',
          fontWeight: 'bold'
        }}>
          {count}件
        </div>
      </div>
    )
  }

  // Date navigation helpers
  const navigateDate = (offset: number) => {
    const d = new Date(selectedDate + 'T12:00:00')
    d.setDate(d.getDate() + offset)
    const newDate = d.toISOString().split('T')[0]
    setSelectedDate(newDate)
    fetchProjectsByDate(newDate)
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
              {/* Mobile Overlay */}
              {isMobile && sidebarOpen && (
                <div 
                  style={styles.sidebarOverlay} 
                  onClick={() => setSidebarOpen(false)}
                />
              )}
                            {/* Sidebar */}
                            <aside style={{
                              ...styles.sidebar, 
                              ...(isMobile ? styles.sidebarMobile : {}),
                              ...(isMobile ? (sidebarOpen ? styles.sidebarMobileOpen : styles.sidebarMobileClosed) : (sidebarOpen ? {} : styles.sidebarClosed))
                            }}>
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
              <span style={styles.sidebarText}>キャスト管理</span>
            </button>
                    <button 
                      style={screen === 'import_history' ? styles.sidebarItemActive : styles.sidebarItem}
                      onClick={() => navigateTo('import_history')}
                    >
                      <span style={styles.sidebarIcon}>&#128197;</span>
                      <span style={styles.sidebarText}>インポート履歴</span>
                    </button>
                                      <button 
                                        style={screen === 'clients' ? styles.sidebarItemActive : styles.sidebarItem}
                                        onClick={() => navigateTo('clients')}
                                      >
                                        <span style={styles.sidebarIcon}>&#127970;</span>
                                        <span style={styles.sidebarText}>会社管理</span>
                                      </button>
                                      <button 
                                        style={screen === 'cast_users' ? styles.sidebarItemActive : styles.sidebarItem}
                                        onClick={() => navigateTo('cast_users')}
                                      >
                                        <span style={styles.sidebarIcon}>&#128100;</span>
                                        <span style={styles.sidebarText}>キャスト</span>
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
              
              {/* Alert for clients without email */}
              {clients.filter(c => !c.contact_email && c.is_active).length > 0 && (
                <div style={styles.alertBox}>
                  <span style={styles.alertIcon}>&#9888;</span>
                  <div style={styles.alertContent}>
                    <strong>メールアドレス未登録の会社があります</strong>
                    <p style={styles.alertText}>
                      以下の会社にメールアドレスが登録されていないため、報告書を送信できません：
                    </p>
                    <ul style={styles.alertList}>
                      {clients.filter(c => !c.contact_email && c.is_active).map(c => (
                        <li key={c.id}>
                          <span 
                            style={styles.alertClientLink}
                            onClick={() => setEditingClient(c)}
                          >
                            {c.name}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <button 
                      style={styles.alertButton}
                      onClick={() => navigateTo('clients')}
                    >
                      会社管理で登録する
                    </button>
                  </div>
                </div>
              )}
              
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
                  <button style={{...styles.actionButton, backgroundColor: '#fff3cd', borderColor: '#ffc107'}} onClick={handleDeleteProjectsWithoutCasts}>
                    <span style={styles.actionIcon}>&#128465;</span>
                    キャストなし案件を削除
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
                    <span style={styles.uploadIcon}>{isDragging ? '📥' : '📁'}</span>
                    <span>{importing ? 'インポート中...' : (isDragging ? 'ここにドロップ' : 'CSVファイルを選択またはドラッグ＆ドロップ')}</span>
                  </label>
                </div>
                {importResult && (
                  <div style={styles.resultBox}>
                    <h4 style={styles.resultTitle}>インポート結果</h4>
                    {(importResult.existing_projects_count ?? 0) > 0 && (importResult.created_projects_count ?? 0) === 0 && (
                      <div style={styles.infoBox}>
                        このCSVの案件は既に登録されています（{importResult.existing_projects_count}件）
                      </div>
                    )}
                    <div style={styles.resultGrid}>
                      <div style={styles.resultItem}>
                        <span style={styles.resultLabel}>新規作成</span>
                        <span style={styles.resultValue}>{importResult.created_projects_count ?? 0}件</span>
                      </div>
                      <div style={styles.resultItem}>
                        <span style={styles.resultLabel}>既存（スキップ）</span>
                        <span style={styles.resultValue}>{importResult.existing_projects_count ?? 0}件</span>
                      </div>
                      <div style={styles.resultItem}>
                        <span style={styles.resultLabel}>自動追加スタッフ</span>
                        <span style={styles.resultValue}>{importResult.staff_auto_added_count ?? 0}件</span>
                      </div>
                      <div style={styles.resultItem}>
                        <span style={styles.resultLabel}>未登録会社</span>
                        <span style={styles.resultValue}>{importResult.pending_client_rows_count ?? 0}件</span>
                      </div>
                    </div>
                    {(importResult.duplicate_cast_assignments ?? 0) > 0 && (
                      <div style={{ ...styles.warningBox, backgroundColor: '#fff3cd', color: '#856404', border: '1px solid #ffc107' }}>
                        1日2箇所以上の割り当てが {importResult.duplicate_cast_assignments} 件あります（1日1現場まで）。該当するキャストは登録されませんでした。
                      </div>
                    )}
                    {importResult.errors && importResult.errors.length > 0 && (
                      <div style={styles.warningBox}>
                        エラー: {importResult.errors.map((e: { row: number; reason: string }) => `行${e.row}: ${e.reason}`).join(', ')}
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

                        {/* Date Navigation */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' }}>
                          <button
                            style={{ padding: '8px 16px', backgroundColor: COLORS.white, border: `1px solid ${COLORS.primary}`, color: COLORS.primary, borderRadius: '6px', cursor: 'pointer', fontSize: '14px', fontWeight: 'bold' }}
                            onClick={() => navigateDate(-1)}
                            disabled={loading}
                          >
                            &#9664; 前日
                          </button>
                          <input
                            type="date"
                            value={selectedDate}
                            onChange={(e) => {
                              if (e.target.value) {
                                setSelectedDate(e.target.value)
                                fetchProjectsByDate(e.target.value)
                              }
                            }}
                            disabled={loading}
                            style={{ padding: '8px 12px', border: `1px solid ${COLORS.primary}`, borderRadius: '6px', fontSize: '16px', fontWeight: 'bold', color: COLORS.text, textAlign: 'center' }}
                          />
                          <button
                            style={{ padding: '8px 16px', backgroundColor: COLORS.white, border: `1px solid ${COLORS.primary}`, color: COLORS.primary, borderRadius: '6px', cursor: 'pointer', fontSize: '14px', fontWeight: 'bold' }}
                            onClick={() => navigateDate(1)}
                            disabled={loading}
                          >
                            翌日 &#9654;
                          </button>
                          {selectedDate !== todayStr && (
                            <button
                              style={{ padding: '8px 16px', backgroundColor: COLORS.primary, border: 'none', color: COLORS.white, borderRadius: '6px', cursor: 'pointer', fontSize: '14px', fontWeight: 'bold' }}
                              onClick={() => {
                                setSelectedDate(todayStr)
                                fetchProjectsByDate(todayStr)
                              }}
                              disabled={loading}
                            >
                              今日
                            </button>
                          )}
                        </div>

                        {loading ? (
                          <p>読み込み中...</p>
                        ) : projects.length === 0 ? (
                          <p style={styles.emptyMessage}>案件がありません</p>
                        ) : isMobile ? (
                          <div style={styles.mobileCardList}>
                            {sortedDates.map(date => (
                              <div key={date}>
                                {renderDateHeader(date, projectsByDate[date].length)}
                                {projectsByDate[date].map(project => (
                              <div key={project.id} style={styles.mobileCard}>
                                <div style={styles.mobileCardHeader}>
                                  <span style={{...styles.statusBadge, backgroundColor: getStatusColor(project.status)}}>
                                    {getStatusLabel(project.status)}
                                  </span>
                                </div>
                                <div style={styles.mobileCardBody}>
                                  <div style={styles.mobileCardRow}>
                                    <span style={styles.mobileCardLabel}>会社名</span>
                                    <span style={styles.mobileCardValue}>{project.client_name || project.client_name_raw}</span>
                                  </div>
                                  <div style={styles.mobileCardRow}>
                                    <span style={styles.mobileCardLabel}>作業名</span>
                                    <span style={styles.mobileCardValue}>{project.work_name}</span>
                                  </div>
                                  <div style={styles.mobileCardRow}>
                                    <span style={styles.mobileCardLabel}>場所</span>
                                    <span style={styles.mobileCardValue}>{project.location}</span>
                                  </div>
                                  <div style={styles.mobileCardRow}>
                                    <span style={styles.mobileCardLabel}>URL有効期限</span>
                                    <span style={styles.mobileCardValue}>{formatDate(project.url_expires_at)}</span>
                                  </div>
                                  {project.casts && project.casts.length > 0 && (
                                    <div style={styles.mobileCardRow}>
                                      <span style={styles.mobileCardLabel}>キャスト</span>
                                      <span
                                        style={{...styles.mobileCardValue, cursor: 'pointer', color: COLORS.primary, textDecoration: 'underline'}}
                                        onClick={() => setCastsModalProject(project)}
                                      >
                                        {project.casts.length === 1
                                          ? project.casts[0].cast_name
                                          : `${project.casts[0].cast_name} 他${project.casts.length - 1}人`}
                                      </span>
                                    </div>
                                  )}
                                </div>
                                <div style={styles.mobileCardActions}>
                                  <button
                                    style={styles.mobileActionButton}
                                    onClick={() => {
                                      const url = `${window.location.origin}/report/${project.unique_url}`
                                      navigator.clipboard.writeText(url)
                                      alert('URLをコピーしました')
                                    }}
                                  >
                                    URLコピー
                                  </button>
                                  <button
                                    style={styles.mobileActionButtonPrimary}
                                    onClick={() => window.open(`/report/${project.unique_url}`, '_blank')}
                                  >
                                    報告画面
                                  </button>
                                </div>
                              </div>
                                ))}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div>
                            {sortedDates.map(date => (
                              <div key={date} style={{ marginBottom: '24px' }}>
                                {renderDateHeader(date, projectsByDate[date].length)}
                                <div style={styles.card}>
                                  <div style={styles.tableContainer}>
                                    <table style={styles.table}>
                                      <thead>
                                        <tr>
                                          <th style={styles.sortableTh} onClick={() => handleSort('client_name_raw')}>会社名{getSortIndicator('client_name_raw')}</th>
                                          <th style={styles.sortableTh} onClick={() => handleSort('work_name')}>作業名{getSortIndicator('work_name')}</th>
                                          <th style={styles.sortableTh} onClick={() => handleSort('location')}>場所{getSortIndicator('location')}</th>
                                          <th style={styles.th}>キャスト</th>
                                          <th style={styles.sortableTh} onClick={() => handleSort('status')}>状態{getSortIndicator('status')}</th>
                                          <th style={styles.th}>操作</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {projectsByDate[date].map(project => (
                                          <tr key={project.id} style={styles.tr}>
                                            <td style={styles.td}>{project.client_name || project.client_name_raw}</td>
                                            <td style={styles.td}>{project.work_name}</td>
                                            <td style={styles.td}>{project.location}</td>
                                            <td style={styles.td}>
                                              {project.casts && project.casts.length > 0
                                                ? (
                                                  <span
                                                    style={{ cursor: 'pointer', color: COLORS.primary, textDecoration: 'underline' }}
                                                    onClick={() => setCastsModalProject(project)}
                                                  >
                                                    {project.casts.length === 1
                                                      ? project.casts[0].cast_name
                                                      : `${project.casts[0].cast_name} 他${project.casts.length - 1}人`}
                                                  </span>
                                                )
                                                : '-'}
                                            </td>
                                            <td style={styles.td}>
                                              <span style={{...styles.statusBadge, backgroundColor: getStatusColor(project.status)}}>
                                                {getStatusLabel(project.status)}
                                              </span>
                                            </td>
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
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Reports List */}
                    {screen === 'reports' && (
                      <div>
                        <h2 style={styles.pageTitle}>報告書一覧</h2>
                        {loading ? (
                          <p>読み込み中...</p>
                        ) : reports.length === 0 ? (
                          <p style={styles.emptyMessage}>報告書がありません</p>
                        ) : isMobile ? (
                          <div style={styles.mobileCardList}>
                            {reports.map(report => (
                              <div key={report.id} style={styles.mobileCard}>
                                <div style={styles.mobileCardHeader}>
                                  <span style={styles.mobileCardDate}>{formatDateTime(report.approved_at)}</span>
                                </div>
                                <div style={styles.mobileCardBody}>
                                  <div style={styles.mobileCardRow}>
                                    <span style={styles.mobileCardLabel}>会社名</span>
                                    <span style={styles.mobileCardValue}>{report.client_name_raw}</span>
                                  </div>
                                  <div style={styles.mobileCardRow}>
                                    <span style={styles.mobileCardLabel}>実施日</span>
                                    <span style={styles.mobileCardValue}>{formatDate(report.work_date)}</span>
                                  </div>
                                  <div style={styles.mobileCardRow}>
                                    <span style={styles.mobileCardLabel}>作業名</span>
                                    <span style={styles.mobileCardValue}>{report.work_name}</span>
                                  </div>
                                  <div style={styles.mobileCardRow}>
                                    <span style={styles.mobileCardLabel}>監督者</span>
                                    <span style={styles.mobileCardValue}>{report.supervisor_name}</span>
                                  </div>
                                  <div style={styles.mobileCardRow}>
                                    <span style={styles.mobileCardLabel}>記入者</span>
                                    <span style={styles.mobileCardValue}>{report.writer_name}</span>
                                  </div>
                                </div>
                                <div style={styles.mobileCardActions}>
                                  {report.pdf_generation_status === 'success' ? (
                                    <button 
                                      style={styles.mobileActionButtonPrimary}
                                      onClick={() => handleDownloadPdf(report.id)}
                                    >
                                      PDFダウンロード ({Math.round(report.pdf_size / 1024)}KB)
                                    </button>
                                  ) : (
                                    <span style={styles.pdfPending}>
                                      {report.pdf_generation_status === 'pending' ? '生成中' : '未生成'}
                                    </span>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div style={styles.card}>
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
                          </div>
                        )}
                      </div>
                    )}

          {/* Staff Management */}
          {screen === 'staff' && (
            <div>
              <div style={styles.pageHeader}>
                <h2 style={{...styles.pageTitle, margin: 0}}>キャスト管理</h2>
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

              {/* Staff Search */}
              <div style={{ marginBottom: '16px' }}>
                <input
                  type="text"
                  style={styles.searchInput}
                  placeholder="氏名（漢字・カナ）またはメールで検索..."
                  value={staffSearchQuery}
                  onChange={(e) => setStaffSearchQuery(e.target.value)}
                />
                {staffSearchQuery && (
                  <span style={{ marginLeft: '12px', color: COLORS.darkGray, fontSize: '14px' }}>
                    {filteredStaff.length}件 / {staff.length}件
                  </span>
                )}
              </div>

                                                        {loading ? (
                                                          <p>読み込み中...</p>
                                                        ) : staff.length === 0 ? (
                                                          <p style={styles.emptyMessage}>スタッフが登録されていません</p>
                                                        ) : filteredStaff.length === 0 ? (
                                                          <p style={styles.emptyMessage}>検索結果がありません</p>
                                                        ) : isMobile ? (
                                                          <div style={styles.mobileCardList}>
                                                            {filteredStaff.map(member => (
                                                              <div key={member.id} style={styles.mobileCard}>
                                                                <div style={styles.mobileCardBody}>
                                                                  <div style={styles.mobileCardRow}>
                                                                    <span style={styles.mobileCardLabel}>氏名（漢字）</span>
                                                                    <span style={styles.mobileCardValue}>{member.display_name_kanji}</span>
                                                                  </div>
                                                                  <div style={styles.mobileCardRow}>
                                                                    <span style={styles.mobileCardLabel}>氏名（カナ）</span>
                                                                    <span style={styles.mobileCardValue}>{member.display_name_kana}</span>
                                                                  </div>
                                                                  <div style={styles.mobileCardRow}>
                                                                    <span style={styles.mobileCardLabel}>メールアドレス</span>
                                                                    <span style={styles.mobileCardValue}>{member.registered_email || member.email || '-'}</span>
                                                                  </div>
                                                                  <div style={styles.mobileCardRow}>
                                                                    <span style={styles.mobileCardLabel}>登録日</span>
                                                                    <span style={styles.mobileCardValue}>{formatDate(member.created_at)}</span>
                                                                  </div>
                                                                  <div style={styles.mobileCardRow}>
                                                                    <button 
                                                                      style={styles.primaryButton}
                                                                      onClick={() => setEditingStaff(member)}
                                                                    >
                                                                      編集
                                                                    </button>
                                                                  </div>
                                                                </div>
                                                              </div>
                                                            ))}
                                                          </div>
                                                        ) : (
                                                          <div style={styles.card}>
                                                            <div style={styles.tableContainer}>
                                                              <table style={styles.table}>
                                                                <thead>
                                                                  <tr>
                                                                    <th style={styles.th}>氏名（漢字）</th>
                                                                    <th style={styles.th}>氏名（カナ）</th>
                                                                    <th style={styles.th}>メールアドレス</th>
                                                                    <th style={styles.th}>登録日</th>
                                                                    <th style={styles.th}>操作</th>
                                                                  </tr>
                                                                </thead>
                                                                <tbody>
                                                                  {filteredStaff.map(member => (
                                                                    <tr key={member.id} style={styles.tr}>
                                                                      <td style={styles.td}>{member.display_name_kanji}</td>
                                                                      <td style={styles.td}>{member.display_name_kana}</td>
                                                                      <td style={styles.td}>{member.registered_email || member.email || '-'}</td>
                                                                      <td style={styles.td}>{formatDate(member.created_at)}</td>
                                                                      <td style={styles.td}>
                                                                        <button 
                                                                          style={styles.primaryButton}
                                                                          onClick={() => setEditingStaff(member)}
                                                                        >
                                                                          編集
                                                                        </button>
                                                                      </td>
                                                                    </tr>
                                                                  ))}
                                                                </tbody>
                                                              </table>
                                                            </div>
                                                          </div>
                                                        )}

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

                        {/* Edit Staff Modal */}
                        {editingStaff && (
                          <div style={styles.modalOverlay} onClick={() => setEditingStaff(null)}>
                            <div style={styles.modal} onClick={e => e.stopPropagation()}>
                              <h3 style={styles.modalTitle}>スタッフ編集</h3>
                              <div style={styles.formGroup}>
                                <label style={styles.label}>氏名（漢字）</label>
                                <input
                                  type="text"
                                  style={styles.input}
                                  value={editingStaff.display_name_kanji}
                                  onChange={e => setEditingStaff({ ...editingStaff, display_name_kanji: e.target.value })}
                                  placeholder="例：山田 太郎"
                                />
                              </div>
                              <div style={styles.formGroup}>
                                <label style={styles.label}>氏名（カナ）</label>
                                <input
                                  type="text"
                                  style={styles.input}
                                  value={editingStaff.display_name_kana}
                                  onChange={e => setEditingStaff({ ...editingStaff, display_name_kana: e.target.value })}
                                  placeholder="例：ヤマダ タロウ"
                                />
                              </div>
                              <div style={styles.formGroup}>
                                <label style={styles.label}>メールアドレス</label>
                                <input
                                  type="email"
                                  style={styles.input}
                                  value={editingStaff.email || ''}
                                  onChange={e => setEditingStaff({ ...editingStaff, email: e.target.value || null })}
                                  placeholder="例：yamada@example.com"
                                />
                              </div>
                              <div style={styles.modalActions}>
                                <button
                                  style={styles.cancelButton}
                                  onClick={() => setEditingStaff(null)}
                                  disabled={savingStaff}
                                >
                                  キャンセル
                                </button>
                                <button
                                  style={styles.primaryButton}
                                  onClick={handleUpdateStaff}
                                  disabled={savingStaff}
                                >
                                  {savingStaff ? '保存中...' : '保存'}
                                </button>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Import History */}
          {screen === 'import_history' && (
            <div>
              <h2 style={styles.pageTitle}>インポート履歴</h2>
              
              {selectedImport ? (
                <div>
                  <button 
                    style={styles.backButton} 
                    onClick={() => { setSelectedImport(null); setImportedProjects([]); }}
                  >
                    ← 履歴一覧に戻る
                  </button>
                  <div style={styles.importDetailCard}>
                    <h3 style={styles.importDetailTitle}>{selectedImport.original_file_name}</h3>
                    <div style={styles.importDetailInfo}>
                      <span>インポート日時: {formatDateTime(selectedImport.created_at)}</span>
                      <span>実行者: {selectedImport.imported_by_admin_email}</span>
                      <span>エンコーディング: {selectedImport.detected_encoding}</span>
                    </div>
                    <div style={styles.importDetailStats}>
                      <div style={styles.importStatItem}>
                        <span style={styles.importStatValue}>{selectedImport.created_projects_count}</span>
                        <span style={styles.importStatLabel}>新規作成</span>
                      </div>
                      <div style={styles.importStatItem}>
                        <span style={styles.importStatValue}>{selectedImport.skipped_rows_count}</span>
                        <span style={styles.importStatLabel}>スキップ</span>
                      </div>
                      <div style={styles.importStatItem}>
                        <span style={styles.importStatValue}>{selectedImport.pending_client_rows_count}</span>
                        <span style={styles.importStatLabel}>会社未登録</span>
                      </div>
                    </div>
                  </div>
                  
                                <h3 style={styles.sectionTitle}>このインポートで作成された案件</h3>
                                {loadingImportProjects ? (
                                  <p>読み込み中...</p>
                                ) : importedProjects.length === 0 ? (
                                  <p style={styles.emptyMessage}>このインポートで作成された案件はありません</p>
                                ) : isMobile ? (
                                  <div style={styles.mobileCardList}>
                                    {importedProjects.map(project => (
                                      <div key={project.id} style={styles.mobileCard}>
                                        <div style={styles.mobileCardHeader}>
                                          <span style={{...styles.statusBadge, backgroundColor: getStatusColor(project.status)}}>
                                            {getStatusLabel(project.status)}
                                          </span>
                                          <span style={styles.mobileCardDate}>{formatDate(project.work_date)}</span>
                                        </div>
                                        <div style={styles.mobileCardBody}>
                                          <div style={styles.mobileCardRow}>
                                            <span style={styles.mobileCardLabel}>会社名</span>
                                            <span style={styles.mobileCardValue}>{project.client_name_raw}</span>
                                          </div>
                                          <div style={styles.mobileCardRow}>
                                            <span style={styles.mobileCardLabel}>作業名</span>
                                            <span style={styles.mobileCardValue}>{project.work_name}</span>
                                          </div>
                                          <div style={styles.mobileCardRow}>
                                            <span style={styles.mobileCardLabel}>場所</span>
                                            <span style={styles.mobileCardValue}>{project.location}</span>
                                          </div>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
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
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {importedProjects.map(project => (
                                          <tr key={project.id} style={styles.tr}>
                                            <td style={styles.td}>{formatDate(project.work_date)}</td>
                                            <td style={styles.td}>{project.client_name_raw}</td>
                                            <td style={styles.td}>{project.work_name}</td>
                                            <td style={styles.td}>{project.location}</td>
                                            <td style={styles.td}>
                                              <span style={{...styles.statusBadge, backgroundColor: getStatusColor(project.status)}}>
                                                {getStatusLabel(project.status)}
                                              </span>
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                )}
                              </div>
                            ) : (
                              <div>
                                {loading ? (
                                  <p>読み込み中...</p>
                                ) : importHistory.length === 0 ? (
                                  <p style={styles.emptyMessage}>インポート履歴がありません</p>
                                ) : isMobile ? (
                                  <div style={styles.mobileCardList}>
                                    {importHistory.map(item => (
                                      <div key={item.id} style={styles.mobileCard}>
                                        <div style={styles.mobileCardHeader}>
                                          <span style={styles.mobileCardDate}>{formatDateTime(item.created_at)}</span>
                                        </div>
                                        <div style={styles.mobileCardBody}>
                                          <div style={styles.mobileCardRow}>
                                            <span style={styles.mobileCardLabel}>ファイル名</span>
                                            <span style={styles.mobileCardValue}>{item.original_file_name}</span>
                                          </div>
                                          <div style={styles.mobileCardRow}>
                                            <span style={styles.mobileCardLabel}>実行者</span>
                                            <span style={styles.mobileCardValue}>{item.imported_by_admin_email}</span>
                                          </div>
                                          <div style={styles.mobileCardRow}>
                                            <span style={styles.mobileCardLabel}>新規作成</span>
                                            <span style={styles.mobileCardValue}>{item.created_projects_count}件</span>
                                          </div>
                                          <div style={styles.mobileCardRow}>
                                            <span style={styles.mobileCardLabel}>スキップ</span>
                                            <span style={styles.mobileCardValue}>{item.skipped_rows_count}件</span>
                                          </div>
                                          <div style={styles.mobileCardRow}>
                                            <span style={styles.mobileCardLabel}>会社未登録</span>
                                            <span style={styles.mobileCardValue}>{item.pending_client_rows_count}件</span>
                                          </div>
                                        </div>
                                        <div style={styles.mobileCardActions}>
                                          <button 
                                            style={styles.mobileActionButtonPrimary}
                                            onClick={() => handleSelectImport(item)}
                                          >
                                            詳細を見る
                                          </button>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <div style={styles.tableContainer}>
                                    <table style={styles.table}>
                                      <thead>
                                        <tr>
                                          <th style={styles.th}>インポート日時</th>
                                          <th style={styles.th}>ファイル名</th>
                                          <th style={styles.th}>実行者</th>
                                          <th style={styles.th}>新規作成</th>
                                          <th style={styles.th}>スキップ</th>
                                          <th style={styles.th}>会社未登録</th>
                                          <th style={styles.th}>操作</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {importHistory.map(item => (
                                          <tr key={item.id} style={styles.tr}>
                                            <td style={styles.td}>{formatDateTime(item.created_at)}</td>
                                            <td style={styles.td}>{item.original_file_name}</td>
                                            <td style={styles.td}>{item.imported_by_admin_email}</td>
                                            <td style={styles.td}>{item.created_projects_count}</td>
                                            <td style={styles.td}>{item.skipped_rows_count}</td>
                                            <td style={styles.td}>{item.pending_client_rows_count}</td>
                                            <td style={styles.td}>
                                              <button 
                                                style={styles.viewButton}
                                                onClick={() => handleSelectImport(item)}
                                              >
                                                詳細
                                              </button>
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                )}
                              </div>
                            )}
            </div>
          )}

                    {/* Clients Management */}
                    {screen === 'clients' && (
                      <div>
                        <h2 style={styles.pageTitle}>会社管理</h2>
                        <p style={styles.description}>
                          登録済みの会社一覧です。担当者情報を編集できます。
                        </p>
                        {loading ? (
                          <p>読み込み中...</p>
                        ) : clients.length === 0 ? (
                          <p style={styles.emptyMessage}>登録済みの会社はありません</p>
                        ) : isMobile ? (
                          <div style={styles.mobileCardList}>
                            {clients.map(client => (
                              <div key={client.id} style={styles.mobileCard}>
                                <div style={styles.mobileCardBody}>
                                  <div style={styles.mobileCardRow}>
                                    <span style={styles.mobileCardLabel}>会社名</span>
                                    <span style={styles.mobileCardValue}>{client.name}</span>
                                  </div>
                                  <div style={styles.mobileCardRow}>
                                    <span style={styles.mobileCardLabel}>担当者名</span>
                                    <span style={styles.mobileCardValue}>{client.contact_name || '-'}</span>
                                  </div>
                                  <div style={styles.mobileCardRow}>
                                    <span style={styles.mobileCardLabel}>役職</span>
                                    <span style={styles.mobileCardValue}>{client.contact_title || '-'}</span>
                                  </div>
                                  <div style={styles.mobileCardRow}>
                                    <span style={styles.mobileCardLabel}>メールアドレス</span>
                                    <span style={styles.mobileCardValue}>{client.contact_email || '-'}</span>
                                  </div>
                                </div>
                                <div style={styles.mobileCardActions}>
                                  <button 
                                    style={styles.mobileActionButtonPrimary}
                                    onClick={() => setEditingClient(client)}
                                  >
                                    編集
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div style={styles.tableContainer}>
                            <table style={styles.table}>
                              <thead>
                                <tr>
                                  <th style={styles.th}>会社名</th>
                                  <th style={styles.th}>担当者名</th>
                                  <th style={styles.th}>役職</th>
                                  <th style={styles.th}>メールアドレス</th>
                                  <th style={styles.th}>操作</th>
                                </tr>
                              </thead>
                              <tbody>
                                {clients.map(client => (
                                  <tr key={client.id} style={styles.tr}>
                                    <td style={styles.td}>{client.name}</td>
                                    <td style={styles.td}>{client.contact_name || '-'}</td>
                                    <td style={styles.td}>{client.contact_title || '-'}</td>
                                    <td style={styles.td}>{client.contact_email || '-'}</td>
                                    <td style={styles.td}>
                                      <button 
                                        style={styles.primaryButton}
                                        onClick={() => setEditingClient(client)}
                                      >
                                        編集
                                      </button>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}

                        {/* Edit Client Modal */}
                        {editingClient && (
                          <div style={styles.modalOverlay}>
                            <div style={styles.modal}>
                              <h3 style={styles.modalTitle}>会社情報編集</h3>
                              <div style={styles.formGroup}>
                                <label style={styles.label}>会社名</label>
                                <input
                                  type="text"
                                  style={styles.input}
                                  value={editingClient.name}
                                  onChange={(e) => setEditingClient({...editingClient, name: e.target.value})}
                                />
                              </div>
                              <div style={styles.formGroup}>
                                <label style={styles.label}>担当者名</label>
                                <input
                                  type="text"
                                  style={styles.input}
                                  value={editingClient.contact_name || ''}
                                  onChange={(e) => setEditingClient({...editingClient, contact_name: e.target.value || null})}
                                  placeholder="例: 山田太郎"
                                />
                              </div>
                              <div style={styles.formGroup}>
                                <label style={styles.label}>役職</label>
                                <input
                                  type="text"
                                  style={styles.input}
                                  value={editingClient.contact_title || ''}
                                  onChange={(e) => setEditingClient({...editingClient, contact_title: e.target.value || null})}
                                  placeholder="例: 部長"
                                />
                              </div>
                              <div style={styles.formGroup}>
                                <label style={styles.label}>メールアドレス</label>
                                <input
                                  type="email"
                                  style={styles.input}
                                  value={editingClient.contact_email || ''}
                                  onChange={(e) => setEditingClient({...editingClient, contact_email: e.target.value || null})}
                                  placeholder="例: yamada@example.com"
                                />
                              </div>
                              <div style={styles.modalActions}>
                                <button 
                                  style={styles.secondaryButton}
                                  onClick={() => setEditingClient(null)}
                                  disabled={savingClient}
                                >
                                  キャンセル
                                </button>
                                <button 
                                  style={styles.primaryButton}
                                  onClick={handleUpdateClient}
                                  disabled={savingClient}
                                >
                                  {savingClient ? '保存中...' : '保存'}
                                </button>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

          {/* Cast Users Management */}
          {screen === 'cast_users' && (
            <div>
                            <h2 style={styles.pageTitle}>キャスト管理</h2>
                            <p style={styles.pageDescription}>登録済みのキャスト一覧です。名前を編集してCSVの氏名と紐づけできます。</p>
              
              {loading ? (
                <p>読み込み中...</p>
              ) : castUsers.length === 0 ? (
                <p style={styles.emptyMessage}>キャストが登録されていません</p>
              ) : isMobile ? (
                <div style={styles.mobileCardList}>
                  {castUsers.map(user => (
                    <div key={user.id} style={styles.mobileCard}>
                      <div style={styles.mobileCardBody}>
                        <div style={styles.mobileCardRow}>
                          <span style={styles.mobileCardLabel}>メールアドレス</span>
                          <span style={styles.mobileCardValue}>{user.email}</span>
                        </div>
                        <div style={styles.mobileCardRow}>
                          <span style={styles.mobileCardLabel}>名前</span>
                          <span style={styles.mobileCardValue}>{user.name || user.selected_name_kanji || '-'}</span>
                        </div>
                        <div style={styles.mobileCardRow}>
                          <span style={styles.mobileCardLabel}>登録日</span>
                          <span style={styles.mobileCardValue}>{formatDate(user.created_at)}</span>
                        </div>
                        <div style={styles.mobileCardRow}>
                          <button 
                            style={styles.primaryButton}
                            onClick={() => setEditingCastUser(user)}
                          >
                            編集
                          </button>
                          <button 
                            style={{...styles.secondaryButton, backgroundColor: COLORS.danger, color: 'white', marginLeft: '8px'}}
                            onClick={() => handleDeleteCastUser(user.id, user.email)}
                          >
                            削除
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={styles.card}>
                  <div style={styles.tableContainer}>
                    <table style={styles.table}>
                      <thead>
                        <tr>
                          <th style={styles.th}>メールアドレス</th>
                          <th style={styles.th}>名前</th>
                          <th style={styles.th}>登録日</th>
                          <th style={styles.th}>操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {castUsers.map(user => (
                          <tr key={user.id} style={styles.tr}>
                            <td style={styles.td}>{user.email}</td>
                            <td style={styles.td}>{user.name || user.selected_name_kanji || '-'}</td>
                            <td style={styles.td}>{formatDate(user.created_at)}</td>
                            <td style={styles.td}>
                              <button 
                                style={styles.primaryButton}
                                onClick={() => setEditingCastUser(user)}
                              >
                                編集
                              </button>
                              <button 
                                style={{...styles.secondaryButton, backgroundColor: COLORS.danger, color: 'white', marginLeft: '8px'}}
                                onClick={() => handleDeleteCastUser(user.id, user.email)}
                              >
                                削除
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Edit Cast User Modal */}
              {editingCastUser && (
                <div style={styles.modalOverlay}>
                  <div style={styles.modal}>
                    <h3 style={styles.modalTitle}>キャスト編集</h3>
                    <div style={styles.formGroup}>
                      <label style={styles.label}>メールアドレス</label>
                      <input
                        type="text"
                        style={{...styles.input, backgroundColor: '#f0f0f0'}}
                        value={editingCastUser.email}
                        disabled
                      />
                    </div>
                    <div style={styles.formGroup}>
                      <label style={styles.label}>名前（CSVの氏名と一致させてください）</label>
                      <input
                        type="text"
                        style={styles.input}
                        value={editingCastUser.name || ''}
                        onChange={(e) => setEditingCastUser({...editingCastUser, name: e.target.value || null})}
                        placeholder="例: 高木豊大"
                      />
                    </div>
                    <div style={styles.modalActions}>
                      <button 
                        style={styles.secondaryButton}
                        onClick={() => setEditingCastUser(null)}
                        disabled={savingCastUser}
                      >
                        キャンセル
                      </button>
                      <button 
                        style={styles.primaryButton}
                        onClick={handleUpdateCastUser}
                        disabled={savingCastUser}
                      >
                        {savingCastUser ? '保存中...' : '保存'}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Casts List Modal - moved outside screen conditions */}
          {castsModalProject && (
            <div style={styles.modalOverlay} onClick={() => setCastsModalProject(null)}>
              <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
                <h3 style={styles.modalTitle}>キャスト一覧</h3>
                <p style={{ marginBottom: '16px', color: COLORS.darkGray }}>
                  {castsModalProject.work_name} - {formatDate(castsModalProject.work_date)}
                </p>
                <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
                  <table style={styles.table}>
                    <thead>
                      <tr>
                        <th style={styles.th}>No.</th>
                        <th style={styles.th}>氏名</th>
                        <th style={styles.th}>スタッフNo.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {castsModalProject.casts?.map((cast, index) => (
                        <tr key={index} style={styles.tr}>
                          <td style={styles.td}>{index + 1}</td>
                          <td style={styles.td}>{cast.cast_name}</td>
                          <td style={styles.td}>{cast.staff_no || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div style={styles.modalActions}>
                  <button 
                    style={styles.primaryButton}
                    onClick={() => setCastsModalProject(null)}
                  >
                    閉じる
                  </button>
                </div>
              </div>
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
    transition: 'width 0.3s, transform 0.3s',
    overflow: 'hidden',
    flexShrink: 0
  },
    sidebarClosed: {
      width: '0px',
      borderRight: 'none'
    },
        sidebarMobile: {
          position: 'fixed' as const,
          top: '60px',
          left: 0,
          bottom: 0,
          width: '240px',
          zIndex: 100,
          boxShadow: '2px 0 8px rgba(0, 0, 0, 0.1)'
        },
        sidebarMobileClosed: {
          transform: 'translateX(-100%)'
        },
        sidebarMobileOpen: {
          transform: 'translateX(0)'
        },
    sidebarOverlay: {
      position: 'fixed' as const,
      top: '60px',
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      zIndex: 99
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
  infoBox: {
    marginBottom: '16px',
    padding: '12px',
    backgroundColor: '#E3F2FD',
    borderRadius: '6px',
    color: '#1565C0',
    fontWeight: 500
  },
  tableContainer: {
    overflowX: 'auto' as const,
    WebkitOverflowScrolling: 'touch' as const,
    marginLeft: '-12px',
    marginRight: '-12px',
    paddingLeft: '12px',
    paddingRight: '12px'
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
  sortableTh: {
    backgroundColor: COLORS.secondary,
    color: COLORS.white,
    padding: '14px 12px',
    textAlign: 'left' as const,
    fontSize: '14px',
    fontWeight: 600,
    whiteSpace: 'nowrap' as const,
    cursor: 'pointer',
    userSelect: 'none' as const
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
    padding: '8px 14px',
    backgroundColor: COLORS.secondary,
    color: COLORS.white,
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '13px',
    minHeight: '36px'
  },
  linkButton: {
    padding: '8px 14px',
    backgroundColor: COLORS.primary,
    color: COLORS.white,
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '13px',
    minHeight: '36px'
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
  searchInput: {
    width: '100%',
    maxWidth: '400px',
    padding: '12px 16px',
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
  },
  backButton: {
    backgroundColor: 'transparent',
    border: `1px solid ${COLORS.darkGray}`,
    color: COLORS.text,
    padding: '8px 16px',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '14px',
    marginBottom: '20px'
  },
  importDetailCard: {
    backgroundColor: COLORS.white,
    borderRadius: '8px',
    padding: '24px',
    marginBottom: '24px',
    boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
  },
  importDetailTitle: {
    margin: '0 0 16px 0',
    fontSize: '18px',
    color: COLORS.text
  },
  importDetailInfo: {
    display: 'flex',
    gap: '24px',
    flexWrap: 'wrap' as const,
    marginBottom: '20px',
    fontSize: '14px',
    color: COLORS.darkGray
  },
  importDetailStats: {
    display: 'flex',
    gap: '32px'
  },
  importStatItem: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center'
  },
  importStatValue: {
    fontSize: '28px',
    fontWeight: 'bold',
    color: COLORS.primary
  },
  importStatLabel: {
    fontSize: '12px',
    color: COLORS.darkGray,
    marginTop: '4px'
  },
  viewButton: {
    backgroundColor: COLORS.primary,
    color: COLORS.white,
    border: 'none',
    padding: '8px 14px',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '13px',
    minHeight: '36px'
  },
  mobileCardList: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '12px'
  },
  mobileCard: {
    backgroundColor: COLORS.white,
    borderRadius: '12px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
    overflow: 'hidden'
  },
  mobileCardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px 16px',
    backgroundColor: COLORS.lightGray,
    borderBottom: `1px solid ${COLORS.gray}`
  },
  mobileCardDate: {
    fontSize: '14px',
    color: COLORS.darkGray,
    fontWeight: 500
  },
  mobileCardBody: {
    padding: '12px 16px'
  },
  mobileCardRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    padding: '8px 0',
    borderBottom: `1px solid ${COLORS.lightGray}`
  },
  mobileCardLabel: {
    fontSize: '13px',
    color: COLORS.darkGray,
    flexShrink: 0,
    marginRight: '12px'
  },
  mobileCardValue: {
    fontSize: '14px',
    color: COLORS.text,
    textAlign: 'right' as const,
    wordBreak: 'break-word' as const
  },
  mobileCardActions: {
    display: 'flex',
    gap: '8px',
    padding: '12px 16px',
    borderTop: `1px solid ${COLORS.gray}`
  },
  mobileActionButton: {
    flex: 1,
    backgroundColor: COLORS.secondary,
    color: COLORS.white,
    border: 'none',
    padding: '12px 16px',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: 500
  },
  mobileActionButtonPrimary: {
    flex: 1,
    backgroundColor: COLORS.primary,
    color: COLORS.white,
    border: 'none',
    padding: '12px 16px',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: 500
  },
  alertBox: {
    display: 'flex',
    backgroundColor: '#FFF3CD',
    border: '1px solid #FFECB5',
    borderRadius: '8px',
    padding: '16px',
    marginBottom: '20px',
    gap: '12px'
  },
  alertIcon: {
    fontSize: '24px',
    color: COLORS.warning,
    flexShrink: 0
  },
  alertContent: {
    flex: 1
  },
  alertText: {
    margin: '8px 0',
    fontSize: '14px',
    color: COLORS.text
  },
  alertList: {
    margin: '8px 0',
    paddingLeft: '20px',
    fontSize: '14px',
    color: COLORS.text
  },
  alertButton: {
    backgroundColor: COLORS.warning,
    color: COLORS.white,
    border: 'none',
    padding: '8px 16px',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: 500,
    marginTop: '8px'
  },
  alertClientLink: {
    color: COLORS.primary,
    cursor: 'pointer',
    textDecoration: 'underline'
  },
  dateNavigation: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '16px',
    marginBottom: '20px',
    padding: '12px',
    backgroundColor: COLORS.white,
    borderRadius: '8px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
  },
  dateNavButton: {
    backgroundColor: COLORS.primary,
    color: COLORS.white,
    border: 'none',
    padding: '10px 16px',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: 500
  },
  dateDisplay: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px'
  },
  dateInput: {
    padding: '10px 12px',
    fontSize: '16px',
    border: `1px solid ${COLORS.gray}`,
    borderRadius: '6px',
    cursor: 'pointer'
  },
  todayButton: {
    backgroundColor: COLORS.secondary,
    color: COLORS.white,
    border: 'none',
    padding: '10px 16px',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: 500
  },
  searchContainer: {
    marginBottom: '20px',
    padding: '16px',
    backgroundColor: COLORS.white,
    borderRadius: '8px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
  },
  searchModeToggle: {
    display: 'flex',
    gap: '8px',
    marginBottom: '12px'
  },
  searchModeButton: {
    backgroundColor: COLORS.lightGray,
    color: COLORS.text,
    border: `1px solid ${COLORS.gray}`,
    padding: '8px 16px',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: 500
  },
  searchModeButtonActive: {
    backgroundColor: COLORS.primary,
    color: COLORS.white,
    border: `1px solid ${COLORS.primary}`,
    padding: '8px 16px',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: 500
  },
  searchInputRow: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center'
  },
  searchFieldSelect: {
    padding: '10px 12px',
    fontSize: '14px',
    border: `1px solid ${COLORS.gray}`,
    borderRadius: '6px',
    backgroundColor: COLORS.white,
    cursor: 'pointer',
    minWidth: '120px'
  },
  projectSearchInput: {
    flex: 1,
    padding: '10px 12px',
    fontSize: '14px',
    border: `1px solid ${COLORS.gray}`,
    borderRadius: '6px'
  },
  searchClearButton: {
    backgroundColor: COLORS.lightGray,
    color: COLORS.text,
    border: `1px solid ${COLORS.gray}`,
    padding: '10px 16px',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '14px'
  },
  searchResultCount: {
    marginTop: '8px',
    fontSize: '14px',
    color: COLORS.darkGray
  }
}

export default AdminApp
