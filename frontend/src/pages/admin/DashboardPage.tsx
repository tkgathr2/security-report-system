import { useState, useEffect, useCallback } from 'react'
import { COLORS } from '../../constants/admin'
import { styles } from '../../styles/adminStyles'
import type { Client, DashboardStats, Project, Report, Screen } from '../../types/admin'

function EmailNotificationToggle() {
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const fetchSetting = useCallback(async () => {
    try {
      setLoading(true)
      setError('')
      const res = await fetch('/api/admin/settings/email-notification', {
        credentials: 'include',
      })
      if (res.ok) {
        const data = await res.json()
        setEnabled(!!data.enabled)
      } else {
        setError(`設定の取得に失敗しました（${res.status}）`)
      }
    } catch {
      setError('設定の取得に失敗しました。通信状態を確認してください。')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchSetting()
  }, [fetchSetting])

  const handleToggle = async () => {
    if (saving || enabled === null) return
    const next = !enabled
    // OFF→ON のときだけ安全確認を出す
    if (next && !window.confirm('取引先へのメール自動送信をONにします。承認された報告書が取引先（通知先メール登録済みの会社）へ自動送信されます。よろしいですか？')) {
      return
    }
    setError('')
    setSaving(true)
    try {
      const res = await fetch('/api/admin/settings/email-notification', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ enabled: next }),
      })
      if (res.ok) {
        const data = await res.json()
        setEnabled(!!data.enabled)
      } else {
        setError('設定の保存に失敗しました。時間をおいて再度お試しください。')
      }
    } catch {
      setError('通信エラーが発生しました')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ background: COLORS.white, borderRadius: '12px', padding: '20px', marginBottom: '20px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
      <h3 style={{ margin: '0 0 12px', fontSize: '16px', color: COLORS.text }}>取引先へのメール自動送信</h3>
      {loading ? (
        <p style={{ fontSize: '14px', color: COLORS.darkGray, margin: 0 }}>読み込み中...</p>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
            <div style={{ fontSize: '14px', color: COLORS.text }}>
              現在の状態：{' '}
              <span style={{ fontWeight: 'bold', color: enabled ? COLORS.success : COLORS.danger }}>
                {enabled ? 'ON（取引先へ自動送信されます）' : 'OFF（自動送信されません）'}
              </span>
            </div>
            <button
              type="button"
              onClick={handleToggle}
              disabled={saving || enabled === null}
              style={{
                backgroundColor: enabled ? COLORS.danger : COLORS.primary,
                color: COLORS.white,
                border: 'none',
                padding: '10px 20px',
                borderRadius: '8px',
                cursor: saving ? 'default' : 'pointer',
                fontSize: '14px',
                fontWeight: 500,
                whiteSpace: 'nowrap',
                opacity: saving ? 0.5 : 1,
              }}
            >
              {saving ? '保存中...' : enabled ? 'OFFにする' : 'ONにする'}
            </button>
          </div>
          <p style={{ fontSize: '12px', color: COLORS.darkGray, margin: '12px 0 0 0' }}>
            ONにすると、報告書が承認されたときに通知先メールが登録された取引先へPDF付きで自動送信されます。
          </p>
        </>
      )}
      {error && (
        <p style={{ color: COLORS.danger, fontSize: '12px', marginTop: '8px', marginBottom: 0 }}>{error}</p>
      )}
    </div>
  )
}

interface DashboardPageProps {
  stats: DashboardStats | null
  clients: Client[]
  todayProjects: Project[]
  recentReports: Report[]
  isMobile: boolean
  navigateTo: (screen: Screen) => void
  setEditingClient: (client: Client) => void
  setCastsModalProject: (project: Project) => void
  fetchReportDetail: (reportId: string) => void
  handleDownloadPdf: (reportId: string) => void
  handleDeleteProjectsWithoutCasts: () => void
  formatDate: (dateStr: string) => string
  formatDateTime: (dateStr: string) => string
  parseDateParts: (dateStr: string) => { year: string; month: string; day: string; dayOfWeek: string; isToday: boolean; isWeekend: boolean; datePart: string }
}

