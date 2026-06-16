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

// ===== 過去データから学ぶ（管制ナレッジ学習アナライザ）セクション =====
interface LearnSoloItem { staff_id: string; name: string | null; solo_count: number; total_count: number }
interface LearnNightItem { staff_id: string; name: string | null; evening_count: number }
interface LearnPairItem {
  staff_a_id: string; staff_a_name: string | null
  staff_b_id: string; staff_b_name: string | null
  together_count: number
}
interface LearnSuggestions {
  days: number
  counts: { solo: number; night: number; pairs: number }
  suggestions: { solo: LearnSoloItem[]; night: LearnNightItem[]; pairs: LearnPairItem[] }
}

function LearnSection() {
  const [data, setData] = useState<LearnSuggestions | null>(null)
  const [days, setDays] = useState(30)
  const [loading, setLoading] = useState(false)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [soloSel, setSoloSel] = useState<Set<string>>(new Set())
  const [nightSel, setNightSel] = useState<Set<string>>(new Set())
  const [pairSel, setPairSel] = useState<Set<string>>(new Set())

  const fetchSuggestions = async (d: number) => {
    setLoading(true)
    setError(null)
    setNotice(null)
    setSoloSel(new Set()); setNightSel(new Set()); setPairSel(new Set())
    try {
      const res = await fetch(`/api/admin/control-knowledge/learn/suggestions?days=${d}`, { credentials: 'include' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setData(await res.json() as LearnSuggestions)
    } catch (e) {
      setError(e instanceof Error ? e.message : '取得に失敗しました')
    } finally {
      setLoading(false)
    }
  }

  const toggle = (set: Set<string>, key: string, setter: (s: Set<string>) => void) => {
    const next = new Set(set)
    if (next.has(key)) next.delete(key); else next.add(key)
    setter(next)
  }

  const handleApply = async () => {
    if (!data) return
    const solo_ok_staff_ids = data.suggestions.solo.filter(s => soloSel.has(s.staff_id)).map(s => s.staff_id)
    const night_ok_staff_ids = data.suggestions.night.filter(n => nightSel.has(n.staff_id)).map(n => n.staff_id)
    const good_pairs = data.suggestions.pairs
      .filter(p => pairSel.has(`${p.staff_a_id}|${p.staff_b_id}`))
      .map(p => ({ staff_a_id: p.staff_a_id, staff_b_id: p.staff_b_id }))
    if (solo_ok_staff_ids.length + night_ok_staff_ids.length + good_pairs.length === 0) {
      setError('取り込む項目を選択してください')
      return
    }
    setApplying(true)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch('/api/admin/control-knowledge/learn/apply', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ solo_ok_staff_ids, night_ok_staff_ids, good_pairs }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error((d as { message?: string }).message || `HTTP ${res.status}`)
      }
      const r = await res.json() as { applied: { solo_ok: number; night_ok: number; good_pairs: number } }
      setNotice(`学習を反映しました：1人立ちOK ${r.applied.solo_ok}件／夜勤OK ${r.applied.night_ok}件／相性◯ペア ${r.applied.good_pairs}件`)
      fetchSuggestions(days)
    } catch (e) {
      setError(e instanceof Error ? e.message : '反映に失敗しました')
    } finally {
      setApplying(false)
    }
  }

  const totalCount = data ? data.counts.solo + data.counts.night + data.counts.pairs : 0
  const rowStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px',
    borderBottom: `1px solid ${COLORS.gray}`, fontSize: '14px',
  }
  const groupTitle: React.CSSProperties = {
    fontSize: '14px', fontWeight: 700, color: COLORS.darkGray, margin: '16px 0 6px',
  }

  return (
    <div style={{ marginTop: '40px' }}>
      <h3 style={{ ...styles.sectionTitle, marginBottom: '12px' }}>過去データから学ぶ（管制ナレッジ）</h3>
      <p style={{ fontSize: '13px', color: COLORS.darkGray, marginBottom: '16px' }}>
        直近の実配置データを集計し、「1人立ちできそうな人」「夜勤実績がある人」「よく一緒に組む良ペア」を提案します。
        チェックして取り込むと管制ナレッジに反映され、管制ボードの判断に効きます。
        ※「相性NG（組ませない方が良い）」は実績からは分からないため、ここでは提案しません（手で登録してください）。
      </p>

      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap' }}>
        <label style={{ fontSize: '13px', color: COLORS.darkGray }}>集計期間</label>
        <select
          value={days}
          onChange={e => setDays(Number(e.target.value))}
          style={{ padding: '8px 12px', fontSize: '14px', border: `1px solid ${COLORS.gray}`, borderRadius: '8px' }}
        >
          <option value={30}>直近30日</option>
          <option value={60}>直近60日</option>
          <option value={90}>直近90日</option>
        </select>
        <button
          style={{ ...styles.primaryButton, padding: '8px 16px' }}
          onClick={() => fetchSuggestions(days)}
          disabled={loading}
        >
          {loading ? '集計中...' : '過去データを分析'}
        </button>
      </div>

      {error && <div style={{ ...styles.error, marginBottom: '12px' }}>{error}</div>}
      {notice && (
        <div style={{ marginBottom: '12px', padding: '10px 12px', backgroundColor: '#e8f5e9', color: '#2e7d32', borderRadius: '8px', fontSize: '14px' }}>
          {notice}
        </div>
      )}

      {data && totalCount === 0 && !loading && (
        <p style={{ fontSize: '14px', color: COLORS.darkGray }}>
          直近{data.days}日の配置データから、新しい学び候補は見つかりませんでした。
        </p>
      )}

      {data && totalCount > 0 && (
        <div style={{ border: `1px solid ${COLORS.gray}`, borderRadius: '8px', overflow: 'hidden' }}>
          {data.suggestions.solo.length > 0 && (
            <div>
              <div style={groupTitle}>　1人立ちOK 候補（単独現場をこなした実績）</div>
              {data.suggestions.solo.map(s => (
                <label key={s.staff_id} style={rowStyle}>
                  <input type="checkbox" checked={soloSel.has(s.staff_id)} onChange={() => toggle(soloSel, s.staff_id, setSoloSel)} />
                  <span style={{ flex: 1 }}>{s.name || `(ID:${s.staff_id.slice(0, 8)})`}</span>
                  <span style={{ color: COLORS.darkGray, fontSize: '13px' }}>単独 {s.solo_count}回 / 全{s.total_count}現場</span>
                </label>
              ))}
            </div>
          )}
          {data.suggestions.night.length > 0 && (
            <div>
              <div style={groupTitle}>　夜勤OK 候補（夜勤実績があるのに「夜勤NG」設定の人）</div>
              {data.suggestions.night.map(n => (
                <label key={n.staff_id} style={rowStyle}>
                  <input type="checkbox" checked={nightSel.has(n.staff_id)} onChange={() => toggle(nightSel, n.staff_id, setNightSel)} />
                  <span style={{ flex: 1 }}>{n.name || `(ID:${n.staff_id.slice(0, 8)})`}</span>
                  <span style={{ color: COLORS.darkGray, fontSize: '13px' }}>夜番 {n.evening_count}回</span>
                </label>
              ))}
            </div>
          )}
          {data.suggestions.pairs.length > 0 && (
            <div>
              <div style={groupTitle}>　相性◯ペア 候補（よく一緒に組むペア）</div>
              {data.suggestions.pairs.map(p => {
                const key = `${p.staff_a_id}|${p.staff_b_id}`
                return (
                  <label key={key} style={rowStyle}>
                    <input type="checkbox" checked={pairSel.has(key)} onChange={() => toggle(pairSel, key, setPairSel)} />
                    <span style={{ flex: 1 }}>
                      {(p.staff_a_name || p.staff_a_id.slice(0, 8))} × {(p.staff_b_name || p.staff_b_id.slice(0, 8))}
                    </span>
                    <span style={{ color: COLORS.darkGray, fontSize: '13px' }}>同現場 {p.together_count}回</span>
                  </label>
                )
              })}
            </div>
          )}
          <div style={{ padding: '12px', backgroundColor: '#f8f9fa', textAlign: 'right' }}>
            <button style={styles.primaryButton} onClick={handleApply} disabled={applying}>
              {applying ? '反映中...' : '選択した学びを取り込む'}
            </button>
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

      {/* 過去データから学ぶ（管制ナレッジ学習アナライザ） */}
      <LearnSection />

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
