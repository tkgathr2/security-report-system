import React, { useState, useMemo, useEffect } from 'react'
import { COLORS } from '../../constants/admin'
import { styles } from '../../styles/adminStyles'
import type { StaffMember, CompatPair } from '../../types/admin'

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
  handleClearPin: (id: string) => void
  handleBulkClearPins: () => void
  formatDate: (dateStr: string) => string
}

type PinSortMode = 'none' | 'registered' | 'unregistered'

function PinBadge({ hasPin }: { hasPin: boolean }) {
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 8px',
      borderRadius: '12px',
      fontSize: '12px',
      fontWeight: 'bold',
      backgroundColor: hasPin ? '#e8f5e9' : '#fff3e0',
      color: hasPin ? '#2e7d32' : '#e65100',
      border: `1px solid ${hasPin ? '#a5d6a7' : '#ffcc80'}`,
    }}>
      {hasPin ? '登録済' : '未登録'}
    </span>
  )
}

function SoloBadge({ soloOk }: { soloOk?: boolean }) {
  if (soloOk === true) return null
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 6px',
      borderRadius: '4px',
      fontSize: '11px',
      fontWeight: 700,
      backgroundColor: '#fff3e0',
      color: '#e65100',
      border: '1px solid #ffcc80',
      marginLeft: '6px',
      verticalAlign: 'middle',
    }}>
      1人立ち未承認
    </span>
  )
}

// ===== 管制ナレッジ編集モーダル =====
interface ControlKnowledgeModalProps {
  member: StaffMember
  onClose: () => void
  onSaved: () => void
}

