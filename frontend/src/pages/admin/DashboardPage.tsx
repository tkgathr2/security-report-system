import { COLORS } from '../../constants/admin'
import { styles } from '../../styles/adminStyles'
import type { Client, DashboardStats, Project, Report, Screen } from '../../types/admin'

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
  return (
            <div>
              <h2 style={styles.pageTitle}>ダッシュボード</h2>
              
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
                            onClick={() => { navigateTo('clients'); setEditingClient(c) }}
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
