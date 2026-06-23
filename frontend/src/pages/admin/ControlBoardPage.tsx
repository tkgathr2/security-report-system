import { useState, useEffect, useCallback, useRef } from 'react'
import {
  DndContext,
  PointerSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragEndEvent,
} from '@dnd-kit/core'
import type {
  ControlBoardData,
  ControlBoardCast,
  ControlBoardViolation,
} from '../../types/admin'
import { ControlBoardWeekView } from './ControlBoardWeekView'

type ViewMode = 'day' | '3day' | 'week' | '2week'

const VIEW_MODE_DAYS: Record<Exclude<ViewMode, 'day'>, number> = {
  '3day': 3,
  'week': 7,
  '2week': 14,
}

const VIEW_MODE_LABEL: Record<ViewMode, string> = {
  day: '📋 1日',
  '3day': '📅 3日',
  week: '📅 1週間',
  '2week': '📅 2週間',
}

// 月曜開始の週初日（YYYY-MM-DD）を返す（D&D範囲・週ビュー用）。
function weekStartDate(base: string): string {
  const d = new Date(base + 'T12:00:00')
  const dow = d.getDay() // 0=日..6=土
  const diff = dow === 0 ? -6 : 1 - dow // 月曜まで戻す
  d.setDate(d.getDate() + diff)
  return d.toISOString().slice(0, 10)
}

// D&D サーバ呼び出し
async function postAssign(projectId: string, staffId: string): Promise<void> {
  const res = await fetch('/api/admin/control-board/assign', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project_id: projectId, staff_id: staffId }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error((body as { error?: string }).error || `HTTP ${res.status}`)
  }
}

async function deleteAssign(projectId: string, staffId: string): Promise<void> {
  const res = await fetch(
    `/api/admin/control-board/assign?project_id=${encodeURIComponent(projectId)}&staff_id=${encodeURIComponent(staffId)}`,
    { method: 'DELETE', credentials: 'include' }
  )
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error((body as { error?: string }).error || `HTTP ${res.status}`)
  }
}

// pool の各スタッフを draggable に
function DraggableStaff({
  staffId,
  fromProjectId,
  children,
}: {
  staffId: string
  fromProjectId?: string
  children: React.ReactNode
}) {
  const dragId = fromProjectId ? `placed:${fromProjectId}:${staffId}` : `staff:${staffId}`
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: dragId,
    data: fromProjectId
      ? { kind: 'placed', staffId, fromProjectId }
      : { kind: 'staff', staffId },
  })
  const style: React.CSSProperties = {
    cursor: 'grab',
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    opacity: isDragging ? 0.5 : 1,
    touchAction: 'none',
  }
  return (
    <div ref={setNodeRef} style={style} {...listeners} {...attributes}>
      {children}
    </div>
  )
}

// 各 cell を droppable に
function DroppableCell({
  projectId,
  children,
  baseStyle,
}: {
  projectId: string
  children: React.ReactNode
  baseStyle: React.CSSProperties
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `cell:${projectId}`,
    data: { kind: 'cell', projectId },
  })
  const style: React.CSSProperties = {
    ...baseStyle,
    background: isOver ? '#e3f2fd' : baseStyle.background,
    outline: isOver ? '2px dashed #2563eb' : 'none',
  }
  return (
    <div ref={setNodeRef} style={style}>
      {children}
    </div>
  )
}

// ===== CSS-in-JS スタイル定数（kansei_simple.html の変数に対応） =====
const C = {
  bg: '#ffffff',
  line: '#e8e8e8',
  lineStrong: '#d4d4d4',
  text: '#1a1a1a',
  sub: '#8a8a8a',
  blue: '#2563eb',
  blueBg: '#eff4ff',
  red: '#e0264b',
  redBg: '#fdeef1',
  night: '#f4f6f9',
  tag: '#f3f4f6',
  tagLine: '#e3e5e8',
  font: "'Hiragino Kaku Gothic ProN','Yu Gothic',Meiryo,system-ui,sans-serif",
}

// ===== 今日を JST で取得 =====
function todayJST(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' })
}

function offsetDate(base: string, days: number): string {
  const d = new Date(base + 'T12:00:00')
  d.setDate(d.getDate() + days)
  return d.toISOString().split('T')[0]
}

