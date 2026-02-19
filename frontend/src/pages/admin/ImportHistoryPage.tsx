import { styles } from '../../styles/adminStyles'
import type { CsvImportHistory, Project } from '../../types/admin'

interface ImportHistoryPageProps {
  importHistory: CsvImportHistory[]
  importedProjects: Project[]
  loading: boolean
  loadingImportProjects: boolean
  isMobile: boolean
  selectedImport: CsvImportHistory | null
  setSelectedImport: (item: CsvImportHistory | null) => void
  setImportedProjects: (projects: Project[]) => void
  handleSelectImport: (item: CsvImportHistory) => void
  formatDate: (dateStr: string) => string
  formatDateTime: (dateStr: string) => string
}

export function ImportHistoryPage({
  importHistory,
  importedProjects,
  loading,
  loadingImportProjects,
  isMobile,
  selectedImport,
  setSelectedImport,
  setImportedProjects,
  handleSelectImport,
  formatDate,
  formatDateTime,
}: ImportHistoryPageProps) {
  return (
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
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {importedProjects.map(project => (
                                          <tr key={project.id} style={styles.tr}>
                                            <td style={styles.td}>{formatDate(project.work_date)}</td>
                                            <td style={styles.td}>{project.client_name_raw}</td>
                                            <td style={styles.td}>{project.work_name}</td>
                                            <td style={styles.td}>{project.location}</td>
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
  )
}
