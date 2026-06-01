import { COLORS } from '../../constants/admin'
import { styles } from '../../styles/adminStyles'
import type { Client } from '../../types/admin'
import { CompanyEmailManager } from '../../components/CompanyEmailManager'

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

interface ClientsPageProps {
  clients: Client[]
  filteredClients: Client[]
  loading: boolean
  isMobile: boolean
  clientSearchQuery: string
  setClientSearchQuery: (query: string) => void
  editingClient: Client | null
  setEditingClient: (client: Client | null) => void
  savingClient: boolean
  handleUpdateClient: () => void
  handleDeleteClient: (id: string, name: string) => void
}

export function ClientsPage({
  clients,
  filteredClients,
  loading,
  isMobile,
  clientSearchQuery,
  setClientSearchQuery,
  editingClient,
  setEditingClient,
  savingClient,
  handleUpdateClient,
  handleDeleteClient,
}: ClientsPageProps) {
  return (
                      <div>
                        <h2 style={styles.pageTitle}>会社管理</h2>
                        <p style={styles.description}>
                          登録済みの会社一覧です。担当者情報を編集できます。
                        </p>
                        <div style={{ marginBottom: '16px' }}>
                          <input
                            type="text"
                            style={styles.searchInput}
                            placeholder="会社名・担当者名・メールアドレスで検索..."
                            value={clientSearchQuery}
                            onChange={(e) => setClientSearchQuery(e.target.value)}
                          />
                          <span style={{ marginLeft: '12px', color: COLORS.darkGray, fontSize: '14px' }}>
                            {clientSearchQuery ? `${filteredClients.length}件 / ${clients.length}件` : `${clients.length}件`}
                          </span>
                        </div>
                        {loading ? (
                          <p>読み込み中...</p>
                        ) : clients.length === 0 ? (
                          <p style={styles.emptyMessage}>登録済みの会社はありません</p>
                        ) : filteredClients.length === 0 ? (
                          <p style={styles.emptyMessage}>検索結果がありません</p>
                        ) : isMobile ? (
                          <div style={styles.mobileCardList}>
                            {filteredClients.map(client => (
                              <div key={client.id} style={styles.mobileCard}>
                                <div style={styles.mobileCardBody}>
                                  <div style={styles.mobileCardRow}>
                                    <span style={styles.mobileCardLabel}>会社名</span>
                                    <span style={styles.mobileCardValue}>{client.name}<NewBadge createdAt={client.created_at} /></span>
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
                                  <div style={styles.mobileCardRow}>
                                    <span style={styles.mobileCardLabel}>住所</span>
                                    <span style={styles.mobileCardValue}>{client.address || '-'}</span>
                                  </div>
                                </div>
                                <div style={styles.mobileCardActions}>
                                  <button 
                                    style={styles.mobileActionButtonPrimary}
                                    onClick={() => setEditingClient(client)}
                                  >
                                    編集
                                  </button>
                                  <button 
                                    style={{...styles.mobileActionButtonPrimary, backgroundColor: COLORS.danger}}
                                    onClick={() => handleDeleteClient(client.id, client.name)}
                                  >
                                    削除
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
                                  <th style={styles.th}>住所</th>
                                  <th style={styles.th}>操作</th>
                                </tr>
                              </thead>
                              <tbody>
                                {filteredClients.map(client => (
                                  <tr key={client.id} style={styles.tr}>
                                    <td style={styles.td}>{client.name}<NewBadge createdAt={client.created_at} /></td>
                                    <td style={styles.td}>{client.contact_name || '-'}</td>
                                    <td style={styles.td}>{client.contact_title || '-'}</td>
                                    <td style={styles.td}>{client.contact_email || '-'}</td>
                                    <td style={styles.td}>{client.address || '-'}</td>
                                    <td style={styles.td}>
                                      <button 
                                        style={styles.primaryButton}
                                        onClick={() => setEditingClient(client)}
                                      >
                                        編集
                                      </button>
                                      <button 
                                        style={{...styles.secondaryButton, backgroundColor: COLORS.danger, color: 'white', marginLeft: '8px'}}
                                        onClick={() => handleDeleteClient(client.id, client.name)}
                                      >
                                        削除
                                      </button>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}

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
                                <label style={styles.label}>担当者メールアドレス</label>
                                <input
                                  type="email"
                                  style={styles.input}
                                  value={editingClient.contact_email || ''}
                                  onChange={(e) => setEditingClient({...editingClient, contact_email: e.target.value || null})}
                                  placeholder="例: yamada@example.com"
                                />
                              </div>
                              <div style={styles.formGroup}>
                                <label style={styles.label}>住所</label>
                                <input
                                  type="text"
                                  style={styles.input}
                                  value={editingClient.address || ''}
                                  onChange={(e) => setEditingClient({...editingClient, address: e.target.value || null})}
                                  placeholder="例: 東京都新宿区西新宿1-1-1"
                                />
                              </div>
                              {/* 報告書承認時の通知先（company_emails）。担当者メールとは別管理。 */}
                              <CompanyEmailManager
                                companyId={editingClient.id}
                                companyName={editingClient.name}
                              />
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
  )
}