function ControlKnowledgeModal({ member, onClose, onSaved }: ControlKnowledgeModalProps) {
  const [soloOk, setSoloOk] = useState<boolean>(member.solo_ok ?? false)
  const [nightOk, setNightOk] = useState<boolean>(member.night_ok ?? true)
  const [controlNote, setControlNote] = useState<string>(member.control_note ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/control-knowledge/staff/${member.id}/constraints`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          solo_ok: soloOk,
          night_ok: nightOk,
          control_note: controlNote.trim() || null,
        }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error((d as { message?: string }).message || `HTTP ${res.status}`)
      }
      onSaved()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={styles.modalOverlay} onClick={onClose}>
      <div style={{ ...styles.modal, width: '460px', maxWidth: '95%' }} onClick={e => e.stopPropagation()}>
        <h3 style={styles.modalTitle}>
          管制ナレッジ編集
          <span style={{ fontSize: '14px', fontWeight: 400, color: COLORS.darkGray, marginLeft: '10px' }}>
            {member.display_name_kanji}
          </span>
        </h3>

        {error && (
          <div style={{ ...styles.error, marginBottom: '16px' }}>{error}</div>
        )}

        <div style={styles.formGroup}>
          <label style={{ ...styles.label, display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={soloOk}
              onChange={e => setSoloOk(e.target.checked)}
              style={{ width: '18px', height: '18px', cursor: 'pointer' }}
            />
            <span>1人立ちOK（単独現場に配置可）</span>
          </label>
          {!soloOk && (
            <div style={{ marginTop: '6px', marginLeft: '28px', fontSize: '13px', color: '#e65100' }}>
              未承認の場合は管制ボードで「1人立ち未承認」として警告されます
            </div>
          )}
        </div>

        <div style={styles.formGroup}>
          <label style={{ ...styles.label, display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={nightOk}
              onChange={e => setNightOk(e.target.checked)}
              style={{ width: '18px', height: '18px', cursor: 'pointer' }}
            />
            <span>夜勤可（夜番シフトに配置可）</span>
          </label>
          {!nightOk && (
            <div style={{ marginTop: '6px', marginLeft: '28px', fontSize: '13px', color: '#e65100' }}>
              夜勤NGの場合は夜番配置時に「夜勤NG」として警告されます
            </div>
          )}
        </div>

        <div style={styles.formGroup}>
          <label style={styles.label}>管制メモ</label>
          <textarea
            style={{
              ...styles.input,
              minHeight: '80px',
              resize: 'vertical',
              fontFamily: 'inherit',
              fontSize: '14px',
            }}
            value={controlNote}
            onChange={e => setControlNote(e.target.value)}
            placeholder="配置時の注意事項など（任意）"
          />
        </div>

        <div style={styles.modalActions}>
          <button style={styles.cancelButton} onClick={onClose} disabled={saving}>
            キャンセル
          </button>
          <button style={styles.primaryButton} onClick={handleSave} disabled={saving}>
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ===== 相性ペア管理セクション =====
interface CompatSectionProps {
  staff: StaffMember[]
}

function CompatSection({ staff }: CompatSectionProps) {
  const [pairs, setPairs] = useState<CompatPair[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [staffAId, setStaffAId] = useState('')
  const [staffBId, setStaffBId] = useState('')
  const [note, setNote] = useState('')
  const [adding, setAdding] = useState(false)

  const fetchPairs = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/control-knowledge/compat', { credentials: 'include' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const d = await res.json()
      setPairs((d as { pairs: CompatPair[] }).pairs || [])
    } catch (e) {
      setError(e instanceof Error ? e.message : '取得に失敗しました')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchPairs() }, [])

  const handleAdd = async () => {
    if (!staffAId || !staffBId) {
      setError('キャスト2名を選択してください')
      return
    }
    if (staffAId === staffBId) {
      setError('同じキャストは選択できません')
      return
    }
    setAdding(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/control-knowledge/compat', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ staff_a_id: staffAId, staff_b_id: staffBId, kind: 'avoid', note: note.trim() || null }),
      })
      if (res.status === 409) {
        setError('このペアはすでに登録されています')
        return
      }
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error((d as { message?: string }).message || `HTTP ${res.status}`)
      }
      setStaffAId('')
      setStaffBId('')
      setNote('')
      fetchPairs()
    } catch (e) {
      setError(e instanceof Error ? e.message : '登録に失敗しました')
    } finally {
      setAdding(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!window.confirm('このペアを削除しますか？')) return
    try {
      const res = await fetch(`/api/admin/control-knowledge/compat/${id}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      fetchPairs()
    } catch (e) {
      setError(e instanceof Error ? e.message : '削除に失敗しました')
    }
  }

  const selectStyle: React.CSSProperties = {
    padding: '10px 12px',
    fontSize: '14px',
    border: `1px solid ${COLORS.gray}`,
    borderRadius: '8px',
    backgroundColor: COLORS.white,
    cursor: 'pointer',
    minWidth: '160px',
    flex: 1,
  }

  return (
    <div style={{ marginTop: '40px' }}>
      <h3 style={{ ...styles.sectionTitle, marginBottom: '12px' }}>相性NGペア管理</h3>
      <p style={{ fontSize: '13px', color: COLORS.darkGray, marginBottom: '16px' }}>
        同じ現場に配置しないキャストのペアを登録します。配置時に管制ボードで「相性NG」として警告されます。
      </p>

      {error && (
        <div style={{ ...styles.error, marginBottom: '12px' }}>{error}</div>
      )}

      {/* 新規登録フォーム */}
      <div style={{
        display: 'flex',
        gap: '10px',
        flexWrap: 'wrap',
        alignItems: 'flex-end',
        padding: '16px',
        backgroundColor: '#f8f9fa',
        borderRadius: '8px',
        marginBottom: '20px',
        border: `1px solid ${COLORS.gray}`,
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: 1, minWidth: '140px' }}>
          <label style={{ fontSize: '12px', color: COLORS.darkGray, fontWeight: 500 }}>キャストA</label>
          <select value={staffAId} onChange={e => setStaffAId(e.target.value)} style={selectStyle}>
            <option value="">選択してください</option>
            {staff.map(m => (
              <option key={m.id} value={m.id}>{m.display_name_kanji}</option>
            ))}
          </select>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: 1, minWidth: '140px' }}>
          <label style={{ fontSize: '12px', color: COLORS.darkGray, fontWeight: 500 }}>キャストB</label>
          <select value={staffBId} onChange={e => setStaffBId(e.target.value)} style={selectStyle}>
            <option value="">選択してください</option>
            {staff.map(m => (
              <option key={m.id} value={m.id}>{m.display_name_kanji}</option>
            ))}
          </select>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: 2, minWidth: '160px' }}>
          <label style={{ fontSize: '12px', color: COLORS.darkGray, fontWeight: 500 }}>理由メモ（任意）</label>
          <input
            type="text"
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="例: 過去にトラブルあり"
            style={{ ...styles.input, padding: '10px 12px', fontSize: '14px' }}
          />
        </div>
        <button
          style={{ ...styles.primaryButton, padding: '10px 20px', fontSize: '14px', whiteSpace: 'nowrap' }}
          onClick={handleAdd}
          disabled={adding}
        >
          {adding ? '登録中...' : '+ 登録'}
        </button>
      </div>

      {/* ペア一覧 */}
      {loading ? (
        <p style={{ color: COLORS.darkGray, fontSize: '14px' }}>読み込み中...</p>
      ) : pairs.length === 0 ? (
        <p style={{ ...styles.emptyMessage, padding: '20px' }}>登録されたNGペアはありません</p>
      ) : (
        <div style={styles.card}>
          <div style={styles.tableContainer}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>キャストA</th>
                  <th style={styles.th}>キャストB</th>
                  <th style={styles.th}>区分</th>
                  <th style={styles.th}>理由メモ</th>
                  <th style={styles.th}>操作</th>
                </tr>
              </thead>
              <tbody>
                {pairs.map(pair => (
                  <tr key={pair.id} style={styles.tr}>
                    <td style={styles.td}>{pair.staff_a_name}</td>
                    <td style={styles.td}>{pair.staff_b_name}</td>
                    <td style={styles.td}>
                      <span style={{
                        display: 'inline-block',
                        padding: '2px 8px',
                        borderRadius: '12px',
                        fontSize: '12px',
                        fontWeight: 700,
                        backgroundColor: pair.kind === 'avoid' ? '#fdeef1' : '#e8f5e9',
                        color: pair.kind === 'avoid' ? '#c0392b' : '#2e7d32',
                        border: `1px solid ${pair.kind === 'avoid' ? '#e57373' : '#a5d6a7'}`,
                      }}>
                        {pair.kind === 'avoid' ? '同現場NG' : '相性良好'}
                      </span>
                    </td>
                    <td style={{ ...styles.td, color: COLORS.darkGray }}>{pair.note || '-'}</td>
                    <td style={styles.td}>
                      <button
                        style={{
                          padding: '6px 12px',
                          backgroundColor: '#d32f2f',
                          color: 'white',
                          border: 'none',
                          borderRadius: '6px',
                          cursor: 'pointer',
                          fontSize: '13px',
                        }}
                        onClick={() => handleDelete(pair.id)}
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
    </div>
  )
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
  handleClearPin,
  handleBulkClearPins,
  formatDate,
}: StaffPageProps) {
  const [pinSort, setPinSort] = useState<PinSortMode>('none')
  const [ckModalMember, setCkModalMember] = useState<StaffMember | null>(null)
  // staffRefresh is signalled by incrementing; StaffPage itself cannot re-fetch, so we call a no-op
  // The parent App.tsx fetchStaff will be called via onSaved below — but we don't have direct access.
  // Instead we keep a local refresh counter to re-trigger parent if prop updates.
  const [_refreshCount, setRefreshCount] = useState(0)

  const sortedStaff = useMemo(() => {
    if (pinSort === 'none') return filteredStaff
    return [...filteredStaff].sort((a, b) => {
      if (pinSort === 'registered') {
        if (a.has_pin && !b.has_pin) return -1
        if (!a.has_pin && b.has_pin) return 1
      } else {
        if (!a.has_pin && b.has_pin) return -1
        if (a.has_pin && !b.has_pin) return 1
      }
      return 0
    })
  }, [filteredStaff, pinSort])

  const cyclePinSort = () => {
    setPinSort(prev => prev === 'none' ? 'registered' : prev === 'registered' ? 'unregistered' : 'none')
  }

  const pinSortLabel = pinSort === 'none' ? '暗証番号' : pinSort === 'registered' ? '暗証番号 ▲' : '暗証番号 ▼'

  return (
    <div>
      <div style={styles.pageHeader}>
        <h2 style={{ ...styles.pageTitle, margin: 0 }}>キャスト管理</h2>
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
          <button
            style={{ ...styles.secondaryButton, backgroundColor: '#d32f2f', color: 'white', border: 'none' }}
            onClick={handleBulkClearPins}
            disabled={savingStaff}
          >
            PIN一括クリア
          </button>
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
        <p style={styles.emptyMessage}>キャストが登録されていません</p>
      ) : filteredStaff.length === 0 ? (
        <p style={styles.emptyMessage}>検索結果がありません</p>
      ) : isMobile ? (
        <div style={styles.mobileCardList}>
          {sortedStaff.map(member => (
            <div key={member.id} style={styles.mobileCard}>
              <div style={styles.mobileCardBody}>
                <div style={styles.mobileCardRow}>
                  <span style={styles.mobileCardLabel}>氏名（漢字）</span>
                  <span style={styles.mobileCardValue}>
                    {member.display_name_kanji}
                    <NewBadge createdAt={member.created_at} />
                    <SoloBadge soloOk={member.solo_ok} />
                  </span>
                </div>
                <div style={styles.mobileCardRow}>
                  <span style={styles.mobileCardLabel}>氏名（カナ）</span>
                  <span style={styles.mobileCardValue}>{member.display_name_kana}</span>
                </div>
                <div style={styles.mobileCardRow}>
                  <span style={styles.mobileCardLabel}>スタッフNo</span>
                  <span style={styles.mobileCardValue}>{member.procast_staff_no || '-'}</span>
                </div>
                <div style={styles.mobileCardRow}>
                  <span style={styles.mobileCardLabel}>メールアドレス</span>
                  <span style={styles.mobileCardValue}>{member.registered_email || member.email || '-'}</span>
                </div>
                <div style={styles.mobileCardRow}>
                  <span style={styles.mobileCardLabel}>暗証番号</span>
                  <span style={styles.mobileCardValue}><PinBadge hasPin={member.has_pin} /></span>
                </div>
                <div style={styles.mobileCardRow}>
                  <span style={styles.mobileCardLabel}>登録日</span>
                  <span style={styles.mobileCardValue}>{formatDate(member.created_at)}</span>
                </div>
                <div style={{ ...styles.mobileCardRow, gap: '8px' }}>
                  <button
                    style={styles.primaryButton}
                    onClick={() => setEditingStaff({ ...member, email: member.registered_email || member.email })}
                  >
                    編集
                  </button>
                  <button
                    style={{ ...styles.secondaryButton, fontSize: '13px', padding: '8px 14px' }}
                    onClick={() => setCkModalMember(member)}
                  >
                    管制ナレッジ
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
                  <th style={styles.th}>スタッフNo</th>
                  <th style={styles.th}>メールアドレス</th>
                  <th style={{ ...styles.th, cursor: 'pointer', userSelect: 'none' }} onClick={cyclePinSort}>{pinSortLabel}</th>
                  <th style={styles.th}>登録日</th>
                  <th style={styles.th}>操作</th>
                </tr>
              </thead>
              <tbody>
                {sortedStaff.map(member => (
                  <tr key={member.id} style={styles.tr}>
                    <td style={styles.td}>
                      {member.display_name_kanji}
                      <NewBadge createdAt={member.created_at} />
                      <SoloBadge soloOk={member.solo_ok} />
                    </td>
                    <td style={styles.td}>{member.display_name_kana}</td>
                    <td style={styles.td}>{member.procast_staff_no || '-'}</td>
                    <td style={styles.td}>{member.registered_email || member.email || '-'}</td>
                    <td style={styles.td}><PinBadge hasPin={member.has_pin} /></td>
                    <td style={styles.td}>{formatDate(member.created_at)}</td>
                    <td style={styles.td}>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <button
                          style={styles.primaryButton}
                          onClick={() => setEditingStaff({ ...member, email: member.registered_email || member.email })}
                        >
                          編集
                        </button>
                        <button
                          style={{ ...styles.secondaryButton, fontSize: '13px', padding: '8px 14px' }}
                          onClick={() => setCkModalMember(member)}
                        >
                          管制ナレッジ
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 相性NGペア管理 */}
      <CompatSection staff={staff} />

      {/* 新規登録モーダル */}
      {showStaffModal && (
        <div style={styles.modalOverlay} onClick={() => setShowStaffModal(false)}>
          <div style={styles.modal} onClick={e => e.stopPropagation()}>
            <h3 style={styles.modalTitle}>キャスト新規登録</h3>
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

      {/* 既存情報編集モーダル */}
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
                onChange={e => setEditingStaff({ ...editingStaff, email: e.target.value })}
                placeholder="例：yamada@example.com"
              />
            </div>
            <div style={styles.modalActions}>
              <button
                style={{ ...styles.cancelButton, backgroundColor: COLORS.danger, color: 'white' }}
                onClick={() => handleDeleteStaff(editingStaff.id, editingStaff.display_name_kanji)}
                disabled={savingStaff}
              >
                削除
              </button>
              <button
                style={{ ...styles.cancelButton, backgroundColor: '#f57c00', color: 'white', marginLeft: '8px' }}
                onClick={() => {
                  if (window.confirm('暗証番号とログインセッションをクリアしますか？\n（スーパー管理者のみ実行可能です）')) {
                    handleClearPin(editingStaff.id)
                  }
                }}
                disabled={savingStaff}
              >
                PINクリア
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

      {/* 管制ナレッジ編集モーダル */}
      {ckModalMember && (
        <ControlKnowledgeModal
          member={ckModalMember}
          onClose={() => setCkModalMember(null)}
          onSaved={() => setRefreshCount(c => c + 1)}
        />
      )}
    </div>
  )
}
