import { useState, useEffect, useCallback } from 'react'
import './App.css'
import { COLORS, COMPANY_LOGO_URL } from './constants/admin'
import { styles } from './styles/adminStyles'
import type {
  Screen,
  AdminUser,
  AccessRequest,
  AdminAccount,
  Project,
  Report,
  ReportDetail,
  StaffMember,
  ImportResult,
  DashboardStats,
  CsvImportHistory,
  Client,
} from './types/admin'
import { DashboardPage } from './pages/admin/DashboardPage'
import { CsvImportPage } from './pages/admin/CsvImportPage'
import { ProjectsPage } from './pages/admin/ProjectsPage'
import { ReportsPage } from './pages/admin/ReportsPage'
import { StaffPage } from './pages/admin/StaffPage'
import { ImportHistoryPage } from './pages/admin/ImportHistoryPage'
import { ClientsPage } from './pages/admin/ClientsPage'
import { AccountsPage } from './pages/admin/AccountsPage'
import { SendLoginUrlPage } from './pages/admin/SendLoginUrlPage'


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
  const [pendingFile, setPendingFile] = useState<File | null>(null)
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
  const [todayProjects, setTodayProjects] = useState<Project[]>([])
  const [recentReports, setRecentReports] = useState<Report[]>([])
  const [editingStaff, setEditingStaff] = useState<(StaffMember & { email: string | null }) | null>(null)
  const [savingStaff, setSavingStaff] = useState(false)
  const [staffSearchQuery, setStaffSearchQuery] = useState('')
  const [clientSearchQuery, setClientSearchQuery] = useState('')
  const [castsModalProject, setCastsModalProject] = useState<Project | null>(null)
  const [selectedReportDetail, setSelectedReportDetail] = useState<ReportDetail | null>(null)
  const [loadingReportDetail, setLoadingReportDetail] = useState(false)
  const [resending, setResending] = useState(false)
  const [resendResult, setResendResult] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [accessRequests, setAccessRequests] = useState<AccessRequest[]>([])
  const [adminAccounts, setAdminAccounts] = useState<AdminAccount[]>([])
  const [loadingAccounts, setLoadingAccounts] = useState(false)
  const [approveRoles, setApproveRoles] = useState<Record<string, string>>({})
  const [pendingAccessEmail, setPendingAccessEmail] = useState<string | null>(null)
  const [pendingAccessName, setPendingAccessName] = useState<string | null>(null)
  const [requestingAccess, setRequestingAccess] = useState(false)
  const [accessRequestResult, setAccessRequestResult] = useState<string | null>(null)

  const [selectedDate, setSelectedDate] = useState<string>(() => {
    return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' })
  })
  const [reportDate, setReportDate] = useState<string>(() => {
    return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' })
  })

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('access_denied') === '1') {
      const email = params.get('email') || ''
      const name = params.get('name') || ''
      if (email) {
        setPendingAccessEmail(email)
        setPendingAccessName(name || null)
      }
      window.history.replaceState({}, '', '/')
    }
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
      }
    }
  }, [showStaffModal, creating, editingStaff, savingStaff, editingClient, savingClient])

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
    }
    setAdmin(null)
  }

  const handleRequestAccess = async () => {
    if (!pendingAccessEmail) return
    setRequestingAccess(true)
    setAccessRequestResult(null)
    try {
      const response = await fetch('/api/admin/auth/request-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: pendingAccessEmail, display_name: pendingAccessName })
      })
      const data = await response.json()
      setAccessRequestResult(data.message || '申請を送信しました')
    } catch {
      setAccessRequestResult('申請の送信に失敗しました')
    } finally {
      setRequestingAccess(false)
    }
  }

  const fetchAccessRequests = async () => {
    try {
      const response = await fetch('/api/admin/auth/access-requests', { credentials: 'include' })
      if (response.ok) {
        const data = await response.json()
        setAccessRequests(data.requests || [])
      }
    } catch {
    }
  }

  const fetchAdminAccounts = async () => {
    try {
      const response = await fetch('/api/admin/auth/admins', { credentials: 'include' })
      if (response.ok) {
        const data = await response.json()
        setAdminAccounts(data.admins || [])
      }
    } catch {
    }
  }

  const handleApproveRequest = async (requestId: string, role: string) => {
    try {
      const response = await fetch(`/api/admin/auth/access-requests/${requestId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ role })
      })
      if (response.ok) {
        fetchAccessRequests()
        fetchAdminAccounts()
        alert('承認しました')
      } else {
        const data = await response.json().catch(() => null)
        alert(`承認に失敗しました: ${data?.message || response.status}`)
      }
    } catch (e) {
      alert(`承認に失敗しました: ${e}`)
    }
  }

  const handleRejectRequest = async (requestId: string) => {
    if (!confirm('この申請を拒否しますか？')) return
    try {
      await fetch(`/api/admin/auth/access-requests/${requestId}/reject`, {
        method: 'POST',
        credentials: 'include'
      })
      fetchAccessRequests()
    } catch {
      alert('拒否に失敗しました')
    }
  }

  const handleUpdateAdminRole = async (adminId: string, role: string) => {
    try {
      const response = await fetch(`/api/admin/auth/admins/${adminId}/role`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ role })
      })
      if (response.ok) {
        fetchAdminAccounts()
      }
    } catch {
      alert('権限の更新に失敗しました')
    }
  }

  const handleDeleteAdmin = async (adminId: string) => {
    if (!confirm('このアカウントを無効化しますか？')) return
    try {
      const response = await fetch(`/api/admin/auth/admins/${adminId}`, {
        method: 'DELETE',
        credentials: 'include'
      })
      if (response.ok) {
        fetchAdminAccounts()
      } else {
        const data = await response.json()
        alert(data.message || '削除に失敗しました')
      }
    } catch {
      alert('削除に失敗しました')
    }
  }

  const fetchDashboardStats = async () => {
    try {
      const todayStr = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' })
      const [projectsRes, reportsRes, staffRes, clientsRes, todayProjectsRes, todayReportsRes, recentReportsRes] = await Promise.all([
        fetch('/api/admin/projects', { credentials: 'include' }),
        fetch('/api/admin/reports', { credentials: 'include' }),
        fetch('/api/admin/staff', { credentials: 'include' }),
        fetch('/api/admin/clients', { credentials: 'include' }),
        fetch(`/api/admin/projects?date=${todayStr}`, { credentials: 'include' }),
        fetch(`/api/admin/reports?date=${todayStr}`, { credentials: 'include' }),
        fetch('/api/admin/reports', { credentials: 'include' })
      ])

      const projectsData = projectsRes.ok ? await projectsRes.json() : { projects: [] }
      const reportsData = reportsRes.ok ? await reportsRes.json() : { reports: [] }
      const staffData = staffRes.ok ? await staffRes.json() : { staff: [] }
      const clientsData = clientsRes.ok ? await clientsRes.json() : { clients: [] }
      const todayProjectsData = todayProjectsRes.ok ? await todayProjectsRes.json() : { projects: [] }
      const todayReportsData = todayReportsRes.ok ? await todayReportsRes.json() : { reports: [] }
      const recentReportsData = recentReportsRes.ok ? await recentReportsRes.json() : { reports: [] }

      setClients(clientsData.clients || [])
      setTodayProjects(todayProjectsData.projects || [])
      setRecentReports((recentReportsData.reports || []).slice(0, 5))

      const todayProjectIds = new Set((todayProjectsData.projects || []).map((p: Project) => p.id))
      const todayReportedCount = (todayReportsData.reports || []).filter((r: Report) => todayProjectIds.has(r.project_id)).length

      setStats({
        total_projects: projectsData.projects?.length || 0,
        active_projects: projectsData.projects?.filter((p: Project) => p.status === 'active').length || 0,
        total_reports: reportsData.reports?.length || 0,
        pending_reports: reportsData.reports?.filter((r: Report) => r.pdf_generation_status === 'pending').length || 0,
        total_staff: staffData.staff?.length || 0,
        today_projects: todayProjectsData.projects?.length || 0,
        today_reported: todayReportedCount
      })
    } catch {
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

  const fetchReports = async (dateStr?: string) => {
    setLoading(true)
    setError(null)
    try {
      const url = dateStr ? `/api/admin/reports?date=${dateStr}` : '/api/admin/reports'
      const response = await fetch(url, {
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
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/
    if (editingClient.contact_email && !emailRegex.test(editingClient.contact_email.trim())) {
      setError('正しいメールアドレスを入力してください')
      return
    }
    if (Array.isArray(editingClient.emails)) {
      const invalid = editingClient.emails.filter(e => e && !emailRegex.test(String(e).trim()))
      if (invalid.length > 0) {
        setError('無効なメールアドレスが含まれています')
        return
      }
    }
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
          address: editingClient.address,
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

  const handleDeleteClient = async (clientId: string, clientName: string) => {
    if (!confirm(`${clientName} を削除しますか？この操作は取り消せません。`)) return
    setError(null)
    try {
      const response = await fetch(`/api/admin/clients/${clientId}`, {
        method: 'DELETE',
        credentials: 'include'
      })
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.message || '削除に失敗しました')
      }
      fetchClients()
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

  const handleUpdateStaff = async () => {
    if (!editingStaff) return
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/
    if (editingStaff.email && !emailRegex.test(editingStaff.email.trim())) {
      setError('正しいメールアドレスを入力してください')
      return
    }
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

  const handleDeleteStaff = async (staffId: string, staffName: string) => {
    if (!confirm(`${staffName} を削除しますか？関連するキャストユーザーも削除されます。この操作は取り消せません。`)) return
    setError(null)
    try {
      const response = await fetch(`/api/admin/staff/${staffId}`, {
        method: 'DELETE',
        credentials: 'include'
      })
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.message || '削除に失敗しました')
      }
      setEditingStaff(null)
      fetchStaff()
      fetchDashboardStats()
    } catch (err) {
      setError(err instanceof Error ? err.message : '削除に失敗しました')
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

  const uploadCsvFile = async (file: File, forceImport = false) => {
    setImporting(true)
    setError(null)
    setImportResult(null)
    const formData = new FormData()
    formData.append('file', file)
    if (forceImport) {
      formData.append('force_import', 'true')
    }
    try {
      const response = await fetch('/api/admin/csv/import', {
        method: 'POST',
        credentials: 'include',
        body: formData
      })
      const data = await response.json()
      if (!response.ok) {
        if (data.error === 'CSV_FORMAT_INVALID' && data.details) {
          const emptyFields = data.details.empty_fields || data.details.missing_headers || []
          if (emptyFields.length > 0) {
            throw new Error(`${data.message} 以下の項目が入っていません: ${emptyFields.join(', ')}`)
          }
        }
        throw new Error(data.message || 'インポートに失敗しました')
      }
      if (data.blocked) {
        setPendingFile(file)
      } else {
        setPendingFile(null)
      }
      setImportResult(data)
      fetchDashboardStats()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'インポートに失敗しました')
      setPendingFile(null)
    } finally {
      setImporting(false)
    }
  }

  const handleForceImport = async () => {
    if (!pendingFile) return
    await uploadCsvFile(pendingFile, true)
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

  const fetchReportDetail = async (reportId: string) => {
    setLoadingReportDetail(true)
    try {
      const response = await fetch(`/api/admin/reports/${reportId}/detail`, {
        credentials: 'include'
      })
      if (!response.ok) throw new Error('Failed to fetch report detail')
      const data = await response.json()
      setSelectedReportDetail(data.report)
    } catch {
      setError('報告書詳細の取得に失敗しました')
    } finally {
      setLoadingReportDetail(false)
    }
  }

  const handleDownloadPdf = (reportId: string) => {
    window.open(`/api/admin/reports/${reportId}/pdf`, '_blank')
  }

  const handleDeleteReport = async (reportId: string) => {
    if (!confirm('本当に削除しますか？\nこの操作は取り消せません。')) return
    setDeleting(true)
    try {
      const response = await fetch(`/api/admin/reports/${reportId}`, {
        method: 'DELETE',
        credentials: 'include'
      })
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.message || '削除に失敗しました')
      }
      setSelectedReportDetail(null)
      setResendResult(null)
      fetchReports(reportDate)
    } catch (err) {
      alert(err instanceof Error ? err.message : '削除に失敗しました')
    } finally {
      setDeleting(false)
    }
  }

  const handleResendNotifications = async (reportId: string) => {
    if (!confirm('通知を再送信しますか？\n（Slack・メールが再度送信されます）')) return
    setResending(true)
    setResendResult(null)
    try {
      const response = await fetch(`/api/admin/reports/${reportId}/resend`, {
        method: 'POST',
        credentials: 'include'
      })
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.message || '再送信に失敗しました')
      }
      const data = await response.json()
      const parts: string[] = []
      if (data.slackSent) parts.push('Slack')
      if (data.emailSent) parts.push('クライアントメール')
      if (data.castEmailSent) parts.push('キャストメール')
      if (data.adminEmailSent) parts.push('管理者メール')
      setResendResult(parts.length > 0 ? `送信完了: ${parts.join('、')}` : '送信対象がありませんでした')
    } catch (err) {
      setResendResult(err instanceof Error ? err.message : '再送信に失敗しました')
    } finally {
      setResending(false)
    }
  }

  const navigateTo = (newScreen: Screen) => {
    setScreen(newScreen)
    setError(null)
    setSelectedImport(null)
    setImportedProjects([])
    if (isMobile) setSidebarOpen(false)
    if (newScreen === 'dashboard') fetchDashboardStats()
    if (newScreen === 'projects') fetchProjectsByDate(selectedDate)
    if (newScreen === 'reports') fetchReports(reportDate)
    if (newScreen === 'staff') { fetchStaff() }
    if (newScreen === 'send_url') { fetchStaff() }
    if (newScreen === 'import_history') fetchImportHistory()
    if (newScreen === 'clients') fetchClients()
    if (newScreen === 'accounts') { setLoadingAccounts(true); Promise.all([fetchAccessRequests(), fetchAdminAccounts()]).finally(() => setLoadingAccounts(false)) }
  }

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '-'
    return new Date(dateStr).toLocaleDateString('ja-JP')
  }

  const formatDateTime = (dateStr: string) => {
    if (!dateStr) return '-'
    return new Date(dateStr).toLocaleString('ja-JP')
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
      (member.email && member.email.toLowerCase().includes(query)) ||
      (member.registered_email && member.registered_email.toLowerCase().includes(query))
    )
  })

  const filteredClients = clients.filter(client => {
    if (!clientSearchQuery.trim()) return true
    const query = clientSearchQuery.toLowerCase()
    return (
      client.name.toLowerCase().includes(query) ||
      (client.contact_name && client.contact_name.toLowerCase().includes(query)) ||
      (client.contact_email && client.contact_email.toLowerCase().includes(query)) ||
      (client.contact_title && client.contact_title.toLowerCase().includes(query))
    )
  })

  const filteredProjects = sortedProjects

  const projectsByDate = filteredProjects.reduce((acc, project) => {
    const date = project.work_date
    if (!acc[date]) {
      acc[date] = []
    }
    acc[date].push(project)
    return acc
  }, {} as Record<string, Project[]>)

  const sortedDates = Object.keys(projectsByDate).sort()

  const todayStr = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' })

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

  const navigateDate = (offset: number) => {
    const d = new Date(selectedDate + 'T12:00:00')
    d.setDate(d.getDate() + offset)
    const newDate = d.toISOString().split('T')[0]
    setSelectedDate(newDate)
    fetchProjectsByDate(newDate)
  }

  const navigateReportDate = (offset: number) => {
    const d = new Date(reportDate + 'T12:00:00')
    d.setDate(d.getDate() + offset)
    const newDate = d.toISOString().split('T')[0]
    setReportDate(newDate)
    fetchReports(newDate)
  }

  const goToReportToday = () => {
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' })
    setReportDate(today)
    fetchReports(today)
  }

  if (loading && !admin) {
    return (
      <div style={styles.loadingContainer}>
        <p>読み込み中...</p>
      </div>
    )
  }

  if (!admin) {
    if (pendingAccessEmail) {
      return (
        <div style={styles.loginContainer}>
          <div style={styles.loginBox}>
            <div style={styles.loginLogo}>
              <img src={COMPANY_LOGO_URL} alt="日本交通誘導" style={styles.loginLogoImage} />
            </div>
            <h2 style={styles.loginSubtitle}>アクセス権限の申請</h2>
            <p style={{...styles.loginDesc, marginBottom: '16px'}}>このアカウントは管理画面へのアクセス権がありません。<br/>管理者に申請を送信できます。</p>
            <div style={{background: COLORS.lightGray, borderRadius: '8px', padding: '16px', marginBottom: '20px', textAlign: 'left' as const}}>
              <p style={{margin: '0 0 8px', fontSize: '14px', color: COLORS.darkGray}}>メールアドレス</p>
              <p style={{margin: '0 0 12px', fontSize: '16px', fontWeight: 'bold', color: COLORS.text}}>{pendingAccessEmail}</p>
              {pendingAccessName && (
                <>
                  <p style={{margin: '0 0 8px', fontSize: '14px', color: COLORS.darkGray}}>名前</p>
                  <p style={{margin: '0', fontSize: '16px', fontWeight: 'bold', color: COLORS.text}}>{pendingAccessName}</p>
                </>
              )}
            </div>
            {accessRequestResult ? (
              <div style={{background: '#e8f5e9', borderRadius: '8px', padding: '16px', marginBottom: '16px', color: '#2e7d32', textAlign: 'center' as const}}>
                {accessRequestResult}
              </div>
            ) : (
              <button
                style={{...styles.googleButton, background: COLORS.primary, color: '#fff', border: 'none', opacity: requestingAccess ? 0.6 : 1}}
                onClick={handleRequestAccess}
                disabled={requestingAccess}
              >
                {requestingAccess ? '送信中...' : 'アクセス権限を申請する'}
              </button>
            )}
            <button
              style={{...styles.googleButton, background: 'transparent', color: COLORS.darkGray, border: `1px solid ${COLORS.gray}`, marginTop: '12px'}}
              onClick={() => { setPendingAccessEmail(null); setPendingAccessName(null); setAccessRequestResult(null) }}
            >
              ログイン画面に戻る
            </button>
          </div>
        </div>
      )
    }
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
        {isMobile && sidebarOpen && (
          <div
            style={styles.sidebarOverlay}
            onClick={() => setSidebarOpen(false)}
          />
        )}
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
              style={screen === 'send_url' ? styles.sidebarItemActive : styles.sidebarItem}
              onClick={() => navigateTo('send_url')}
            >
              <span style={styles.sidebarIcon}>&#9993;</span>
              <span style={styles.sidebarText}>URL送信</span>
            </button>
            <button
              style={screen === 'clients' ? styles.sidebarItemActive : styles.sidebarItem}
              onClick={() => navigateTo('clients')}
            >
              <span style={styles.sidebarIcon}>&#127970;</span>
              <span style={styles.sidebarText}>会社管理</span>
            </button>
            {admin?.role === 'super_admin' && (
              <button
                style={screen === 'accounts' ? styles.sidebarItemActive : styles.sidebarItem}
                onClick={() => navigateTo('accounts')}
              >
                <span style={styles.sidebarIcon}>&#128100;</span>
                <span style={styles.sidebarText}>アカウント管理</span>
              </button>
            )}
          </nav>
        </aside>

        <main style={styles.main}>
          {error && <div style={styles.error}>{error}</div>}

          {screen === 'dashboard' && (
            <DashboardPage
              stats={stats}
              clients={clients}
              todayProjects={todayProjects}
              recentReports={recentReports}
              isMobile={isMobile}
              navigateTo={navigateTo}
              setEditingClient={setEditingClient}
              setCastsModalProject={setCastsModalProject}
              fetchReportDetail={fetchReportDetail}
              handleDownloadPdf={handleDownloadPdf}
              handleDeleteProjectsWithoutCasts={handleDeleteProjectsWithoutCasts}
              formatDate={formatDate}
              formatDateTime={formatDateTime}
              parseDateParts={parseDateParts}
            />
          )}

          {screen === 'csv' && (
            <CsvImportPage
              importResult={importResult}
              importing={importing}
              isDragging={isDragging}
              pendingFile={pendingFile}
              handleFileUpload={handleFileUpload}
              handleDragOver={handleDragOver}
              handleDragLeave={handleDragLeave}
              handleDrop={handleDrop}
              handleForceImport={handleForceImport}
            />
          )}

          {screen === 'projects' && (
            <ProjectsPage
              projects={projects}
              loading={loading}
              isMobile={isMobile}
              selectedDate={selectedDate}
              setSelectedDate={setSelectedDate}
              todayStr={todayStr}
              sortedDates={sortedDates}
              projectsByDate={projectsByDate}
              navigateDate={navigateDate}
              fetchProjectsByDate={fetchProjectsByDate}
              handleSort={handleSort}
              getSortIndicator={getSortIndicator}
              setCastsModalProject={setCastsModalProject}
              renderDateHeader={renderDateHeader}
              formatDate={formatDate}
            />
          )}

          {screen === 'reports' && (
            <ReportsPage
              reports={reports}
              loading={loading}
              isMobile={isMobile}
              reportDate={reportDate}
              setReportDate={setReportDate}
              todayStr={todayStr}
              selectedReportDetail={selectedReportDetail}
              loadingReportDetail={loadingReportDetail}
              resending={resending}
              resendResult={resendResult}
              deleting={deleting}
              navigateReportDate={navigateReportDate}
              goToReportToday={goToReportToday}
              fetchReports={fetchReports}
              fetchReportDetail={fetchReportDetail}
              handleDownloadPdf={handleDownloadPdf}
              handleDeleteReport={handleDeleteReport}
              handleResendNotifications={handleResendNotifications}
              setSelectedReportDetail={setSelectedReportDetail}
              setResendResult={setResendResult}
              formatDate={formatDate}
              formatDateTime={formatDateTime}
            />
          )}

          {screen === 'staff' && (
            <StaffPage
              staff={staff}
              filteredStaff={filteredStaff}
              loading={loading}
              isMobile={isMobile}
              staffSearchQuery={staffSearchQuery}
              setStaffSearchQuery={setStaffSearchQuery}
              staffImporting={staffImporting}
              staffImportResult={staffImportResult}
              setStaffImportResult={setStaffImportResult}
              showStaffModal={showStaffModal}
              setShowStaffModal={setShowStaffModal}
              newStaff={newStaff}
              setNewStaff={setNewStaff}
              creating={creating}
              editingStaff={editingStaff}
              setEditingStaff={setEditingStaff}
              savingStaff={savingStaff}
              handleStaffCsvImport={handleStaffCsvImport}
              handleCreateStaff={handleCreateStaff}
              handleUpdateStaff={handleUpdateStaff}
              handleDeleteStaff={handleDeleteStaff}
              formatDate={formatDate}
            />
          )}

          {screen === 'import_history' && (
            <ImportHistoryPage
              importHistory={importHistory}
              importedProjects={importedProjects}
              loading={loading}
              loadingImportProjects={loadingImportProjects}
              isMobile={isMobile}
              selectedImport={selectedImport}
              setSelectedImport={setSelectedImport}
              setImportedProjects={setImportedProjects}
              handleSelectImport={handleSelectImport}
              formatDate={formatDate}
              formatDateTime={formatDateTime}
            />
          )}

          {screen === 'clients' && (
            <ClientsPage
              clients={clients}
              filteredClients={filteredClients}
              loading={loading}
              isMobile={isMobile}
              clientSearchQuery={clientSearchQuery}
              setClientSearchQuery={setClientSearchQuery}
              editingClient={editingClient}
              setEditingClient={setEditingClient}
              savingClient={savingClient}
              handleUpdateClient={handleUpdateClient}
              handleDeleteClient={handleDeleteClient}
            />
          )}

          {screen === 'send_url' && (
            <SendLoginUrlPage
              staff={staff}
              isMobile={isMobile}
            />
          )}

          {screen === 'accounts' && admin?.role === 'super_admin' && (
            <AccountsPage
              admin={admin}
              accessRequests={accessRequests}
              adminAccounts={adminAccounts}
              loadingAccounts={loadingAccounts}
              approveRoles={approveRoles}
              setApproveRoles={setApproveRoles}
              handleApproveRequest={handleApproveRequest}
              handleRejectRequest={handleRejectRequest}
              handleUpdateAdminRole={handleUpdateAdminRole}
              handleDeleteAdmin={handleDeleteAdmin}
              formatDateTime={formatDateTime}
            />
          )}

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

export default AdminApp
