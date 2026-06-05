'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { supabase, Profile, Attendance } from '@/lib/supabase'

type AttendanceWithProfile = Attendance & { profiles: Profile }

function formatTime(ts: string) {
  return new Date(ts).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
}

function formatDate(ts: string) {
  return new Date(ts).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric', weekday: 'short' })
}

type DailySummary = {
  date: string
  name: string
  userId: string
  clockIn: string | null
  clockOut: string | null
  minutes: number
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
    for (const r of data as AttendanceWithProfile[]) {
      const date = new Date(r.timestamp).toLocaleDateString('ja-JP', { year: 'numeric', month: 'numeric', day: 'numeric' })
      const key = `${r.user_id}_${date}`
      if (!map.has(key)) {
        map.set(key, { date, name: r.profiles?.name ?? '—', userId: r.user_id, clockIn: null, clockOut: null, minutes: 0 })
      }
      const entry = map.get(key)!
      if (r.type === 'clock_in' && !entry.clockIn) entry.clockIn = r.timestamp
      if (r.type === 'clock_out') entry.clockOut = r.timestamp
    }

    // 勤務時間計算
    for (const s of map.values()) {
      if (s.clockIn && s.clockOut) {
        s.minutes = (new Date(s.clockOut).getTime() - new Date(s.clockIn).getTime()) / 60000
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
    }
    init()
  }, [router, fetchData])

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
                    <th className="text-right pb-3 font-normal">勤務時間</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((s, i) => (
                    <tr key={i} className="border-t border-gray-50">
                      <td className="py-2.5 text-xs" style={{ color: 'var(--gray)' }}>{formatDate(s.clockIn || s.date)}</td>
                      <td className="py-2.5 font-medium" style={{ color: 'var(--navy)' }}>{s.name}</td>
                      <td className="py-2.5 text-center" style={{ color: 'var(--navy)' }}>
                        {s.clockIn ? formatTime(s.clockIn) : '—'}
                      </td>
                      <td className="py-2.5 text-center" style={{ color: 'var(--navy)' }}>
                        {s.clockOut ? formatTime(s.clockOut) : '—'}
                      </td>
                      <td className="py-2.5 text-right" style={{ color: s.minutes > 0 ? 'var(--gold)' : 'var(--gray)' }}>
                        {s.minutes > 0 ? `${Math.floor(s.minutes / 60)}h ${Math.floor(s.minutes % 60)}m` : '—'}
                      </td>
                    </tr>
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