export function DashboardPage({
  stats,
  clients,
  todayProjects,
  recentReports,
  isMobile,
  navigateTo,
  setEditingClient,
  setCastsModalProject,
  fetchReportDetail,
  handleDownloadPdf,
  handleDeleteProjectsWithoutCasts,
  formatDate,
  formatDateTime,
  parseDateParts,
}: DashboardPageProps) {
  const [suppressedWarnings, setSuppressedWarnings] = useState<Set<string>>(new Set());

  // 非表示の警告一覧を取得
  useEffect(() => {
    const fetchSuppressedWarnings = async () => {
      try {
        const response = await fetch('/api/admin/suppressed-warnings');
        if (response.ok) {
          const data = await response.json() as { suppressedWarnings: Array<{ client_id: string }> };
          setSuppressedWarnings(new Set(data.suppressedWarnings.map(sw => sw.client_id)));
        }
      } catch (error) {
        console.error('Failed to fetch suppressed warnings:', error);
      }
    };
    fetchSuppressedWarnings();
  }, []);

  const handleSuppressWarning = async (clientId: string) => {
    try {
      const response = await fetch(`/api/admin/clients/${clientId}/suppress-warning`, { method: 'POST' });
      if (response.ok) {
        setSuppressedWarnings(prev => new Set([...prev, clientId]));
      }
    } catch (error) {
      console.error('Failed to suppress warning:', error);
    }
  };

  // 直近1か月〜未来に案件がない会社は警告に出さない（has_recent_project未定義時は表示側に倒す）
  const clientsWithoutEmail = clients.filter(c =>
    c.is_active &&
    (!c.notification_emails || c.notification_emails.length === 0) &&
    (c.has_recent_project ?? true) &&
    !suppressedWarnings.has(c.id)
  )

  return (
            <div>
              <h2 style={styles.pageTitle}>ダッシュボード</h2>

              {clientsWithoutEmail.length > 0 && (
                <div style={styles.alertBox}>
                  <span style={styles.alertIcon}>&#9888;</span>
                  <div style={styles.alertContent}>
                    <strong>メールアドレス未登録の会社があります</strong>
                    <p style={styles.alertText}>
                      以下の会社にメールアドレスが登録されていないため、報告書を送信できません：
                    </p>
                    <ul style={styles.alertList}>
                      {clientsWithoutEmail.map(c => (
                        <li key={c.id} style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
                          <span
                            style={styles.alertClientLink}
                            onClick={() => { navigateTo('clients'); setEditingClient(c) }}
                          >
                            {c.name}
                          </span>
                          <button
                            style={{
                              background: '#ff9800',
                              border: 'none',
                              borderRadius: '6px',
                              padding: '6px 12px',
                              fontSize: '12px',
                              fontWeight: 'bold',
                              color: 'white',
                              cursor: 'pointer',
                              marginLeft: '12px',
                              boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                            }}
                            onClick={() => handleSuppressWarning(c.id)}
                          >
                            非表示
                          </button>
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

              <div style={{background: COLORS.white, borderRadius: '12px', padding: '20px', marginBottom: '20px', border: `2px solid ${COLORS.primary}`, boxShadow: '0 2px 8px rgba(0,0,0,0.06)'}}>
                <h3 style={{margin: '0 0 16px', fontSize: '18px', color: COLORS.primary, display: 'flex', alignItems: 'center', gap: '8px'}}>
                  <span>&#128197;</span> {(() => {
                    const p = parseDateParts(new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' }))
                    return `${parseInt(p.month)}月${parseInt(p.day)}日（${p.dayOfWeek}）`
                  })()}
                </h3>
                <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '12px', marginBottom: '4px'}}>
                  <div style={{background: '#FFF8E1', borderRadius: '10px', padding: '16px', textAlign: 'center' as const}}>
                    <div style={{fontSize: '28px', fontWeight: 'bold', color: COLORS.primary}}>{stats?.today_projects || 0}</div>
                    <div style={{fontSize: '13px', color: COLORS.darkGray, marginTop: '4px'}}>今日の現場</div>
                  </div>
                  <div style={{background: '#E8F5E9', borderRadius: '10px', padding: '16px', textAlign: 'center' as const}}>
                    <div style={{fontSize: '28px', fontWeight: 'bold', color: '#2E7D32'}}>{stats?.today_reported || 0}</div>
                    <div style={{fontSize: '13px', color: COLORS.darkGray, marginTop: '4px'}}>報告済み</div>
                  </div>
                  <div style={{background: '#FFF3E0', borderRadius: '10px', padding: '16px', textAlign: 'center' as const}}>
                    <div style={{fontSize: '28px', fontWeight: 'bold', color: '#E65100'}}>{(stats?.today_projects || 0) - (stats?.today_reported || 0)}</div>
                    <div style={{fontSize: '13px', color: COLORS.darkGray, marginTop: '4px'}}>未報告</div>
                  </div>
                  <div style={{background: '#E3F2FD', borderRadius: '10px', padding: '16px', textAlign: 'center' as const}}>
                    <div style={{fontSize: '28px', fontWeight: 'bold', color: '#1565C0'}}>{stats?.total_reports || 0}</div>
                    <div style={{fontSize: '13px', color: COLORS.darkGray, marginTop: '4px'}}>総報告書数</div>
                  </div>
                </div>
              </div>
              
              <div style={{display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '20px', marginBottom: '20px'}}>
                <div style={{background: COLORS.white, borderRadius: '12px', padding: '20px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)'}}>
                  <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px'}}>
                    <h3 style={{margin: 0, fontSize: '16px', color: COLORS.text}}>今日の案件</h3>
                    <button style={{background: 'none', border: 'none', color: COLORS.primary, cursor: 'pointer', fontSize: '13px', fontWeight: 'bold'}} onClick={() => navigateTo('projects')}>
                      全て見る &#9654;
                    </button>
                  </div>
                  {todayProjects.length === 0 ? (
                    <p style={{color: COLORS.darkGray, fontSize: '14px', margin: '16px 0', textAlign: 'center' as const}}>今日の案件はありません</p>
                  ) : (
                    <div style={{display: 'flex', flexDirection: 'column' as const, gap: '8px'}}>
                      {todayProjects.slice(0, 5).map(project => (
                        <div key={project.id} style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', background: '#f8f9fa', borderRadius: '8px', fontSize: '13px'}}>
                          <div style={{flex: 1, minWidth: 0}}>
                            <div style={{fontWeight: 'bold', color: COLORS.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>{project.client_name || project.client_name_raw}</div>
                            <div style={{color: COLORS.darkGray, marginTop: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>{project.work_name} - {project.location}</div>
                          </div>
                          <div style={{display: 'flex', gap: '6px', marginLeft: '8px', flexShrink: 0}}>
                            {project.casts && project.casts.length > 0 && (
                              <span style={{fontSize: '12px', color: COLORS.primary, cursor: 'pointer'}} onClick={() => setCastsModalProject(project)}>
                                {project.casts.length}人
                              </span>
                            )}
                            <button
                              style={{padding: '4px 8px', fontSize: '11px', background: COLORS.primary, color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer'}}
                              onClick={() => window.open(`/report/${project.unique_url}?mode=view`, '_blank')}
                            >
                              報告
                            </button>
                          </div>
                        </div>
                      ))}
                      {todayProjects.length > 5 && (
                        <button style={{background: 'none', border: `1px solid ${COLORS.primary}`, color: COLORS.primary, padding: '8px', borderRadius: '6px', cursor: 'pointer', fontSize: '13px'}} onClick={() => navigateTo('projects')}>
                          他 {todayProjects.length - 5} 件を表示
                        </button>
                      )}
                    </div>
                  )}
                </div>

                <div style={{background: COLORS.white, borderRadius: '12px', padding: '20px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)'}}>
                  <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px'}}>
                    <h3 style={{margin: 0, fontSize: '16px', color: COLORS.text}}>最近の報告書</h3>
                    <button style={{background: 'none', border: 'none', color: COLORS.primary, cursor: 'pointer', fontSize: '13px', fontWeight: 'bold'}} onClick={() => navigateTo('reports')}>
                      全て見る &#9654;
                    </button>
                  </div>
                  {recentReports.length === 0 ? (
                    <p style={{color: COLORS.darkGray, fontSize: '14px', margin: '16px 0', textAlign: 'center' as const}}>報告書はまだありません</p>
                  ) : (
                    <div style={{display: 'flex', flexDirection: 'column' as const, gap: '8px'}}>
                      {recentReports.map(report => (
                        <div key={report.id} style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', background: '#f8f9fa', borderRadius: '8px', fontSize: '13px', cursor: 'pointer'}} onClick={() => fetchReportDetail(report.id)}>
                          <div style={{flex: 1, minWidth: 0}}>
                            <div style={{fontWeight: 'bold', color: COLORS.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>{report.client_name_raw}</div>
                            <div style={{color: COLORS.darkGray, marginTop: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>{report.work_name} - {formatDate(report.work_date)}</div>
                          </div>
                          <div style={{display: 'flex', alignItems: 'center', gap: '8px', marginLeft: '8px', flexShrink: 0}}>
                            <span style={{fontSize: '11px', color: COLORS.darkGray}}>{formatDateTime(report.approved_at)}</span>
                            {report.pdf_generation_status === 'success' && (
                              <button
                                style={{padding: '4px 8px', fontSize: '11px', background: '#4CAF50', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer'}}
                                onClick={(e) => { e.stopPropagation(); handleDownloadPdf(report.id) }}
                              >
                                PDF
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* PDFデザイン設定は非表示 */}

              <EmailNotificationToggle />

              <div style={{display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '20px'}}>
                <div style={{background: COLORS.white, borderRadius: '12px', padding: '20px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)'}}>
                  <h3 style={{margin: '0 0 12px', fontSize: '16px', color: COLORS.text}}>全体の統計</h3>
                  <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px'}}>
                    <div style={{padding: '12px', background: '#f8f9fa', borderRadius: '8px', cursor: 'pointer'}} onClick={() => navigateTo('projects')}>
                      <div style={{fontSize: '22px', fontWeight: 'bold', color: COLORS.text}}>{stats?.total_projects || 0}</div>
                      <div style={{fontSize: '12px', color: COLORS.darkGray}}>総案件数</div>
                    </div>
                    <div style={{padding: '12px', background: '#f8f9fa', borderRadius: '8px', cursor: 'pointer'}} onClick={() => navigateTo('projects')}>
                      <div style={{fontSize: '22px', fontWeight: 'bold', color: COLORS.primary}}>{stats?.active_projects || 0}</div>
                      <div style={{fontSize: '12px', color: COLORS.darkGray}}>有効な案件</div>
                    </div>
                    <div style={{padding: '12px', background: '#f8f9fa', borderRadius: '8px', cursor: 'pointer'}} onClick={() => navigateTo('reports')}>
                      <div style={{fontSize: '22px', fontWeight: 'bold', color: COLORS.text}}>{stats?.total_reports || 0}</div>
                      <div style={{fontSize: '12px', color: COLORS.darkGray}}>報告書数</div>
                    </div>
                    <div style={{padding: '12px', background: '#f8f9fa', borderRadius: '8px', cursor: 'pointer'}} onClick={() => navigateTo('staff')}>
                      <div style={{fontSize: '22px', fontWeight: 'bold', color: COLORS.text}}>{stats?.total_staff || 0}</div>
                      <div style={{fontSize: '12px', color: COLORS.darkGray}}>キャスト数</div>
                    </div>
                  </div>
                </div>
                <div style={{background: COLORS.white, borderRadius: '12px', padding: '20px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)'}}>
                  <h3 style={{margin: '0 0 12px', fontSize: '16px', color: COLORS.text}}>クイックアクション</h3>
                  <div style={{display: 'flex', flexDirection: 'column' as const, gap: '8px'}}>
                    <button style={{...styles.actionButton, margin: 0, width: '100%', textAlign: 'left' as const}} onClick={() => navigateTo('csv')}>
                      <span style={styles.actionIcon}>&#128193;</span>
                      CSVをインポート
                    </button>
                    <button style={{...styles.actionButton, margin: 0, width: '100%', textAlign: 'left' as const}} onClick={() => navigateTo('reports')}>
                      <span style={styles.actionIcon}>&#128196;</span>
                      報告書を確認
                    </button>
                    <button style={{...styles.actionButton, margin: 0, width: '100%', textAlign: 'left' as const}} onClick={() => navigateTo('staff')}>
                      <span style={styles.actionIcon}>&#128101;</span>
                      キャストを管理
                    </button>
                    <button style={{...styles.actionButton, margin: 0, width: '100%', textAlign: 'left' as const, backgroundColor: '#fff3cd', borderColor: '#ffc107'}} onClick={handleDeleteProjectsWithoutCasts}>
                      <span style={styles.actionIcon}>&#128465;</span>
                      キャストなし案件を削除
                    </button>
                  </div>
                </div>
              </div>
            </div>
  )
}
