'use client'

import { useEffect, useState, useCallback, Fragment } from 'react'
import { useRouter } from 'next/navigation'
import { supabase, Profile, Attendance, Message } from '@/lib/supabase'

type MessageWithProfile = Message & { profiles: Profile | null }

type AttendanceWithProfile = Attendance & { profiles: Profile }

function formatTime(ts: string) {
  return new Date(ts).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
}

function formatDate(ts: string) {
  return new Date(ts).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric', weekday: 'short' })
}

type DailySummary = {
  key: string
  date: string
  name: string
  userId: string
  clockIn: string | null
  clockOut: string | null
  minutes: number
  breakMinutes: number
  records: Attendance[]
}

export default function AdminPage() {
  const router = useRouter()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [summaries, setSummaries] = useState<DailySummary[]>([])
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })
  const [filterName, setFilterName] = useState('')
  const [loading, setLoading] = useState(true)
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  const [messages, setMessages] = useState<MessageWithProfile[]>([])

  const fetchMessages = useCallback(async () => {
    const { data } = await supabase
      .from('messages')
      .select('*, profiles(id, name, role)')
      .order('created_at', { ascending: false })
      .limit(100)
    if (data) setMessages(data as MessageWithProfile[])
  }, [])

  const toggleResolved = async (m: MessageWithProfile) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from('messages') as any).update({ resolved: !m.resolved }).eq('id', m.id)
    await fetchMessages()
  }

  const fetchData = useCallback(async () => {
    setLoading(true)
    const [year, month] = selectedMonth.split('-').map(Number)
    const start = new Date(year, month - 1, 1).toISOString()
    const end = new Date(year, month, 0, 23, 59, 59).toISOString()

    const { data } = await supabase
      .from('attendance')
      .select('*, profiles(id, name, role)')
      .gte('timestamp', start)
      .lte('timestamp', end)
      .order('timestamp', { ascending: true })

    if (!data) { setLoading(false); return }

    // 日別・スタッフ別に集計
    const map = new Map<string, DailySummary>()
    const breakTmp = new Map<string, string | null>()  // key -> 休憩開始の仮時刻
    const breakSum = new Map<string, number>()           // key -> 休憩合計（分）
    for (const r of data as AttendanceWithProfile[]) {
      const date = new Date(r.timestamp).toLocaleDateString('ja-JP', { year: 'numeric', month: 'numeric', day: 'numeric' })
      const key = `${r.user_id}_${date}`
      if (!map.has(key)) {
        map.set(key, { key, date, name: r.profiles?.name ?? '—', userId: r.user_id, clockIn: null, clockOut: null, minutes: 0, breakMinutes: 0, records: [] })
      }
      const entry = map.get(key)!
      entry.records.push(r)
      if (r.type === 'clock_in' && !entry.clockIn) entry.clockIn = r.timestamp
      if (r.type === 'clock_out') entry.clockOut = r.timestamp
      if (r.type === 'break_start') breakTmp.set(key, r.timestamp)
      if (r.type === 'break_end') {
        const bs = breakTmp.get(key)
        if (bs) {
          breakSum.set(key, (breakSum.get(key) ?? 0) + (new Date(r.timestamp).getTime() - new Date(bs).getTime()) / 60000)
          breakTmp.set(key, null)
        }
      }
    }

    // 勤務時間計算（休憩を差し引く）
    for (const [key, s] of map.entries()) {
      s.breakMinutes = breakSum.get(key) ?? 0
      if (s.clockIn && s.clockOut) {
        const gross = (new Date(s.clockOut).getTime() - new Date(s.clockIn).getTime()) / 60000
        s.minutes = Math.max(0, gross - s.breakMinutes)
      }
    }

    setSummaries(Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date)))
    setLoading(false)
  }, [selectedMonth])

  useEffect(() => {
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { router.push('/'); return }
      const user = session.user
      const { data: p } = await supabase.from('profiles').select('*').eq('id', user.id).single()
      setProfile(p ?? { id: user.id, name: '管理者', role: 'admin', created_at: '' })
      await fetchData()
      await fetchMessages()
    }
    init()
  }, [router, fetchData, fetchMessages])

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/')
  }

  const filtered = summaries.filter(s =>
    filterName === '' || s.name.includes(filterName)
  )

  // スタッフ別月次集計
  const staffMonthly = filtered.reduce((acc, s) => {
    if (!acc[s.name]) acc[s.name] = 0
    acc[s.name] += s.minutes
    return acc
  }, {} as Record<string, number>)

  if (!profile) {
    return (
      <div className="min-h-screen flex items-center justify-center"
        style={{ background: 'var(--off-white)' }}>
        <div className="text-sm tracking-widest" style={{ color: 'var(--gray)' }}>読み込み中...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen" style={{ background: 'var(--off-white)' }}>

      {/* ヘッダー */}
      <header className="px-6 py-4 flex items-center justify-between"
        style={{ background: 'var(--navy)' }}>
        <div>
          <div className="text-xs tracking-[0.3em]" style={{ color: 'var(--gold)' }}>BiOLiS CLINIC</div>
          <div className="text-white text-sm font-light tracking-wider mt-0.5">管理者ダッシュボード</div>
        </div>
        <button onClick={handleLogout} className="text-white/40 text-xs tracking-wider hover:text-white/70 transition">
          ログアウト
        </button>
      </header>

      <div className="max-w-3xl mx-auto px-5 py-6 space-y-5">

        {/* フィルター */}
        <div className="card p-5 flex flex-col sm:flex-row gap-3 items-center">
          <div className="flex-1">
            <label className="text-xs tracking-widest block mb-1" style={{ color: 'var(--gray)' }}>月を選択</label>
            <input
              type="month"
              value={selectedMonth}
              onChange={e => setSelectedMonth(e.target.value)}
              className="w-full px-3 py-2 rounded-lg text-sm border focus:outline-none"
              style={{ borderColor: 'var(--gray-light)', background: 'var(--off-white)', color: 'var(--navy)' }}
            />
          </div>
          <div className="flex-1">
            <label className="text-xs tracking-widest block mb-1" style={{ color: 'var(--gray)' }}>スタッフ名で絞り込み</label>
            <input
              type="text"
              value={filterName}
              onChange={e => setFilterName(e.target.value)}
              placeholder="例: 佐々木"
              className="w-full px-3 py-2 rounded-lg text-sm border focus:outline-none"
              style={{ borderColor: 'var(--gray-light)', background: 'var(--off-white)', color: 'var(--navy)' }}
            />
          </div>
        </div>

        {/* 月次集計（スタッフ別） */}
        <div className="card p-5">
          <div className="text-xs tracking-[0.2em] mb-4" style={{ color: 'var(--gray)' }}>
            MONTHLY SUMMARY — {selectedMonth.replace('-', '年')}月
          </div>
          {Object.keys(staffMonthly).length === 0 ? (
            <p className="text-sm text-center py-4" style={{ color: 'var(--gray)' }}>データがありません</p>
          ) : (
            <div className="space-y-2">
              {Object.entries(staffMonthly).sort((a, b) => b[1] - a[1]).map(([name, mins]) => (
                <div key={name} className="flex items-center justify-between py-2 border-b border-gray-50">
                  <span className="text-sm font-medium" style={{ color: 'var(--navy)' }}>{name}</span>
                  <span className="text-sm" style={{ color: 'var(--gold)' }}>
                    {Math.floor(mins / 60)}h {Math.floor(mins % 60)}m
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* スタッフからの連絡 */}
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="text-xs tracking-[0.2em]" style={{ color: 'var(--gray)' }}>
              MESSAGES — スタッフからの連絡
            </div>
            {messages.filter(m => !m.resolved).length > 0 && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                未対応 {messages.filter(m => !m.resolved).length}件
              </span>
            )}
          </div>
          {messages.length === 0 ? (
            <p className="text-sm text-center py-4" style={{ color: 'var(--gray)' }}>連絡はありません</p>
          ) : (
            <div className="space-y-2">
              {[...messages].sort((a, b) => Number(a.resolved) - Number(b.resolved)).map(m => (
                <div key={m.id} className={`rounded-lg px-4 py-3 ${m.resolved ? 'bg-gray-50' : 'bg-amber-50/60'}`}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium" style={{ color: 'var(--navy)' }}>{m.profiles?.name ?? '—'}</span>
                      <span className="text-xs" style={{ color: 'var(--gray)' }}>
                        {new Date(m.created_at).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <button
                      onClick={() => toggleResolved(m)}
                      className={`text-xs px-3 py-1 rounded-full transition ${
                        m.resolved
                          ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                          : 'btn-gold'
                      }`}
                    >
                      {m.resolved ? '対応済み ✓' : '対応済みにする'}
                    </button>
                  </div>
                  <div className="text-sm whitespace-pre-wrap" style={{ color: 'var(--navy)' }}>{m.body}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 日別打刻ログ */}
        <div className="card p-5">
          <div className="text-xs tracking-[0.2em] mb-4" style={{ color: 'var(--gray)' }}>
            DAILY LOG
          </div>
          {loading ? (
            <p className="text-sm text-center py-4" style={{ color: 'var(--gray)' }}>読み込み中...</p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-center py-4" style={{ color: 'var(--gray)' }}>データがありません</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs tracking-wider" style={{ color: 'var(--gray)' }}>
                    <th className="text-left pb-3 font-normal">日付</th>
                    <th className="text-left pb-3 font-normal">名前</th>
                    <th className="text-center pb-3 font-normal">出勤</th>
                    <th className="text-center pb-3 font-normal">退勤</th>
                    <th className="text-center pb-3 font-normal">休憩</th>
                    <th className="text-right pb-3 font-normal">勤務時間</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((s) => (
                    <Fragment key={s.key}>
                      <tr
                        onClick={() => setExpandedKey(expandedKey === s.key ? null : s.key)}
                        className="border-t border-gray-50 cursor-pointer hover:bg-amber-50/40 transition"
                      >
                        <td className="py-2.5 text-xs" style={{ color: 'var(--gray)' }}>
                          <span className="inline-block w-3" style={{ color: 'var(--gold)' }}>{expandedKey === s.key ? '▾' : '▸'}</span>
                          {formatDate(s.clockIn || s.date)}
                        </td>
                        <td className="py-2.5 font-medium" style={{ color: 'var(--navy)' }}>{s.name}</td>
                        <td className="py-2.5 text-center" style={{ color: 'var(--navy)' }}>
                          {s.clockIn ? formatTime(s.clockIn) : '—'}
                        </td>
                        <td className="py-2.5 text-center" style={{ color: 'var(--navy)' }}>
                          {s.clockOut ? formatTime(s.clockOut) : '—'}
                        </td>
                        <td className="py-2.5 text-center text-xs" style={{ color: s.breakMinutes > 0 ? 'var(--gray)' : 'var(--gray-light)' }}>
                          {s.breakMinutes > 0 ? `${Math.floor(s.breakMinutes / 60)}h ${Math.floor(s.breakMinutes % 60)}m` : '—'}
                        </td>
                        <td className="py-2.5 text-right" style={{ color: s.minutes > 0 ? 'var(--gold)' : 'var(--gray)' }}>
                          {s.minutes > 0 ? `${Math.floor(s.minutes / 60)}h ${Math.floor(s.minutes % 60)}m` : '—'}
                        </td>
                      </tr>
                      {expandedKey === s.key && (
                        <tr>
                          <td colSpan={6} className="px-4 py-3 bg-amber-50/40">
                            <div className="text-xs tracking-wider mb-2" style={{ color: 'var(--gray)' }}>
                              打刻の詳細（{s.name} ・ {formatDate(s.clockIn || s.date)}）
                            </div>
                            <div className="space-y-1.5">
                              {s.records.map(r => (
                                <div key={r.id} className="flex items-center gap-3 text-sm">
                                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                                    r.type === 'clock_in' ? 'bg-emerald-100 text-emerald-700' :
                                    r.type === 'clock_out' ? 'bg-slate-100 text-slate-600' :
                                    'bg-amber-100 text-amber-700'
                                  }`}>
                                    {{ clock_in: '出勤', clock_out: '退勤', break_start: '休憩開始', break_end: '休憩終了' }[r.type]}
                                  </span>
                                  <span style={{ color: 'var(--navy)' }}>{formatTime(r.timestamp)}</span>
                                  {!r.is_valid && <span className="text-xs" style={{ color: '#EF4444' }}>要確認（位置）</span>}
                                </div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

      </div>
    </div>
  )
}
