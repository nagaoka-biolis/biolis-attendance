'use client'

import { Shift } from '@/lib/supabase'

const WEEK = ['日', '月', '火', '水', '木', '金', '土']

function timeLabel(s: Shift): string {
  if (s.kind === 'off') return '休み'
  const t = s.start_time ? (s.end_time ? `${s.start_time}〜${s.end_time}` : `${s.start_time}〜`) : ''
  return s.kind === 'paid' ? `有給 ${t}`.trim() : t
}

export default function ShiftCalendar({ year, month, shifts }: { year: number; month: number; shifts: Shift[] }) {
  // month: 1-12
  const first = new Date(year, month - 1, 1)
  const daysInMonth = new Date(year, month, 0).getDate()
  const startWeekday = first.getDay() // 0=日

  // 日付 -> シフト
  const byDay = new Map<number, Shift>()
  for (const s of shifts) {
    const d = new Date(s.date)
    if (d.getFullYear() === year && d.getMonth() + 1 === month) byDay.set(d.getDate(), s)
  }

  const cells: (number | null)[] = []
  for (let i = 0; i < startWeekday; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)
  while (cells.length % 7 !== 0) cells.push(null)

  const kindStyle = (s: Shift) =>
    s.kind === 'off' ? { bg: '#F1F1F4', fg: '#9A9AA5' } :
    s.kind === 'paid' ? { bg: '#E3F0FF', fg: '#2563EB' } :
    { bg: '#FBF3DC', fg: '#9A7B1F' }

  return (
    <div style={{ width: '100%' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 4 }}>
        {WEEK.map((w, i) => (
          <div key={w} style={{ textAlign: 'center', fontSize: 11, padding: '4px 0', color: i === 0 ? '#EF4444' : i === 6 ? '#2563EB' : 'var(--gray)' }}>{w}</div>
        ))}
        {cells.map((d, i) => {
          if (d === null) return <div key={i} style={{ minHeight: 58 }} />
          const s = byDay.get(d)
          const wd = (startWeekday + d - 1) % 7
          const style = s ? kindStyle(s) : null
          return (
            <div key={i} style={{
              minHeight: 58, border: '1px solid var(--gray-light)', borderRadius: 8, padding: 4,
              background: style ? style.bg : '#fff', display: 'flex', flexDirection: 'column', overflow: 'hidden',
            }}>
              <div style={{ fontSize: 11, color: wd === 0 ? '#EF4444' : wd === 6 ? '#2563EB' : 'var(--gray)' }}>{d}</div>
              {s && (
                <div style={{ fontSize: 10.5, lineHeight: 1.25, color: style!.fg, fontWeight: 600, marginTop: 2, wordBreak: 'break-all' }}>
                  {timeLabel(s)}
                  {s.note && <div style={{ fontSize: 9, fontWeight: 400, color: 'var(--gray)' }}>{s.note}</div>}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
