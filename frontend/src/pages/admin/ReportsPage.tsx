import { COLORS, WEATHER_LABELS, GUARD_CONTENT_LABELS } from '../../constants/admin'
import { styles } from '../../styles/adminStyles'
import type { Report, ReportDetail } from '../../types/admin'

interface ReportsPageProps {
  reports: Report[]
  loading: boolean
  isMobile: boolean
  reportDate: string
  setReportDate: (date: string) => void
  todayStr: string
  selectedReportDetail: ReportDetail | null
  loadingReportDetail: boolean
  resending: boolean
  resendResult: string | null
  deleting: boolean
  navigateReportDate: (offset: number) => void
  goToReportToday: () => void
  fetchReports: (date: string) => void
  fetchReportDetail: (reportId: string) => void
  handleDownloadPdf: (reportId: string) => void
  handleDeleteReport: (reportId: string) => void
  handleResendNotifications: (reportId: string) => void
  setSelectedReportDetail: (detail: ReportDetail | null) => void
  setResendResult: (result: string | null) => void
  formatDate: (dateStr: string) => string
  formatDateTime: (dateStr: string) => string
}

export function ReportsPage({
  reports,
  loading,
  isMobile,
  reportDate,
  setReportDate,
  todayStr,
  selectedReportDetail,
  loadingReportDetail,
  resending,
  resendResult,
  deleting,
  navigateReportDate,
  goToReportToday,
  fetchReports,
  fetchReportDetail,
  handleDownloadPdf,
  handleDeleteReport,
  handleResendNotifications,
  setSelectedReportDetail,
  setResendResult,
  formatDate,
  formatDateTime,
}: ReportsPageProps) {
  return (
    <>
                      <div>
                        <h2 style={styles.pageTitle}>報告書一覧</h2>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' }}>
                          <button
                            style={{ padding: '8px 16px', backgroundColor: COLORS.white, border: `1px solid ${COLORS.primary}`, color: COLORS.primary, borderRadius: '6px', cursor: 'pointer', fontSize: '14px', fontWeight: 'bold' }}
                            onClick={() => navigateReportDate(-1)}
                            disabled={loading}
                          >
                            &#9664; 前日
                          </button>
                          <input
                            type="date"
                            value={reportDate}
                            onChange={(e) => {
                              if (e.target.value) {
                                setReportDate(e.target.value)
                                fetchReports(e.target.value)
                              }
                            }}
                            disabled={loading}
                            style={{ padding: '8px 12px', border: `1px solid ${COLORS.primary}`, borderRadius: '6px', fontSize: '16px', fontWeight: 'bold', color: COLORS.text, textAlign: 'center' }}
                          />
                          <button
                            style={{ padding: '8px 16px', backgroundColor: COLORS.white, border: `1px solid ${COLORS.primary}`, color: COLORS.primary, borderRadius: '6px', cursor: 'pointer', fontSize: '14px', fontWeight: 'bold' }}
                            onClick={() => navigateReportDate(1)}
                            disabled={loading}
                          >
                            翌日 &#9654;
                          </button>
                          {reportDate !== todayStr && (
                            <button
                              style={{ padding: '8px 16px', backgroundColor: COLORS.primary, border: 'none', color: COLORS.white, borderRadius: '6px', cursor: 'pointer', fontSize: '14px', fontWeight: 'bold' }}
                              onClick={goToReportToday}
                              disabled={loading}
                            >
                              今日
                            </button>
                          )}
                        </div>
                        {loading ? (
                          <p>読み込み中...</p>
                        ) : reports.length === 0 ? (
                          <p style={styles.emptyMessage}>この日の報告書はありません</p>
                        ) : isMobile ? (
                          <div style={styles.mobileCardList}>
                            {reports.map(report => (
                              <div key={report.id} style={{...styles.mobileCard, cursor: 'pointer'}} onClick={() => fetchReportDetail(report.id)}>
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
                                  <button
                                    style={{...styles.mobileActionButtonPrimary, background: COLORS.primary}}
                                    onClick={(e) => { e.stopPropagation(); fetchReportDetail(report.id) }}
                                  >
                                    詳細を見る
                                  </button>
                                  {report.pdf_generation_status === 'success' ? (
                                    <button 
                                      style={styles.mobileActionButtonPrimary}
                                      onClick={(e) => { e.stopPropagation(); handleDownloadPdf(report.id) }}
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
                                    <th style={styles.th}>操作</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {reports.map(report => (
                                    <tr key={report.id} style={{...styles.tr, cursor: 'pointer'}} onClick={() => fetchReportDetail(report.id)}>
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
                                            onClick={(e) => { e.stopPropagation(); handleDownloadPdf(report.id) }}
                                          >
                                            ダウンロード ({Math.round(report.pdf_size / 1024)}KB)
                                          </button>
                                        ) : (
                                          <span style={styles.pdfPending}>
                                            {report.pdf_generation_status === 'pending' ? '生成中' : '未生成'}
                                          </span>
                                        )}
                                      </td>
                                      <td style={styles.td}>
                                        <button
                                          style={{...styles.primaryButton, fontSize: '13px', padding: '6px 16px'}}
                                          onClick={(e) => { e.stopPropagation(); fetchReportDetail(report.id) }}
                                        >
                                          詳細
                                        </button>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        )}
                      </div>

                    {(selectedReportDetail || loadingReportDetail) && (
                      <div style={styles.modalOverlay} onClick={() => setSelectedReportDetail(null)}>
                        <div style={{...styles.modalContent, maxWidth: '700px', maxHeight: '90vh', overflow: 'auto'}} onClick={e => e.stopPropagation()}>
                          <div style={styles.modalHeader}>
                            <h3 style={styles.modalTitle}>報告書詳細</h3>
                            <button style={styles.modalClose} onClick={() => setSelectedReportDetail(null)}>×</button>
                          </div>
                          {loadingReportDetail ? (
                            <p style={{padding: '20px'}}>読み込み中...</p>
                          ) : selectedReportDetail && (
                            <div style={{padding: '20px'}}>
                              <div style={{display: 'grid', gridTemplateColumns: '120px 1fr', gap: '8px 16px', marginBottom: '20px'}}>
                                <span style={{fontWeight: 'bold', color: '#666'}}>会社名</span>
                                <span>{selectedReportDetail.client_name_raw}</span>
                                <span style={{fontWeight: 'bold', color: '#666'}}>案件名</span>
                                <span>{selectedReportDetail.work_title_raw || selectedReportDetail.work_name}</span>
                                <span style={{fontWeight: 'bold', color: '#666'}}>実施日</span>
                                <span>{formatDate(selectedReportDetail.work_date)}</span>
                                <span style={{fontWeight: 'bold', color: '#666'}}>実施場所</span>
                                <span>{selectedReportDetail.location}</span>
                                <span style={{fontWeight: 'bold', color: '#666'}}>天気</span>
                                <span>{WEATHER_LABELS[selectedReportDetail.weather] || selectedReportDetail.weather}</span>
                                <span style={{fontWeight: 'bold', color: '#666'}}>監督者</span>
                                <span>{selectedReportDetail.supervisor_name}</span>
                                <span style={{fontWeight: 'bold', color: '#666'}}>記入者</span>
                                <span>{selectedReportDetail.writer_name}</span>
                                <span style={{fontWeight: 'bold', color: '#666'}}>承認日時</span>
                                <span>{formatDateTime(selectedReportDetail.approved_at)}</span>
                                <span style={{fontWeight: 'bold', color: '#666'}}>資格者</span>
                                <span>{selectedReportDetail.has_qualifier ? `有 (${selectedReportDetail.qualifier_name || '未記入'})` : '無'}</span>
                              </div>

                              <div style={{marginBottom: '20px'}}>
                                <h4 style={{margin: '0 0 8px', color: '#333'}}>警備内容</h4>
                                <div style={{display: 'flex', flexWrap: 'wrap', gap: '6px'}}>
                                  {(selectedReportDetail.guard_contents || []).map(code => (
                                    <span key={code} style={{background: '#E8F5E9', color: '#2E7D32', padding: '4px 10px', borderRadius: '12px', fontSize: '13px'}}>
                                      {GUARD_CONTENT_LABELS[code] || code}
                                    </span>
                                  ))}
                                </div>
                                {selectedReportDetail.guard_other_text && (
                                  <p style={{margin: '8px 0 0', color: '#555'}}>その他: {selectedReportDetail.guard_other_text}</p>
                                )}
                              </div>

                              {selectedReportDetail.guards_json && (() => {
                                const guards = typeof selectedReportDetail.guards_json === 'string'
                                  ? JSON.parse(selectedReportDetail.guards_json) as Array<{index?: number; name?: string; start_time?: string; end_time?: string; early_overtime_hours?: number | null}>
                                  : selectedReportDetail.guards_json as unknown as Array<{index?: number; name?: string; start_time?: string; end_time?: string; early_overtime_hours?: number | null}>;
                                return guards.length > 0 ? (
                                  <div style={{marginBottom: '20px'}}>
                                    <h4 style={{margin: '0 0 8px', color: '#333'}}>警備員一覧</h4>
                                    <table style={{width: '100%', borderCollapse: 'collapse', fontSize: '13px'}}>
                                      <thead>
                                        <tr>
                                          <th style={{border: '1px solid #ddd', padding: '6px 8px', background: '#f5f5f5', textAlign: 'left'}}>No</th>
                                          <th style={{border: '1px solid #ddd', padding: '6px 8px', background: '#f5f5f5', textAlign: 'left'}}>氏名</th>
                                          <th style={{border: '1px solid #ddd', padding: '6px 8px', background: '#f5f5f5', textAlign: 'left'}}>開始</th>
                                          <th style={{border: '1px solid #ddd', padding: '6px 8px', background: '#f5f5f5', textAlign: 'left'}}>終了</th>
                                          <th style={{border: '1px solid #ddd', padding: '6px 8px', background: '#f5f5f5', textAlign: 'left'}}>早出残業(h)</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {guards.map((g: {index?: number; name?: string; start_time?: string; end_time?: string; early_overtime_hours?: number | null}, i: number) => (
                                          <tr key={i}>
                                            <td style={{border: '1px solid #ddd', padding: '6px 8px'}}>{g.index ?? ''}</td>
                                            <td style={{border: '1px solid #ddd', padding: '6px 8px'}}>{g.name || ''}</td>
                                            <td style={{border: '1px solid #ddd', padding: '6px 8px'}}>{g.start_time || ''}</td>
                                            <td style={{border: '1px solid #ddd', padding: '6px 8px'}}>{g.end_time || ''}</td>
                                            <td style={{border: '1px solid #ddd', padding: '6px 8px'}}>{g.early_overtime_hours != null ? g.early_overtime_hours : ''}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                ) : null;
                              })()}

                              {selectedReportDetail.signature_png_base64 && (
                                <div style={{marginBottom: '20px'}}>
                                  <h4 style={{margin: '0 0 12px', color: '#333', fontSize: '16px'}}>署名</h4>
                                  <div style={{border: '2px solid #ddd', borderRadius: '12px', padding: '20px', background: '#fafafa', textAlign: 'center' as const}}>
                                    <img
                                      src={`data:image/png;base64,${selectedReportDetail.signature_png_base64}`}
                                      alt="署名"
                                      style={{width: '100%', maxWidth: '500px', height: 'auto', minHeight: '120px'}}
                                    />
                                  </div>
                                </div>
                              )}

                              {resendResult && (
                                <div style={{padding: '8px 12px', borderRadius: '6px', marginTop: '12px', background: resendResult.startsWith('送信完了') ? '#E8F5E9' : '#FFF3E0', color: resendResult.startsWith('送信完了') ? '#2E7D32' : '#E65100', fontSize: '13px'}}>
                                  {resendResult}
                                </div>
                              )}

                              <div style={{display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '16px'}}>
                                <button
                                  style={{...styles.primaryButton, background: '#d32f2f', color: '#fff', opacity: deleting ? 0.6 : 1}}
                                  onClick={() => handleDeleteReport(selectedReportDetail.id)}
                                  disabled={deleting}
                                >
                                  {deleting ? '削除中...' : '削除'}
                                </button>
                                <button
                                  style={{...styles.primaryButton, background: '#1976D2', opacity: resending ? 0.6 : 1}}
                                  onClick={() => handleResendNotifications(selectedReportDetail.id)}
                                  disabled={resending}
                                >
                                  {resending ? '送信中...' : '再送信'}
                                </button>
                                {selectedReportDetail.pdf_generation_status === 'success' && (
                                  <button style={styles.primaryButton} onClick={() => handleDownloadPdf(selectedReportDetail.id)}>
                                    PDFダウンロード
                                  </button>
                                )}
                                <button style={styles.secondaryButton} onClick={() => { setSelectedReportDetail(null); setResendResult(null) }}>
                                  閉じる
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
    </>
  )
}
