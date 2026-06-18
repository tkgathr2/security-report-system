import { useEffect, useState } from 'react'
import type { ControlBoardRange, ControlBoardWeekDay } from '../../types/admin'

const COLORS = {
  bg: '#ffffff',
  line: '#e8e8e8',
  lineStrong: '#d4d4d4',
  text: '#1a1a1a',
  sub: '#8a8a8a',
  blue: '#2563eb',
  blueBg: '#eff4ff',
  red: '#e0264b',
  redBg: '#fff5f5',
  saturdayBg: '#f0f6ff',
  todayBg: '#fffbeb',
  todayBorder: '#f59e0b',
  emptyCell: '#fafafa',
  font: "'Hiragino Kaku Gothic ProN','Yu Gothic',Meiryo,system-ui,sans-serif",
} as const

const DAY_LABEL = ['日', '月', '火', '水', '木', '金', '土']

function dayOfWeek(dateStr: string): number {
  return new Date(dateStr + 'T12:00:00').getDay()
}

function dateBgColor(dateStr: string, today: string): string {
  if (dateStr === today) return COLORS.todayBg
  const dow = dayOfWeek(dateStr)
  if (dow === 0) return COLORS.redBg
  if (dow === 6) return COLORS.saturdayBg
  return COLORS.bg
}

function dateTextColor(dateStr: string): string {
  const dow = dayOfWeek(dateStr)
  if (dow === 0) return COLORS.red
  if (dow === 6) return COLORS.blue
  return COLORS.text
}

function formatMD(dateStr: string): string {
  const [, m, d] = dateStr.split('-')
  return `${parseInt(m, 10)}/${parseInt(d, 10)}`
}

async function fetchRange(from: string, days: number, signal?: AbortSignal): Promise<ControlBoardRange> {
  const res = await fetch(
    `/api/admin/control-board/range?from=${encodeURIComponent(from)}&days=${days}`,
    { credentials: 'include', signal }
  )
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error((body as { message?: string }).message || `HTTP ${res.status}`)
  }
  return res.json() as Promise<ControlBoardRange>
}

interface Props {
  from: string
  /** 取得・表示する日数（1〜14）。省略時=7。 */
  days?: number
  today: string
  onPickDate?: (dateStr: string) => void
  reloadToken?: number
}

/**
 * 1週間ビュー：縦軸=日付（7日）、横軸=朝/中/夜のシフト3段。
 * 各セルに「配置済みキャスト数 / 必要人数（暫定: 0表記）」と上番下番警告アイコンを集約表示。
 * 読み取り専用（D&Dは1日モードのみ）。日付ヘッダクリックで1日モードに戻る導線を親に通知。
 */
export function ControlBoardWeekView({ from, days = 7, today, onPickDate, reloadToken }: Props) {
  const [data, setData] = useState<ControlBoardRange | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // 1〜14 にクランプ（backend と同じガード）。
  const clampedDays = Math.max(1, Math.min(14, Math.floor(days)))

  useEffect(() => {
    const ac = new AbortController()
    setLoading(true)
    setError(null)
    fetchRange(from, clampedDays, ac.signal)
      .then((r) => {
        setData(r)
        setLoading(false)
      })
      .catch((e: unknown) => {
        if (ac.signal.aborted) return
        setError(e instanceof Error ? e.message : String(e))
        setLoading(false)
      })
    return () => ac.abort()
  }, [from, clampedDays, reloadToken])

  if (loading) {
    return (
      <div style={{ padding: 24, color: COLORS.sub, fontFamily: COLORS.font }}>
        {clampedDays}日ぶんを取得中…
      </div>
    )
  }
  if (error) {
    return (
      <div style={{ padding: 24, color: COLORS.red, fontFamily: COLORS.font }}>
        取得失敗: {error}
      </div>
    )
  }
  if (!data) return null

  return (
    <div style={{ padding: 16, fontFamily: COLORS.font, color: COLORS.text }}>
      <div style={{ overflowX: 'auto', border: `1px solid ${COLORS.line}`, borderRadius: 8 }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 900 }}>
          <thead>
            <tr style={{ background: '#f8f8f8', borderBottom: `1px solid ${COLORS.lineStrong}` }}>
              <th style={{ ...thStyle, width: 110 }}>日付</th>
              <th style={thStyle}>🌅 朝番</th>
              <th style={thStyle}>☀️ 中番</th>
              <th style={thStyle}>🌙 夜番</th>
              <th style={{ ...thStyle, width: 130 }}>未配置 / 警告</th>
            </tr>
          </thead>
          <tbody>
            {data.range.map((day) => (
              <DayRow key={day.date} day={day} today={today} onPickDate={onPickDate} />
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: 12, color: COLORS.sub, fontSize: 12 }}>
        ※ 日付をクリックすると、その日の詳細（ドラッグ&ドロップ編集）に切り替わります。
      </div>
    </div>
  )
}