function formatDateJa(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00')
  const days = ['日', '月', '火', '水', '木', '金', '土']
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日（${days[d.getDay()]}）`
}

// ===== shift 表示名 =====
const SHIFT_LABEL: Record<string, string> = {
  morning: '朝番',
  mid: '中番',
  evening: '夜番',
}

// ===== API から取得 =====
async function fetchControlBoard(date: string, signal?: AbortSignal): Promise<ControlBoardData> {
  const res = await fetch(`/api/admin/control-board?date=${encodeURIComponent(date)}`, {
    credentials: 'include',
    signal,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error((body as { message?: string }).message || `HTTP ${res.status}`)
  }
  return res.json() as Promise<ControlBoardData>
}

// ===== Cast タグ =====
function CastTag({ cast }: { cast: ControlBoardCast }) {
  const isOver = cast.over
  const isHandoff = cast.handoff
  const hasWarn = Array.isArray(cast.warn) && cast.warn.length > 0
  // warn が over より優先（赤系統一、追加の warn を注記で出す）
  const isAlert = isOver || hasWarn

  const tagStyle: React.CSSProperties = {
    display: 'inline-flex',
    flexDirection: hasWarn ? 'column' : 'row',
    alignItems: hasWarn ? 'flex-start' : 'center',
    gap: 4,
    borderRadius: 7,
    padding: '4px 9px',
    fontSize: 13,
    lineHeight: 1.4,
    border: isAlert
      ? `1px solid ${C.red}`
      : isHandoff
      ? `1px dashed ${C.lineStrong}`
      : `1px solid ${C.tagLine}`,
    background: isAlert ? C.redBg : isHandoff ? '#fff' : C.tag,
    color: isAlert ? C.red : isHandoff ? C.sub : C.text,
    fontWeight: isAlert ? 600 : 400,
    whiteSpace: 'nowrap' as const,
  }

  return (
    <span style={tagStyle}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        {isAlert && '⚠️'}
        {!isAlert && isHandoff && '🌙'}
        {cast.name}
      </span>
      {hasWarn && (
        <span style={{ fontSize: 11, color: C.red, lineHeight: 1.3, marginTop: 2 }}>
          {(cast.warn ?? []).join(' / ')}
        </span>
      )}
    </span>
  )
}

// ===== 下部ドック：自動管制システムと会話 =====
interface ChatMsg { role: 'user' | 'assistant'; text: string }

// 削除ボタン付き CastTag（× で配置解除）
function CastTagWithRemove({
  cast,
  onRemove,
  disabled,
}: {
  cast: ControlBoardCast
  onRemove?: () => void
  disabled?: boolean
}) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'stretch', gap: 0 }}>
      <CastTag cast={cast} />
      {onRemove && (
        <button
          onClick={onRemove}
          disabled={disabled}
          title="この配置を外す"
          style={{
            border: '1px solid #e0e0e0',
            borderLeft: 'none',
            background: '#fafafa',
            color: '#666',
            cursor: disabled ? 'not-allowed' : 'pointer',
            fontSize: 12,
            padding: '0 6px',
            borderRadius: '0 7px 7px 0',
            opacity: disabled ? 0.5 : 1,
          }}
        >
          ×
        </button>
      )}
    </span>
  )
}

function ChatDock({ onMutated }: { onMutated: () => void }) {
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [msgs, setMsgs] = useState<ChatMsg[]>([
    {
      role: 'assistant',
      text:
        'こんにちは。自動管制システムです。話すだけで覚えます。例：「中村さんは1人立ちOK」「川面さんは夜勤NG」「AさんとBさんは組ませないで」。質問もどうぞ（例：「中村さんは1人立ちできる？」）。',
    },
  ])
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight
  }, [msgs, open])

  const send = async () => {
    const text = input.trim()
    if (!text || sending) return
    setInput('')
    setMsgs((m) => [...m, { role: 'user', text }])
    setSending(true)
    try {
      const res = await fetch('/api/admin/control-chat', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const d = (await res.json()) as { reply: string; mutated: boolean }
      setMsgs((m) => [...m, { role: 'assistant', text: d.reply }])
      if (d.mutated) onMutated()
    } catch {
      setMsgs((m) => [...m, { role: 'assistant', text: '送信に失敗しました。少し待って再度お試しください。' }])
    } finally {
      setSending(false)
    }
  }

  const dockStyle: React.CSSProperties = {
    position: 'fixed', right: 20, bottom: 20, width: 360, maxWidth: 'calc(100vw - 40px)',
    background: '#fff', border: `1px solid ${C.lineStrong}`, borderRadius: 14,
    boxShadow: '0 8px 30px rgba(0,0,0,0.16)', fontFamily: C.font, zIndex: 1000, overflow: 'hidden',
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        style={{
          position: 'fixed', right: 20, bottom: 20, zIndex: 1000,
          background: C.blue, color: '#fff', border: 'none', borderRadius: 24,
          padding: '12px 18px', fontSize: 14, fontWeight: 700, cursor: 'pointer',
          boxShadow: '0 6px 20px rgba(37,99,235,0.4)', fontFamily: C.font,
        }}
      >
        管制アシスタントと話す
      </button>
    )
  }

  return (
    <div style={dockStyle}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 14px', borderBottom: `1px solid ${C.line}`, background: C.blueBg }}>
        <strong style={{ fontSize: 14, color: C.text }}>自動管制システム</strong>
        <button onClick={() => setOpen(false)} style={{ border: 'none', background: 'transparent', fontSize: 18, cursor: 'pointer', color: C.sub, lineHeight: 1 }}>×</button>
      </div>
      <div ref={listRef} style={{ height: 320, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {msgs.map((m, i) => (
          <div key={i} style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '85%', background: m.role === 'user' ? C.blue : C.tag, color: m.role === 'user' ? '#fff' : C.text, padding: '8px 11px', borderRadius: 11, fontSize: 13, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
            {m.text}
          </div>
        ))}
        {sending && <div style={{ alignSelf: 'flex-start', color: C.sub, fontSize: 12 }}>考えています…</div>}
      </div>
      <div style={{ display: 'flex', gap: 8, padding: 10, borderTop: `1px solid ${C.line}` }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) send() }}
          placeholder="例：中村さんは1人立ちOK"
          disabled={sending}
          style={{ flex: 1, border: `1px solid ${C.lineStrong}`, borderRadius: 9, padding: '9px 11px', fontSize: 13, fontFamily: C.font }}
        />
        <button onClick={send} disabled={sending || !input.trim()} style={{ border: 'none', background: C.blue, color: '#fff', borderRadius: 9, padding: '0 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer', opacity: sending || !input.trim() ? 0.5 : 1 }}>送信</button>
      </div>
    </div>
  )
}

// ===== メインコンポーネント =====
export function ControlBoardPage() {
  const [date, setDate] = useState<string>(todayJST)
  const [data, setData] = useState<ControlBoardData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('week')
  const [assignBusy, setAssignBusy] = useState(false)
  const [assignError, setAssignError] = useState<string | null>(null)
  const [weekReloadToken, setWeekReloadToken] = useState(0)

  // 入力デバイスを総当たりでサポート：
  //  - PointerSensor: モダンブラウザ標準（マウス＋タッチ＋ペン統合）
  //  - MouseSensor: 古い経路や computer-use 系の MouseEvent もカバー
  //  - TouchSensor: スマホ・タブレットの長押し→ドラッグ
  // activationConstraint で「クリックと判定される短い動き」では発火しない。
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } })
  )

  // 日付連打のレース対策：最新リクエストのみ反映する（古いレスポンスが新しい表示を上書きしない）
  const reqIdRef = useRef(0)

  const load = useCallback(async (targetDate: string, signal?: AbortSignal) => {
    const myId = ++reqIdRef.current
    setLoading(true)
    setError(null)
    try {
      const d = await fetchControlBoard(targetDate, signal)
      if (reqIdRef.current !== myId) return // 古いレスポンスは破棄
      setData(d)
      setLastUpdated(
        new Date().toLocaleTimeString('ja-JP', {
          timeZone: 'Asia/Tokyo',
          hour: '2-digit',
          minute: '2-digit',
        })
      )
    } catch (e) {
      if (signal?.aborted || reqIdRef.current !== myId) return
      setError(e instanceof Error ? e.message : '取得に失敗しました')
      setData(null)
    } finally {
      if (reqIdRef.current === myId) setLoading(false)
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    load(date, controller.signal)
    return () => controller.abort()
  }, [date, load])

  // 日付移動
  const go = (offset: number) => setDate((prev) => offsetDate(prev, offset))
  const goToday = () => setDate(todayJST())

  // ===== D&D：プール or 配置済みスタッフ → 現場セル =====
  const handleDragEnd = useCallback(async (e: DragEndEvent) => {
    setAssignError(null)
    const activeData = e.active?.data?.current as { kind?: string; staffId?: string; fromProjectId?: string } | undefined
    const overData = e.over?.data?.current as { kind?: string; projectId?: string } | undefined
    if (overData?.kind !== 'cell') return
    const staffId = activeData?.staffId
    const projectId = overData.projectId
    if (!staffId || !projectId) return
    const fromProjectId = activeData?.fromProjectId
    // 同じ現場へのドロップは無視
    if (fromProjectId === projectId) return
    setAssignBusy(true)
    try {
      if (fromProjectId) {
        // 配置済みスタッフの移動：元の現場から外して新しい現場へ
        await deleteAssign(fromProjectId, staffId)
      }
      await postAssign(projectId, staffId)
      await load(date)
      setWeekReloadToken((t) => t + 1)
    } catch (err) {
      setAssignError(err instanceof Error ? err.message : '配置に失敗しました')
    } finally {
      setAssignBusy(false)
    }
  }, [date, load])

  // セル内の × ボタンで配置解除（クリックベースの編集経路）
  const handleRemoveAssign = useCallback(async (projectId: string, staffId: string) => {
    setAssignError(null)
    setAssignBusy(true)
    try {
      await deleteAssign(projectId, staffId)
      await load(date)
      setWeekReloadToken((t) => t + 1)
    } catch (err) {
      setAssignError(err instanceof Error ? err.message : '解除に失敗しました')
    } finally {
      setAssignBusy(false)
    }
  }, [date, load])

  // スタッフを管制ボードで非表示/再表示する（高木など配置対象でない人を隠す）。完了後に盤面を再取得。
  const hideStaff = useCallback(async (staffId: string, hidden: boolean) => {
    try {
      await fetch(`/api/admin/control-knowledge/staff/${staffId}/hidden`, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hidden }),
      })
    } catch { /* 失敗時も再取得で現状に戻す */ }
    load(date)
  }, [load, date])

  // ===== ヘッダー =====
  const headerStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'baseline',
    gap: 14,
    flexWrap: 'wrap',
    padding: '18px 24px',
    borderBottom: `1px solid ${C.line}`,
    fontFamily: C.font,
  }

  const btnStyle: React.CSSProperties = {
    border: `1px solid ${C.lineStrong}`,
    background: '#fff',
    color: C.text,
    padding: '8px 14px',
    borderRadius: 8,
    fontSize: 13,
    cursor: 'pointer',
    fontFamily: C.font,
  }

  // ===== KPI =====
  const kpiStyle: React.CSSProperties = {
    display: 'flex',
    gap: 28,
    padding: '16px 24px',
    borderBottom: `1px solid ${C.line}`,
    flexWrap: 'wrap',
    fontFamily: C.font,
  }

  // ===== テーブル生成 =====
  const renderBoard = () => {
    if (!data) return null
    const { sites, cells } = data

    // セル引き当て: (site_key, shift) → cell
    // 同一 (site_key × shift) の cell が複数来ても上書きせずキャストをマージする
    // （後勝ち上書きだと片方の現場の配置キャストが盤面から消えるため）。
    const cellMap = new Map<string, (typeof cells)[number]>()
    for (const cell of cells) {
      const k = `${cell.site_key}::${cell.shift}`
      const existing = cellMap.get(k)
      if (existing) {
        existing.casts = [...existing.casts, ...cell.casts]
      } else {
        cellMap.set(k, { ...cell, casts: [...cell.casts] })
      }
    }

    const shifts: Array<'morning' | 'mid' | 'evening'> = ['morning', 'mid', 'evening']

    return (
      <table
        style={{
          borderCollapse: 'collapse',
          width: '100%',
          minWidth: 640,
          fontFamily: C.font,
        }}
      >
        <thead>
          <tr>
            <th
              style={{
                position: 'sticky',
                top: 0,
                background: '#fff',
                textAlign: 'left',
                fontSize: 12,
                color: C.sub,
                fontWeight: 600,
                padding: '12px 14px',
                whiteSpace: 'nowrap',
                borderBottom: `1px solid ${C.lineStrong}`,
                width: 72,
              }}
            >
              シフト
            </th>
            {sites.map((site) => (
              <th
                key={site.key}
                style={{
                  position: 'sticky',
                  top: 0,
                  background: '#fff',
                  textAlign: 'left',
                  fontSize: 12,
                  color: C.sub,
                  fontWeight: 600,
                  padding: '12px 14px',
                  borderBottom: `1px solid ${C.lineStrong}`,
                  borderRight: `1px solid ${C.line}`,
                }}
              >
                <div style={{ fontWeight: 600, fontSize: 13, color: C.text }}>
                  {site.label}
                </div>
                <div style={{ color: C.sub, fontSize: 11, marginTop: 2 }}>{site.meta}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shifts.map((shift) => {
            const isNight = shift === 'evening'
            const rowBg = isNight ? C.night : 'transparent'
            return (
              <tr key={shift} style={{ background: rowBg }}>
                {/* シフト名セル */}
                <td
                  style={{
                    fontSize: 12,
                    color: C.sub,
                    padding: '12px 14px',
                    borderBottom: `1px solid ${C.line}`,
                    borderRight: `1px solid ${C.line}`,
                    whiteSpace: 'nowrap',
                    background: rowBg,
                    verticalAlign: 'top',
                  }}
                >
                  {SHIFT_LABEL[shift]}
                </td>
                {/* 各現場セル */}
                {sites.map((site) => {
                  const key = `${site.key}::${shift}`
                  const cell = cellMap.get(key)
                  const casts: ControlBoardCast[] = cell?.casts ?? []
                  const cellBaseStyle: React.CSSProperties = {
                    minHeight: 42,
                    padding: '7px 10px',
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 5,
                    alignContent: 'flex-start',
                    borderRight: `1px solid ${C.line}`,
                  }
                  return (
                    <td
                      key={site.key}
                      style={{
                        borderBottom: `1px solid ${C.line}`,
                        background: rowBg,
                        verticalAlign: 'top',
                        padding: 0,
                      }}
                    >
                      {cell ? (
                        <DroppableCell projectId={cell.project_id} baseStyle={cellBaseStyle}>
                          {casts.map((c, ci) =>
                            c.staff_id ? (
                              <DraggableStaff
                                key={`${c.staff_id}-${ci}`}
                                staffId={c.staff_id}
                                fromProjectId={cell.project_id}
                              >
                                <CastTagWithRemove
                                  cast={c}
                                  onRemove={() => handleRemoveAssign(cell.project_id, c.staff_id as string)}
                                  disabled={assignBusy}
                                />
                              </DraggableStaff>
                            ) : (
                              <CastTagWithRemove
                                key={`x-${ci}`}
                                cast={c}
                                disabled={assignBusy}
                              />
                            )
                          )}
                          {casts.length === 0 && (
                            <span style={{ color: C.sub, fontSize: 11 }}>ドロップで配置</span>
                          )}
                        </DroppableCell>
                      ) : (
                        <div style={{ ...cellBaseStyle, color: C.sub, fontSize: 11 }}>—</div>
                      )}
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
    )
  }

  // ===== サイドパネル =====
  const renderSide = () => {
    if (!data) return null
    const { pool, handover } = data
    const hiddenStaff = data.hidden_staff ?? []
    const seenLabel = (ls?: string | null) => {
      if (!ls) return '未'
      const [, m, d] = ls.split('-')
      return `${parseInt(m, 10)}/${parseInt(d, 10)}`
    }

    const sideStyle: React.CSSProperties = {
      width: 248,
      flexShrink: 0,
      borderLeft: `1px solid ${C.line}`,
      padding: 20,
      fontFamily: C.font,
    }

    const h3Style: React.CSSProperties = {
      margin: '0 0 12px',
      fontSize: 13,
      fontWeight: 700,
    }

    return (
      <div style={sideStyle}>
        {/* 未配置スタッフ（最近出勤している人が上・来ていない人ほど下） */}
        <section style={{ marginBottom: 26 }}>
          <h3 style={h3Style}>未配置スタッフ <span style={{ fontWeight: 400, color: C.sub, fontSize: 11 }}>（最近出勤順）</span></h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {pool.length === 0 ? (
              <span style={{ fontSize: 13, color: C.sub }}>なし</span>
            ) : (
              pool.map((p) => (
                <DraggableStaff key={p.staff_id} staffId={p.staff_id}>
                  <div
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      gap: 6, background: C.tag, border: `1px solid ${C.tagLine}`,
                      borderRadius: 7, padding: '5px 8px 5px 10px', fontSize: 13,
                      opacity: p.last_seen ? 1 : 0.55,
                    }}
                    title="ドラッグして現場セルにドロップで配置"
                  >
                    <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6, minWidth: 0 }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                      <span style={{ color: C.sub, fontSize: 11, flexShrink: 0 }}>{seenLabel(p.last_seen)}</span>
                    </span>
                    <button
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={() => hideStaff(p.staff_id, true)}
                      title="この人を盤面から非表示にする"
                      style={{ border: 'none', background: 'transparent', color: C.sub, cursor: 'pointer', fontSize: 15, lineHeight: 1, padding: '0 2px', flexShrink: 0 }}
                    >
                      ×
                    </button>
                  </div>
                </DraggableStaff>
              ))
            )}
          </div>
        </section>

        {/* 非表示中スタッフ（戻せる） */}
        {hiddenStaff.length > 0 && (
          <section style={{ marginBottom: 26 }}>
            <h3 style={h3Style}>非表示中 <span style={{ fontWeight: 400, color: C.sub, fontSize: 11 }}>（{hiddenStaff.length}名）</span></h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {hiddenStaff.map((s) => (
                <div key={s.staff_id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, fontSize: 13, color: C.sub }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
                  <button
                    onClick={() => hideStaff(s.staff_id, false)}
                    style={{ border: `1px solid ${C.lineStrong}`, background: '#fff', color: C.text, cursor: 'pointer', fontSize: 11, borderRadius: 6, padding: '2px 8px', flexShrink: 0 }}
                  >
                    戻す
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* 夜勤引継ぎ */}
        <section style={{ marginBottom: 26 }}>
          <h3 style={h3Style}>夜勤引継ぎ</h3>
          {handover.length === 0 ? (
            <span style={{ fontSize: 13, color: C.sub }}>なし</span>
          ) : (
            handover.map((h, i) => (
              <div
                key={i}
                style={{
                  fontSize: 13,
                  color: C.text,
                  padding: '9px 0',
                  borderBottom: i < handover.length - 1 ? `1px solid ${C.line}` : 'none',
                }}
              >
                {h.shift_from} {h.date ? `${h.date}→` : '→'}{' '}
                <strong>{h.names.join('・')}</strong>
                {h.note && (
                  <div style={{ color: C.sub, fontSize: 12, marginTop: 2 }}>
                    <span style={{ color: C.red }}>{h.note}</span>
                  </div>
                )}
              </div>
            ))
          )}
        </section>

        {/* 凡例 */}
        <section>
          <h3 style={h3Style}>凡例</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7, fontSize: 12, color: C.sub }}>
            <span>
              <i
                style={{
                  display: 'inline-block',
                  width: 12,
                  height: 12,
                  borderRadius: 3,
                  marginRight: 7,
                  verticalAlign: -2,
                  background: C.night,
                }}
              />
              夜番の行
            </span>
            <span>
              <i
                style={{
                  display: 'inline-block',
                  width: 12,
                  height: 12,
                  borderRadius: 3,
                  marginRight: 7,
                  verticalAlign: -2,
                  background: C.red,
                }}
              />
              連続勤務 / 管制注意
            </span>
            <span>
              <i
                style={{
                  display: 'inline-block',
                  width: 12,
                  height: 12,
                  borderRadius: 3,
                  marginRight: 7,
                  verticalAlign: -2,
                  background: '#fff',
                  border: `1px dashed ${C.lineStrong}`,
                }}
              />
              夜勤引継ぎ
            </span>
          </div>
        </section>
      </div>
    )
  }

  // ===== ローディング／エラー／空 表示 =====
  const renderBody = () => {
    if (loading) {
      return (
        <div
          style={{
            padding: 48,
            textAlign: 'center',
            color: C.sub,
            fontFamily: C.font,
          }}
        >
          読み込み中...
        </div>
      )
    }

    if (error) {
      return (
        <div
          style={{
            padding: 24,
            background: C.redBg,
            color: C.red,
            fontSize: 14,
            fontFamily: C.font,
            borderBottom: `1px solid ${C.line}`,
          }}
        >
          エラー: {error}
        </div>
      )
    }

    if (!data || data.sites.length === 0) {
      return (
        <div
          style={{
            padding: 48,
            textAlign: 'center',
            color: C.sub,
            fontFamily: C.font,
          }}
        >
          この日に案件はありません
        </div>
      )
    }

    if (viewMode !== 'day') {
      const days = VIEW_MODE_DAYS[viewMode]
      // 1週間モードは「月曜開始」、3日/2週間モードは date 起点
      const from = viewMode === 'week' ? weekStartDate(date) : date
      return (
        <ControlBoardWeekView
          from={from}
          days={days}
          today={todayJST()}
          onPickDate={(d) => {
            setDate(d)
            setViewMode('day')
          }}
          reloadToken={weekReloadToken}
        />
      )
    }

    return (
      <div style={{ display: 'flex', alignItems: 'flex-start' }}>
        {/* メイングリッド */}
        <div
          style={{
            flex: 1,
            minWidth: 0,
            overflowX: 'auto',
            padding: '8px 0 40px',
          }}
        >
          {renderBoard()}
        </div>
        {/* サイドパネル */}
        {renderSide()}
      </div>
    )
  }

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
    <div style={{ fontFamily: C.font, color: C.text, background: C.bg }}>
      {assignError && (
        <div
          style={{
            padding: '8px 24px',
            background: C.redBg,
            color: C.red,
            fontSize: 13,
            borderBottom: `1px solid ${C.line}`,
          }}
        >
          配置エラー: {assignError}
          <button
            onClick={() => setAssignError(null)}
            style={{ marginLeft: 12, background: 'transparent', border: 'none', color: C.red, cursor: 'pointer', fontWeight: 700 }}
          >
            ×
          </button>
        </div>
      )}
      {assignBusy && (
        <div style={{ padding: '6px 24px', background: '#fff8e1', color: '#5d4037', fontSize: 12, borderBottom: `1px solid ${C.line}` }}>
          配置を更新中…
        </div>
      )}
      {/* ヘッダー */}
      <header style={headerStyle}>
        <h1 style={{ margin: 0, fontSize: 19, fontWeight: 700, letterSpacing: '0.02em' }}>
          管制ダッシュボード
        </h1>
        <span style={{ color: C.sub, fontSize: 14 }}>{formatDateJa(date)}</span>
        <span style={{ flex: 1 }} />
        <div style={{ display: 'flex', gap: 4, marginRight: 4 }}>
          {(['day', '3day', 'week', '2week'] as ViewMode[]).map((m) => (
            <button
              key={m}
              style={{
                ...btnStyle,
                background: viewMode === m ? C.blue : '#fff',
                color: viewMode === m ? '#fff' : C.text,
                borderColor: viewMode === m ? C.blue : C.lineStrong,
                fontWeight: viewMode === m ? 700 : 400,
              }}
              onClick={() => setViewMode(m)}
              title={
                m === 'day'
                  ? '1日の詳細（ドラッグ&ドロップ編集可）'
                  : m === '3day'
                    ? '今日から3日ぶんを縦に並べて表示'
                    : m === 'week'
                      ? '月曜〜日曜の1週間ぶんを縦に並べて表示'
                      : '今日から2週間（14日）ぶんを縦に並べて表示'
              }
            >
              {VIEW_MODE_LABEL[m]}
            </button>
          ))}
        </div>
        <button style={btnStyle} onClick={() => go(-1)}>
          前日
        </button>
        <button style={btnStyle} onClick={goToday}>
          今日
        </button>
        <button style={btnStyle} onClick={() => go(1)}>
          翌日
        </button>
        <button
          style={{ ...btnStyle, borderColor: C.blue, color: C.blue, fontWeight: 600 }}
          onClick={() => load(date)}
          disabled={loading}
          title="いきなり入った仕事を反映するときに押す（最新の配置で警告を計算し直します）"
        >
          {loading ? '更新中…' : '🔄 更新'}
        </button>
        {lastUpdated && (
          <span style={{ color: C.sub, fontSize: 12 }}>最終更新 {lastUpdated}</span>
        )}
      </header>

      {/* KPI */}
      {data && (
        <div style={kpiStyle}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <b style={{ fontSize: 26, fontWeight: 700, lineHeight: 1, color: C.blue }}>
              {data.kpi.sites}
            </b>
            <span style={{ color: C.sub, fontSize: 13 }}>現場</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <b style={{ fontSize: 26, fontWeight: 700, lineHeight: 1, color: C.blue }}>
              {data.kpi.assigned}
            </b>
            <span style={{ color: C.sub, fontSize: 13 }}>配置済</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <b
              style={{
                fontSize: 26,
                fontWeight: 700,
                lineHeight: 1,
                color: data.kpi.pool > 0 ? C.red : C.blue,
              }}
            >
              {data.kpi.pool}
            </b>
            <span style={{ color: C.sub, fontSize: 13 }}>未配置</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <b
              style={{
                fontSize: 26,
                fontWeight: 700,
                lineHeight: 1,
                color: data.kpi.warnings > 0 ? C.red : C.blue,
              }}
            >
              {data.kpi.warnings}
            </b>
            <span style={{ color: C.sub, fontSize: 13 }}>連続勤務警告</span>
          </div>
          {data.kpi.violations !== undefined && (
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <b
                style={{
                  fontSize: 26,
                  fontWeight: 700,
                  lineHeight: 1,
                  color: data.kpi.violations > 0 ? C.red : C.blue,
                }}
              >
                {data.kpi.violations}
              </b>
              <span style={{ color: C.sub, fontSize: 13 }}>管制注意</span>
            </div>
          )}
        </div>
      )}

      {/* 連続警告バナー */}
      {data && data.warnings.length > 0 && (
        <div
          style={{
            margin: 0,
            padding: '11px 24px',
            background: C.redBg,
            color: C.text,
            fontSize: 13,
            borderBottom: `1px solid ${C.line}`,
          }}
        >
          ⚠️{' '}
          <strong style={{ color: C.red }}>連続勤務：</strong>
          {data.warnings
            .map((w) => `${w.name}さん（${w.prev}→${w.curr}・${w.site}）`)
            .join('　／　')}
        </div>
      )}

      {/* 管制ナレッジ違反バナー */}
      {data && data.violations && data.violations.length > 0 && (
        <div
          style={{
            margin: 0,
            padding: '11px 24px',
            background: '#fff8e1',
            color: C.text,
            fontSize: 13,
            borderBottom: `1px solid ${C.line}`,
          }}
        >
          <strong style={{ color: '#f57f17' }}>⚠️ 管制ナレッジ注意：</strong>
          <ul style={{ margin: '6px 0 0', paddingLeft: '20px', lineHeight: 1.7 }}>
            {(data.violations as ControlBoardViolation[]).map((v, i) => (
              <li key={i} style={{ color: '#5d4037' }}>
                <strong style={{ color: '#c0392b' }}>[{v.site_label}]</strong>{' '}
                {v.message}
                {v.names && v.names.length > 0 && (
                  <span style={{ color: '#8d6e63', marginLeft: 6 }}>（{v.names.join('・')}）</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* メインボディ */}
      {renderBody()}

      {/* 下部ドック：自動管制システムと会話（覚えさせる／質問する） */}
      <ChatDock onMutated={() => load(date)} />
    </div>
    </DndContext>
  )
}
