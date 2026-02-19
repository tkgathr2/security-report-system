import React from 'react'
import { COLORS } from '../../constants/admin'
import { styles } from '../../styles/adminStyles'
import type { AccessRequest, AdminAccount, AdminUser } from '../../types/admin'

interface AccountsPageProps {
  admin: AdminUser
  accessRequests: AccessRequest[]
  adminAccounts: AdminAccount[]
  loadingAccounts: boolean
  approveRoles: Record<string, string>
  setApproveRoles: React.Dispatch<React.SetStateAction<Record<string, string>>>
  handleApproveRequest: (requestId: string, role: string) => void
  handleRejectRequest: (requestId: string) => void
  handleUpdateAdminRole: (accountId: string, role: string) => void
  handleDeleteAdmin: (accountId: string) => void
  formatDateTime: (dateStr: string) => string
}

export function AccountsPage({
  admin,
  accessRequests,
  adminAccounts,
  loadingAccounts,
  approveRoles,
  setApproveRoles,
  handleApproveRequest,
  handleRejectRequest,
  handleUpdateAdminRole,
  handleDeleteAdmin,
  formatDateTime,
}: AccountsPageProps) {
  return (
            <div>
              <h2 style={styles.pageTitle}>アカウント管理</h2>

              {loadingAccounts ? (
                <p>読み込み中...</p>
              ) : (
                <>
                  <h3 style={{marginBottom: '12px', color: COLORS.secondary}}>アクセス申請一覧</h3>
                  {accessRequests.filter(r => r.status === 'pending').length === 0 ? (
                    <p style={{color: COLORS.darkGray, marginBottom: '24px'}}>保留中の申請はありません</p>
                  ) : (
                    <div style={{...styles.tableContainer, marginBottom: '24px'}}>
                      <table style={styles.table}>
                        <thead>
                          <tr>
                            <th style={styles.th}>メール</th>
                            <th style={styles.th}>名前</th>
                            <th style={styles.th}>申請日時</th>
                            <th style={styles.th}>操作</th>
                          </tr>
                        </thead>
                        <tbody>
                          {accessRequests.filter(r => r.status === 'pending').map(req => (
                            <tr key={req.id} style={styles.tr}>
                              <td style={styles.td}>{req.email}</td>
                              <td style={styles.td}>{req.display_name || '-'}</td>
                              <td style={styles.td}>{formatDateTime(req.created_at)}</td>
                              <td style={styles.td}>
                                <div style={{display: 'flex', gap: '8px', alignItems: 'center'}}>
                                  <select
                                    value={approveRoles[req.id] || 'viewer'}
                                    onChange={(e) => setApproveRoles(prev => ({...prev, [req.id]: e.target.value}))}
                                    style={{padding: '6px 10px', borderRadius: '4px', border: `1px solid ${COLORS.gray}`, fontSize: '13px'}}
                                  >
                                    <option value="viewer">閲覧権限</option>
                                    <option value="admin">管理者権限</option>
                                  </select>
                                  <button style={{...styles.primaryButton, background: COLORS.success, fontSize: '13px', padding: '6px 16px'}} onClick={() => handleApproveRequest(req.id, approveRoles[req.id] || 'viewer')}>承認</button>
                                  <button style={{...styles.primaryButton, background: COLORS.danger, fontSize: '13px', padding: '6px 16px'}} onClick={() => handleRejectRequest(req.id)}>拒否</button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {accessRequests.filter(r => r.status !== 'pending').length > 0 && (
                    <>
                      <h3 style={{marginBottom: '12px', color: COLORS.secondary}}>処理済み申請</h3>
                      <div style={{...styles.tableContainer, marginBottom: '24px'}}>
                        <table style={styles.table}>
                          <thead>
                            <tr>
                              <th style={styles.th}>メール</th>
                              <th style={styles.th}>名前</th>
                              <th style={styles.th}>ステータス</th>
                              <th style={styles.th}>処理者</th>
                              <th style={styles.th}>処理日時</th>
                            </tr>
                          </thead>
                          <tbody>
                            {accessRequests.filter(r => r.status !== 'pending').map(req => (
                              <tr key={req.id} style={styles.tr}>
                                <td style={styles.td}>{req.email}</td>
                                <td style={styles.td}>{req.display_name || '-'}</td>
                                <td style={styles.td}>
                                  <span style={{padding: '2px 8px', borderRadius: '4px', fontSize: '12px', background: req.status === 'approved' ? '#e8f5e9' : '#ffebee', color: req.status === 'approved' ? '#2e7d32' : '#c62828'}}>
                                    {req.status === 'approved' ? '承認済' : '拒否'}
                                  </span>
                                </td>
                                <td style={styles.td}>{req.reviewed_by || '-'}</td>
                                <td style={styles.td}>{req.reviewed_at ? formatDateTime(req.reviewed_at) : '-'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}

                  <h3 style={{marginBottom: '12px', color: COLORS.secondary}}>管理者アカウント一覧</h3>
                  <div style={styles.tableContainer}>
                    <table style={styles.table}>
                      <thead>
                        <tr>
                          <th style={styles.th}>メール</th>
                          <th style={styles.th}>権限</th>
                          <th style={styles.th}>操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {adminAccounts.map(acc => (
                          <tr key={acc.id} style={styles.tr}>
                            <td style={styles.td}>{acc.email}</td>
                            <td style={styles.td}>
                              <select
                                value={acc.role || 'admin'}
                                onChange={(e) => handleUpdateAdminRole(acc.id, e.target.value)}
                                style={{padding: '4px 8px', borderRadius: '4px', border: `1px solid ${COLORS.gray}`}}
                              >
                                <option value="super_admin">スーパー管理者</option>
                                <option value="admin">管理者権限</option>
                                <option value="viewer">閲覧権限</option>
                              </select>
                            </td>
                            <td style={styles.td}>
                              {acc.email !== admin.email && (
                                <button style={{...styles.primaryButton, background: COLORS.danger, fontSize: '12px', padding: '4px 12px'}} onClick={() => handleDeleteAdmin(acc.id)}>無効化</button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
  )
}
