import React from 'react'
import { COLORS } from '../../constants/admin'
import { styles } from '../../styles/adminStyles'
import type { StaffMember } from '../../types/admin'

function isNew(createdAt: string): boolean {
  const created = new Date(createdAt)
  const threeDaysAgo = new Date()
  threeDaysAgo.setDate(threeDaysAgo.getDate() - 3)
  return created >= threeDaysAgo
}

function NewBadge({ createdAt }: { createdAt: string }) {
  if (!createdAt || !isNew(createdAt)) return null
  return <span style={styles.newBadge}>NEW</span>
}

interface StaffPageProps {
  staff: StaffMember[]
  filteredStaff: StaffMember[]
  loading: boolean
  isMobile: boolean
  staffSearchQuery: string
  setStaffSearchQuery: (query: string) => void
  staffImporting: boolean
  staffImportResult: { inserted: number; updated: number; skipped: number } | null
  setStaffImportResult: (result: { inserted: number; updated: number; skipped: number } | null) => void
  showStaffModal: boolean
  setShowStaffModal: (show: boolean) => void
  newStaff: { display_name_kanji: string; display_name_kana: string }
  setNewStaff: (staff: { display_name_kanji: string; display_name_kana: string }) => void
  creating: boolean
  editingStaff: (StaffMember & { email: string | null }) | null
  setEditingStaff: (staff: (StaffMember & { email: string | null }) | null) => void
  savingStaff: boolean
  handleStaffCsvImport: (e: React.ChangeEvent<HTMLInputElement>) => void
  handleCreateStaff: () => void
  handleUpdateStaff: () => void
  handleDeleteStaff: (id: string, name: string) => void
  formatDate: (dateStr: string) => string
}

export function StaffPage({
  staff,
  filteredStaff,
  loading,
  isMobile,
  staffSearchQuery,
  setStaffSearchQuery,
  staffImporting,
  staffImportResult,
  setStaffImportResult,
  showStaffModal,
  setShowStaffModal,
  newStaff,
  setNewStaff,
  creating,
  editingStaff,
  setEditingStaff,
  savingStaff,
  handleStaffCsvImport,
  handleCreateStaff,
  handleUpdateStaff,
  handleDeleteStaff,
  formatDate,
}: StaffPageProps) {
  return (
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

              <div style={{ marginBottom: '16px' }}>
                <input
                  type="text"
                  style={styles.searchInput}
                  placeholder="氏名（漢字・カナ）またはメールで検索..."
                  value={staffSearchQuery}
                  onChange={(e) => setStaffSearchQuery(e.target.value)}
                />
                <span style={{ marginLeft: '12px', color: COLORS.darkGray, fontSize: '14px' }}>
                  {staffSearchQuery ? `${filteredStaff.length}件 / ${staff.length}件` : `${staff.length}件`}
                </span>
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
                                                                    <span style={styles.mobileCardValue}>{member.display_name_kanji}<NewBadge createdAt={member.created_at} /></span>
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
                                                                      onClick={() => setEditingStaff({ ...member, email: member.registered_email || member.email })}
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
                                                                      <td style={styles.td}>{member.display_name_kanji}<NewBadge createdAt={member.created_at} /></td>
                                                                      <td style={styles.td}>{member.display_name_kana}</td>
                                                                      <td style={styles.td}>{member.registered_email || member.email || '-'}</td>
                                                                      <td style={styles.td}>{formatDate(member.created_at)}</td>
                                                                      <td style={styles.td}>
                                                                        <button 
                                                                          style={styles.primaryButton}
                                                                          onClick={() => setEditingStaff({ ...member, email: member.registered_email || member.email })}
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


                        {editingStaff && (
                          <div style={styles.modalOverlay} onClick={() => setEditingStaff(null)}>
                            <div style={styles.modal} onClick={e => e.stopPropagation()}>
                              <h3 style={styles.modalTitle}>キャスト編集</h3>
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
                                  style={{...styles.cancelButton, backgroundColor: COLORS.danger, color: 'white'}}
                                  onClick={() => handleDeleteStaff(editingStaff.id, editingStaff.display_name_kanji)}
                                  disabled={savingStaff}
                                >
                                  削除
                                </button>
                                <div style={{ display: 'flex', gap: '8px' }}>
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
                          </div>
                        )}
                      </div>
  )
}
