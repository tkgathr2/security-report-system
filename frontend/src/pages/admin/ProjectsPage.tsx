import React from 'react'
import { COLORS } from '../../constants/admin'
import { styles } from '../../styles/adminStyles'
import type { Project } from '../../types/admin'

interface ProjectsPageProps {
  projects: Project[]
  loading: boolean
  isMobile: boolean
  selectedDate: string
  setSelectedDate: (date: string) => void
  todayStr: string
  sortedDates: string[]
  projectsByDate: Record<string, Project[]>
  navigateDate: (offset: number) => void
  fetchProjectsByDate: (date: string) => void
  handleSort: (column: keyof Project) => void
  getSortIndicator: (column: keyof Project) => string
  setCastsModalProject: (project: Project) => void
  onRequestCancel: (project: Project) => void
  onRestore: (project: Project) => void
  onResendCancelEmail: (project: Project) => void
  renderDateHeader: (dateStr: string, count: number) => React.ReactNode
  formatDate: (dateStr: string) => string
}

export function ProjectsPage({
  projects,
  loading,
  isMobile,
  selectedDate,
  setSelectedDate,
  todayStr,
  sortedDates,
  projectsByDate,
  navigateDate,
  fetchProjectsByDate,
  handleSort,
  getSortIndicator,
  setCastsModalProject,
  onRequestCancel,
  onRestore,
  onResendCancelEmail,
  renderDateHeader,
  formatDate,
}: ProjectsPageProps) {
  const cancelledBadge = (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: '4px',
      backgroundColor: '#fde8e8', color: '#c81e1e', fontSize: '12px', fontWeight: 'bold',
    }}>中止</span>
  )
  return (
                      <div>
                        <div style={styles.pageHeader}>
                          <h2 style={{...styles.pageTitle, margin: 0}}>案件一覧</h2>
                          <span style={{ color: COLORS.darkGray, fontSize: '14px' }}>
                            {loading ? '' : `${projects.length}件`}
                          </span>
                        </div>

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
                              <div key={project.id} style={{...styles.mobileCard, ...(project.status === 'cancelled' ? { opacity: 0.6 } : {})}}>
                                <div style={styles.mobileCardBody}>
                                  <div style={styles.mobileCardRow}>
                                    <span style={styles.mobileCardLabel}>会社名</span>
                                    <span style={styles.mobileCardValue}>
                                      {project.status === 'cancelled' && <>{cancelledBadge} </>}
                                      {project.client_name || project.client_name_raw}
                                    </span>
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
                                  {project.status === 'cancelled' && project.cancel_reason && (
                                    <div style={styles.mobileCardRow}>
                                      <span style={styles.mobileCardLabel}>中止理由</span>
                                      <span style={styles.mobileCardValue}>{project.cancel_reason}</span>
                                    </div>
                                  )}
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
                                    onClick={() => window.open(`/report/${project.unique_url}?mode=view`, '_blank')}
                                  >
                                    報告画面
                                  </button>
                                  {project.status === 'cancelled' ? (
                                    <>
                                      <button
                                        style={{...styles.mobileActionButton, color: COLORS.primary, borderColor: COLORS.primary}}
                                        onClick={() => onRestore(project)}
                                      >
                                        復活
                                      </button>
                                      <button
                                        style={styles.mobileActionButton}
                                        onClick={() => onResendCancelEmail(project)}
                                      >
                                        中止メール再送
                                      </button>
                                    </>
                                  ) : (
                                    <button
                                      style={{...styles.mobileActionButton, color: '#c81e1e', borderColor: '#c81e1e'}}
                                      onClick={() => onRequestCancel(project)}
                                    >
                                      現場中止
                                    </button>
                                  )}
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
                                          <th style={styles.th}>状態</th>
                                          <th style={styles.th}>操作</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {projectsByDate[date].map(project => (
                                          <tr key={project.id} style={{...styles.tr, ...(project.status === 'cancelled' ? { opacity: 0.6 } : {})}}>
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
                                              {project.status === 'cancelled' ? (
                                                <span title={project.cancel_reason || ''}>
                                                  {cancelledBadge}
                                                </span>
                                              ) : '-'}
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
                                                  onClick={() => window.open(`/report/${project.unique_url}?mode=view`, '_blank')}
                                                >
                                                  報告画面
                                                </button>
                                                {project.status === 'cancelled' ? (
                                                  <>
                                                    <button
                                                      style={{...styles.smallButton, color: COLORS.primary, borderColor: COLORS.primary}}
                                                      onClick={() => onRestore(project)}
                                                    >
                                                      復活
                                                    </button>
                                                    <button
                                                      style={styles.smallButton}
                                                      onClick={() => onResendCancelEmail(project)}
                                                    >
                                                      中止メール再送
                                                    </button>
                                                  </>
                                                ) : (
                                                  <button
                                                    style={{...styles.smallButton, color: '#c81e1e', borderColor: '#c81e1e'}}
                                                    onClick={() => onRequestCancel(project)}
                                                  >
                                                    現場中止
                                                  </button>
                                                )}
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
  )
}