function DayRow({
  day,
  today,
  onPickDate,
}: {
  day: ControlBoardWeekDay
  today: string
  onPickDate?: (dateStr: string) => void
}) {
  const bg = dateBgColor(day.date, today)
  const textColor = dateTextColor(day.date)
  const isToday = day.date === today
  const dow = dayOfWeek(day.date)

  const byShift = (shift: 'morning' | 'mid' | 'evening') =>
    day.cells.filter((c) => c.shift === shift)

  return (
    <tr style={{ background: bg, borderBottom: `1px solid ${COLORS.line}` }}>
      <td
        style={{
          ...tdStyle,
          width: 110,
          cursor: onPickDate ? 'pointer' : 'default',
          borderLeft: isToday ? `3px solid ${COLORS.todayBorder}` : 'none',
        }}
        onClick={() => onPickDate?.(day.date)}
        title={onPickDate ? `${day.date} の詳細を開く` : undefined}
      >
        <div style={{ fontSize: 18, fontWeight: 700, color: textColor }}>{formatMD(day.date)}</div>
        <div style={{ fontSize: 12, color: textColor }}>（{DAY_LABEL[dow]}）{isToday && <span style={{ marginLeft: 4, fontSize: 10, background: COLORS.todayBorder, color: '#fff', padding: '1px 5px', borderRadius: 8 }}>本日</span>}</div>
      </td>
      <ShiftCell cells={byShift('morning')} />
      <ShiftCell cells={byShift('mid')} />
      <ShiftCell cells={byShift('evening')} dark />
      <td style={{ ...tdStyle, width: 130, textAlign: 'center', verticalAlign: 'middle' }}>
        <div style={{ fontSize: 12 }}>
          未配置: <b style={{ color: day.kpi.pool > 0 ? COLORS.red : COLORS.blue }}>{day.kpi.pool}</b>
        </div>
        <div style={{ fontSize: 12, marginTop: 2 }}>
          ⚠ {day.kpi.warnings + (day.kpi.violations ?? 0)}
        </div>
      </td>
    </tr>
  )
}

function ShiftCell({
  cells,
  dark,
}: {
  cells: { site_key: string; casts: { staff_id: string; name: string; over: boolean }[] }[]
  dark?: boolean
}) {
  const total = cells.reduce((s, c) => s + c.casts.length, 0)
  const hasOver = cells.some((c) => c.casts.some((cs) => cs.over))
  return (
    <td
      style={{
        ...tdStyle,
        background: total === 0 ? COLORS.emptyCell : dark ? '#f4f6f9' : 'transparent',
      }}
    >
      {total === 0 ? (
        <span style={{ color: COLORS.sub, fontSize: 12 }}>—</span>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {cells.map((cell) =>
            cell.casts.map((cs) => (
              <span
                key={cell.site_key + ':' + cs.staff_id + ':' + cs.name}
                style={{
                  display: 'inline-block',
                  fontSize: 11,
                  padding: '2px 6px',
                  borderRadius: 5,
                  background: cs.over ? COLORS.redBg : '#f3f4f6',
                  color: cs.over ? COLORS.red : COLORS.text,
                  border: cs.over ? `1px solid ${COLORS.red}` : `1px solid ${COLORS.line}`,
                }}
                title={cell.site_key}
              >
                {cs.name}
              </span>
            ))
          )}
        </div>
      )}
      {hasOver && (
        <div style={{ marginTop: 4, fontSize: 11, color: COLORS.red }}>⚠ 連続勤務</div>
      )}
    </td>
  )
}

const thStyle: React.CSSProperties = {
  padding: '10px 8px',
  fontSize: 13,
  fontWeight: 600,
  textAlign: 'left',
  color: COLORS.sub,
  borderRight: `1px solid ${COLORS.line}`,
}

const tdStyle: React.CSSProperties = {
  padding: '10px 8px',
  fontSize: 13,
  verticalAlign: 'top',
  borderRight: `1px solid ${COLORS.line}`,
}
