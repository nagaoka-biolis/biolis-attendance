'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { supabase, Profile, Attendance, Message, Shift } from '@/lib/supabase'
import ShiftCalendar, { shiftTimeLabel } from '@/components/ShiftCalendar'

// クリニックの座標（東京都中央区八重洲1丁目3-18 VORT東京八重洲maxim）
const CLINIC_LAT = 35.6812
const CLINIC_LNG = 139.7702
const ALLOWED_RADIUS_M = 300

function getDistance(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371000
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function formatTime(ts: string) {
  return new Date(ts).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
}

function formatDate(date: Date) {
  return date.toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' })
}

export default function DashboardPage() {
  const router = useRouter()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [todayRecords, setTodayRecords] = useState<Attendance[]>([])
  const [now, setNow] = useState(new Date())
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null)
  const [msgBody, setMsgBody] = useState('')
  const [msgSending, setMsgSending] = useState(false)
  const [myMessages, setMyMessages] = useState<Message[]>([])
  const [pwNew, setPwNew] = useState('')
  const [pwConfirm, setPwConfirm] = useState('')
  const [pwSaving, setPwSaving] = useState(false)
  const [pwMsg, setPwMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const [historyMonth, setHistoryMonth] = useState(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })
  const [history, setHistory] = useState<{ date: string; clockIn: string | null; clockOut: string | null; breakMin: number; workMin: number }[]>([])
  const [shiftMonth, setShiftMonth] = useState(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })
  const [shifts, setShifts] = useState<Shift[]>([])
  const [reqMap, setReqMap] = useState<Record<number, { kind: string; start: string; end: string }>>({})
  const [submittedCount, setSubmittedCount] = useState(0)
  const [reqTargetMonth, setReqTargetMonth] = useState<string | null>(null)
  const [reqDeadline, setReqDeadline] = useState<string | null>(null)
  const [reqMsg, setReqMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const [reqSaving, setReqSaving] = useState(false)

  const fetchRequests = useCallback(async (userId: string, month: string) => {
    const [year, mon] = month.split('-').map(Number)
    const start = `${year}-${String(mon).padStart(2, '0')}-01`
    const end = `${year}-${String(mon).padStart(2, '0')}-${new Date(year, mon, 0).getDate()}`
    const { data } = await supabase.from('shift_requests').select('*').eq('user_id', userId).gte('date', start).lte('date', end)
    const m: Record<number, { kind: string; start: string; end: string }> = {}
    for (const r of (data ?? []) as { date: string; kind: string; start_time: string | null; end_time: string | null }[]) {
      m[new Date(r.date).getDate()] = { kind: r.kind, start: r.start_time ?? '', end: r.end_time ?? '' }
    }
    setReqMap(m)
    setSubmittedCount((data ?? []).length)
    const { data: dl } = await supabase.from('shift_deadlines').select('deadline').eq('month', month).maybeSingle()
    setReqDeadline((dl as { deadline?: string } | null)?.deadline ?? null)
  }, [])

  const fetchShifts = useCallback(async (userId: string, month: string): Promise<Shift[]> => {
    const [year, mon] = month.split('-').map(Number)
    const start = `${year}-${String(mon).padStart(2, '0')}-01`
    const end = `${year}-${String(mon).padStart(2, '0')}-${new Date(year, mon, 0).getDate()}`
    const { data } = await supabase
      .from('shifts')
      .select('*')
      .eq('user_id', userId)
      .gte('date', start)
      .lte('date', end)
    return (data as Shift[]) ?? []
  }, [])

  // 時計
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  const fetchTodayRecords = useCallback(async (userId: string) => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const { data } = await supabase
      .from('attendance')
      .select('*')
      .eq('user_id', userId)
      .gte('timestamp', today.toISOString())
      .order('timestamp', { ascending: true })
    if (data) setTodayRecords(data)
  }, [])

  const fetchMyMessages = useCallback(async (userId: string) => {
    const { data } = await supabase
      .from('messages')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(10)
    if (data) setMyMessages(data as Message[])
  }, [])

  const fetchHistory = useCallback(async (userId: string, month: string) => {
    const [year, mon] = month.split('-').map(Number)
    const start = new Date(year, mon - 1, 1).toISOString()
    const end = new Date(year, mon, 0, 23, 59, 59).toISOString()
    const { data } = await supabase
      .from('attendance')
      .select('*')
      .eq('user_id', userId)
      .gte('timestamp', start)
      .lte('timestamp', end)
      .order('timestamp', { ascending: true })
    if (!data) { setHistory([]); return }

    const map = new Map<string, { date: string; clockIn: string | null; clockOut: string | null; breakMin: number; workMin: number }>()
    const bTmp = new Map<string, string | null>()
    for (const r of data as Attendance[]) {
      const date = new Date(r.timestamp).toLocaleDateString('ja-JP', { year: 'numeric', month: 'numeric', day: 'numeric' })
      if (!map.has(date)) map.set(date, { date, clockIn: null, clockOut: null, breakMin: 0, workMin: 0 })
      const e = map.get(date)!
      if (r.type === 'clock_in' && !e.clockIn) e.clockIn = r.timestamp
      if (r.type === 'clock_out') e.clockOut = r.timestamp
      if (r.type === 'break_start') bTmp.set(date, r.timestamp)
      if (r.type === 'break_end') {
        const bs = bTmp.get(date)
        if (bs) { e.breakMin += (new Date(r.timestamp).getTime() - new Date(bs).getTime()) / 60000; bTmp.set(date, null) }
      }
    }
    for (const e of map.values()) {
      if (e.clockIn && e.clockOut) {
        const gross = (new Date(e.clockOut).getTime() - new Date(e.clockIn).getTime()) / 60000
        e.workMin = Math.max(0, gross - e.breakMin)
      }
    }
    setHistory(Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date)))
  }, [])

  useEffect(() => {
    if (profile) fetchHistory(profile.id, historyMonth)
  }, [profile, historyMonth, fetchHistory])

  useEffect(() => {
    if (!profile) return
    let active = true
    fetchShifts(profile.id, shiftMonth).then(rows => { if (active) setShifts(rows) })
    return () => { active = false }
  }, [profile, shiftMonth, fetchShifts])

  // シフト希望の受付月を取得 → その月の希望を読み込む
  useEffect(() => {
    if (!profile) return
    let active = true
    const run = async () => {
      const { data } = await supabase.from('app_settings').select('value').eq('key', 'shift_request_month').maybeSingle()
      const m = (data as { value?: string } | null)?.value ?? null
      if (!active) return
      setReqTargetMonth(m)
      if (m) fetchRequests(profile.id, m)
    }
    run()
    return () => { active = false }
  }, [profile, fetchRequests])

  useEffect(() => {
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { router.push('/'); return }
      const user = session.user

      const { data: p } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single()
      setProfile(p)
      await fetchTodayRecords(user.id)
      await fetchMyMessages(user.id)
    }
    init()
  }, [router, fetchTodayRecords, fetchMyMessages])

  const handleSendMessage = async () => {
    if (!profile || !msgBody.trim()) return
    setMsgSending(true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from('messages') as any).insert({
      user_id: profile.id,
      body: msgBody.trim(),
    })
    if (error) {
      setMessage({ text: '送信に失敗しました。もう一度お試しください。', type: 'error' })
    } else {
      setMessage({ text: '管理者へ連絡を送信しました', type: 'success' })
      setMsgBody('')
      await fetchMyMessages(profile.id)
    }
    setMsgSending(false)
  }

  const handleClock = async (type: 'clock_in' | 'clock_out' | 'break_start' | 'break_end') => {
    if (!profile) return
    setLoading(true)
    setMessage(null)

    // 位置情報取得
    let lat: number | null = null
    let lng: number | null = null
    let isValid = false

    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 8000 })
      )
      lat = pos.coords.latitude
      lng = pos.coords.longitude
      const dist = getDistance(lat, lng, CLINIC_LAT, CLINIC_LNG)
      isValid = dist <= ALLOWED_RADIUS_M

      if (!isValid) {
        setMessage({ text: `クリニック外からの打刻です（距離: ${Math.round(dist)}m）。記録はされますが要確認となります。`, type: 'info' })
      }
    } catch {
      setMessage({ text: '位置情報を取得できませんでした。打刻は記録されます。', type: 'info' })
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from('attendance') as any).insert({
      user_id: profile.id,
      type: type,
      latitude: lat,
      longitude: lng,
      is_valid: isValid,
    })

    if (error) {
      setMessage({ text: '打刻に失敗しました。もう一度お試しください。', type: 'error' })
    } else {
      const label = { clock_in: '出勤', clock_out: '退勤', break_start: '休憩開始', break_end: '休憩終了' }[type]
      setMessage({ text: `${label}を記録しました`, type: 'success' })
      await fetchTodayRecords(profile.id)
      await fetchHistory(profile.id, historyMonth)

      // LINE WORKS 勤怠管理グループへ自動通知（失敗しても打刻はブロックしない）
      try {
        const { data: { session } } = await supabase.auth.getSession()
        void fetch('/api/lineworks-notify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token ?? ''}` },
          body: JSON.stringify({ type, isValid }),
        }).catch(() => { /* 通知失敗は無視 */ })
      } catch { /* noop */ }
    }
    setLoading(false)
  }

  const reqLocked = !!(reqDeadline && new Date().toISOString().slice(0, 10) > reqDeadline)
  const setReqDay = (day: number, patch: Partial<{ kind: string; start: string; end: string }>) => {
    const base = { kind: 'undecided', start: '', end: '' }
    setReqMap(prev => ({ ...prev, [day]: { ...base, ...prev[day], ...patch } }))
  }
  // 打ち込んだ時刻を HH:MM に整形（例: "1000"→"10:00", "930"→"09:30", "10:0"→"10:00"）
  const normTimeInput = (s: string): string => {
    if (!s) return ''
    if (s.includes(':')) {
      const [h, m] = s.split(':')
      const hh = (h || '').replace(/\D/g, '').padStart(2, '0').slice(0, 2)
      const mm = (m || '').replace(/\D/g, '').padEnd(2, '0').slice(0, 2)
      return `${hh}:${mm}`
    }
    const d = s.replace(/\D/g, '')
    if (!d) return ''
    if (d.length <= 2) return `${d.padStart(2, '0')}:00`
    if (d.length === 3) return `0${d[0]}:${d.slice(1)}`
    return `${d.slice(0, 2)}:${d.slice(2, 4)}`
  }
  const handleSubmitRequests = async () => {
    if (!profile || reqLocked || !reqTargetMonth) return
    setReqSaving(true); setReqMsg(null)
    const [year, mon] = reqTargetMonth.split('-').map(Number)
    const start = `${year}-${String(mon).padStart(2, '0')}-01`
    const end = `${year}-${String(mon).padStart(2, '0')}-${new Date(year, mon, 0).getDate()}`
    await supabase.from('shift_requests').delete().eq('user_id', profile.id).gte('date', start).lte('date', end)
    const rows = Object.entries(reqMap)
      .filter(([, v]) => v.kind && v.kind !== 'undecided')
      .map(([d, v]) => ({
        user_id: profile.id, date: `${year}-${String(mon).padStart(2, '0')}-${String(Number(d)).padStart(2, '0')}`,
        kind: v.kind, start_time: v.kind === 'work' ? (v.start || null) : null, end_time: v.kind === 'work' ? (v.end || null) : null,
      }))
    if (rows.length) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase.from('shift_requests') as any).insert(rows)
      if (error) { setReqMsg({ text: '保存に失敗しました', type: 'error' }); setReqSaving(false); return }
    }
    // スプレッドシートへ反映
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch('/api/sync-shift-requests', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token ?? ''}` },
      body: JSON.stringify({ month: reqTargetMonth }),
    })
    if (res.ok) setReqMsg({ text: 'シフト希望を提出しました（スプレッドシートに反映済み）', type: 'success' })
    else setReqMsg({ text: '提出は保存されましたが、シート反映に失敗しました', type: 'error' })
    await fetchRequests(profile.id, reqTargetMonth)
    setReqSaving(false)
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/')
  }

  // 本人によるパスワード変更（ログイン中の自分のセッションで実行・管理者権限不要）
  const handleChangePassword = async () => {
    setPwMsg(null)
    if (pwNew.length < 6) { setPwMsg({ text: 'パスワードは6文字以上にしてください', type: 'error' }); return }
    if (pwNew !== pwConfirm) { setPwMsg({ text: '確認用パスワードが一致しません', type: 'error' }); return }
    setPwSaving(true)
    const { error } = await supabase.auth.updateUser({ password: pwNew })
    setPwSaving(false)
    if (error) { setPwMsg({ text: `変更に失敗しました: ${error.message}`, type: 'error' }); return }
    setPwNew(''); setPwConfirm('')
    setPwMsg({ text: 'パスワードを変更しました。次回から新しいパスワードでログインしてください。', type: 'success' })
  }

  const lastClockIn = [...todayRecords].reverse().find(r => r.type === 'clock_in')
  const lastClockOut = [...todayRecords].reverse().find(r => r.type === 'clock_out')

  // 勤務時間（分）= 出勤〜退勤の合計 − 休憩の合計
  let workMinutes = 0
  let tempIn: string | null = null
  for (const r of todayRecords) {
    if (r.type === 'clock_in') { tempIn = r.timestamp }
    else if (r.type === 'clock_out' && tempIn) {
      workMinutes += (new Date(r.timestamp).getTime() - new Date(tempIn).getTime()) / 60000
      tempIn = null
    }
  }
  let breakMinutes = 0
  let tempBreak: string | null = null
  for (const r of todayRecords) {
    if (r.type === 'break_start') { tempBreak = r.timestamp }
    else if (r.type === 'break_end' && tempBreak) {
      breakMinutes += (new Date(r.timestamp).getTime() - new Date(tempBreak).getTime()) / 60000
      tempBreak = null
    }
  }
  const totalMinutes = Math.max(0, workMinutes - breakMinutes)
  const totalHours = Math.floor(totalMinutes / 60)
  const totalMins = Math.floor(totalMinutes % 60)

  // 現在の勤務状態（out=退勤中 / in=勤務中 / break=休憩中）
  let status: 'out' | 'in' | 'break' = 'out'
  for (const r of todayRecords) {
    if (r.type === 'clock_in') status = 'in'
    else if (r.type === 'clock_out') status = 'out'
    else if (r.type === 'break_start') status = 'break'
    else if (r.type === 'break_end') status = 'in'
  }

  if (!profile) {
    return (
      <div className="min-h-screen flex items-center justify-center"
        style={{ background: 'linear-gradient(160deg, #1A1A2E 0%, #1A2A3E 100%)' }}>
        <div className="text-white/60 text-sm tracking-widest">読み込み中...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--off-white)' }}>

      {/* ヘッダー */}
      <header className="px-6 py-4 flex items-center justify-between"
        style={{ background: 'var(--navy)' }}>
        <div>
          <div className="text-xs tracking-[0.3em]" style={{ color: 'var(--gold)' }}>BiOLiS CLINIC</div>
          <div className="text-white text-sm font-light tracking-wider mt-0.5">勤怠管理</div>
        </div>
        <button onClick={handleLogout} className="text-white/40 text-xs tracking-wider hover:text-white/70 transition">
          ログアウト
        </button>
      </header>

      <div className="flex-1 px-5 py-6 max-w-md mx-auto w-full space-y-4">

        {/* 挨拶 + 時計 */}
        <div className="card p-6 text-center">
          <div className="text-xs tracking-[0.2em] mb-1" style={{ color: 'var(--gray)' }}>
            {formatDate(now)}
          </div>
          <div className="text-4xl font-light tracking-widest my-3" style={{ color: 'var(--navy)' }}>
            {now.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </div>
          <div className="divider-gold"></div>
          <div className="text-sm font-medium tracking-wider mt-3" style={{ color: 'var(--navy)' }}>
            {profile.name}
          </div>
          <div className="text-xs mt-1" style={{ color: 'var(--gray)' }}>
            {profile.role === 'admin' ? '管理者' : 'スタッフ'}
          </div>
        </div>

        {/* メッセージ */}
        {message && (
          <div className={`rounded-xl px-4 py-3 text-sm text-center ${
            message.type === 'success' ? 'bg-emerald-50 text-emerald-700' :
            message.type === 'error' ? 'bg-red-50 text-red-600' :
            'bg-amber-50 text-amber-700'
          }`}>
            {message.text}
          </div>
        )}

        {/* 打刻ボタン */}
        <div className="card p-6">
          <div className="flex items-center justify-center gap-2 mb-5">
            <span className={`w-2 h-2 rounded-full ${
              status === 'in' ? 'bg-emerald-500' : status === 'break' ? 'bg-amber-500' : 'bg-slate-300'
            }`}></span>
            <div className="text-xs tracking-[0.2em]" style={{ color: 'var(--gray)' }}>
              {status === 'in' ? '勤務中' : status === 'break' ? '休憩中' : '退勤中'}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => handleClock('clock_in')}
              disabled={loading || status !== 'out'}
              className="btn-gold py-5 rounded-xl text-sm tracking-[0.15em]"
            >
              {loading ? '...' : '出　勤'}
            </button>
            <button
              onClick={() => handleClock('clock_out')}
              disabled={loading || status === 'out'}
              className="btn-outline py-5 rounded-xl text-sm tracking-[0.15em]"
            >
              {loading ? '...' : '退　勤'}
            </button>
            <button
              onClick={() => handleClock('break_start')}
              disabled={loading || status !== 'in'}
              className="btn-outline py-4 rounded-xl text-xs tracking-[0.15em]"
            >
              {loading ? '...' : '休憩開始'}
            </button>
            <button
              onClick={() => handleClock('break_end')}
              disabled={loading || status !== 'break'}
              className="btn-outline py-4 rounded-xl text-xs tracking-[0.15em]"
            >
              {loading ? '...' : '休憩終了'}
            </button>
          </div>
        </div>

        {/* 本日のサマリー */}
        <div className="card p-6">
          <div className="text-xs tracking-[0.2em] mb-4" style={{ color: 'var(--gray)' }}>
            TODAY&apos;S SUMMARY
          </div>
          <div className="grid grid-cols-3 gap-3 mb-4">
            <div className="text-center">
              <div className="text-xs tracking-wider mb-1" style={{ color: 'var(--gray)' }}>出勤</div>
              <div className="text-base font-medium" style={{ color: 'var(--navy)' }}>
                {lastClockIn ? formatTime(lastClockIn.timestamp) : '—'}
              </div>
            </div>
            <div className="text-center">
              <div className="text-xs tracking-wider mb-1" style={{ color: 'var(--gray)' }}>退勤</div>
              <div className="text-base font-medium" style={{ color: 'var(--navy)' }}>
                {lastClockOut ? formatTime(lastClockOut.timestamp) : '—'}
              </div>
            </div>
            <div className="text-center">
              <div className="text-xs tracking-wider mb-1" style={{ color: 'var(--gray)' }}>勤務時間</div>
              <div className="text-base font-medium" style={{ color: 'var(--gold)' }}>
                {totalMinutes > 0 ? `${totalHours}h ${totalMins}m` : '—'}
              </div>
            </div>
          </div>

          {/* 打刻ログ */}
          {todayRecords.length > 0 && (
            <>
              <div className="divider-gold"></div>
              <div className="space-y-2 mt-1">
                {todayRecords.map(r => (
                  <div key={r.id} className="flex items-center justify-between text-sm">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      r.type === 'clock_in' ? 'bg-emerald-100 text-emerald-700' :
                      r.type === 'clock_out' ? 'bg-slate-100 text-slate-600' :
                      'bg-amber-100 text-amber-700'
                    }`}>
                      {{ clock_in: '出勤', clock_out: '退勤', break_start: '休憩開始', break_end: '休憩終了' }[r.type]}
                    </span>
                    <span style={{ color: 'var(--navy)' }}>{formatTime(r.timestamp)}</span>
                    <span className="text-xs" style={{ color: r.is_valid ? 'var(--gray)' : '#EF4444' }}>
                      {r.is_valid ? '✓' : '要確認'}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* シフト */}
        <div className="card p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="text-xs tracking-[0.2em]" style={{ color: 'var(--gray)' }}>
              MY SHIFT — シフト
            </div>
            <input
              type="month"
              value={shiftMonth}
              onChange={e => setShiftMonth(e.target.value)}
              className="px-2 py-1 rounded-lg text-xs border focus:outline-none"
              style={{ borderColor: 'var(--gray-light)', background: 'var(--off-white)', color: 'var(--navy)' }}
            />
          </div>
          {shifts.length === 0 ? (
            <p className="text-sm text-center py-4" style={{ color: 'var(--gray)' }}>この月のシフトはまだありません</p>
          ) : (
            <>
              <ShiftCalendar year={Number(shiftMonth.split('-')[0])} month={Number(shiftMonth.split('-')[1])} shifts={shifts} />
              <div className="divider-gold mt-5"></div>
              <div className="text-xs tracking-wider mt-3 mb-2" style={{ color: 'var(--gray)' }}>一覧</div>
              <div className="space-y-1">
                {[...shifts].sort((a, b) => a.date.localeCompare(b.date)).map(s => (
                  <div key={s.id} className="flex items-center justify-between text-sm py-1.5 border-b border-gray-50">
                    <span className="text-xs w-20" style={{ color: 'var(--gray)' }}>
                      {new Date(s.date).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric', weekday: 'short' })}
                    </span>
                    <span className="flex-1" style={{ color: s.kind === 'off' ? 'var(--gray)' : 'var(--navy)' }}>{shiftTimeLabel(s)}</span>
                    {s.note && <span className="text-xs" style={{ color: 'var(--gray)' }}>{s.note}</span>}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* シフト希望の提出 */}
        <div className="card p-6">
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs tracking-[0.2em]" style={{ color: 'var(--gray)' }}>SHIFT REQUEST — シフト希望</div>
            <span className={`text-xs px-2 py-0.5 rounded-full ${reqLocked ? 'bg-slate-100 text-slate-500' : submittedCount > 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
              {reqLocked ? '締切後' : submittedCount > 0 ? '提出済み' : '未提出'}
            </span>
          </div>
          <a href="/manual/shift-request.html" target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs mb-3" style={{ color: 'var(--gold)' }}>
            📄 入力方法（マニュアル）を見る
          </a>
          <datalist id="time-options">
            {Array.from({ length: 27 }, (_, i) => {
              const mins = 8 * 60 + i * 30 // 08:00〜21:00 を30分刻み
              const hh = String(Math.floor(mins / 60)).padStart(2, '0')
              const mm = String(mins % 60).padStart(2, '0')
              return <option key={i} value={`${hh}:${mm}`} />
            })}
          </datalist>
          {!reqTargetMonth ? (
            <p className="text-sm text-center py-6" style={{ color: 'var(--gray)' }}>現在、シフト希望の受付はありません</p>
          ) : (<>
          <div className="text-xs mb-3" style={{ color: 'var(--gray)' }}>
            <b style={{ color: 'var(--navy)' }}>{reqTargetMonth.replace('-', '年')}月</b>の希望を入力 → 「提出」で反映されます。
            {reqDeadline ? `締切：${new Date(reqDeadline).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' })}まで` : '（締切未設定）'}
            {reqLocked && ' ※締切を過ぎたため変更できません'}
          </div>
          <div className="space-y-1 max-h-72 overflow-y-auto pr-1">
            {Array.from({ length: new Date(Number(reqTargetMonth.split('-')[0]), Number(reqTargetMonth.split('-')[1]), 0).getDate() }, (_, i) => i + 1).map(day => {
              const wd = new Date(Number(reqTargetMonth.split('-')[0]), Number(reqTargetMonth.split('-')[1]) - 1, day).getDay()
              const v = reqMap[day] ?? { kind: 'undecided', start: '', end: '' }
              return (
                <div key={day} className="flex items-center gap-2 text-sm py-0.5">
                  <span className="w-14 text-xs" style={{ color: wd === 0 ? '#EF4444' : wd === 6 ? '#2563EB' : 'var(--gray)' }}>{reqTargetMonth.split('-')[1]}/{day}({['日', '月', '火', '水', '木', '金', '土'][wd]})</span>
                  <select disabled={reqLocked} value={v.kind} onChange={e => setReqDay(day, { kind: e.target.value })}
                    className="px-2 py-1 rounded border text-xs" style={{ borderColor: 'var(--gray-light)', background: reqLocked ? '#f3f3f3' : '#fff', color: 'var(--navy)' }}>
                    <option value="undecided">未定</option>
                    <option value="work">勤務希望</option>
                    <option value="off">休み希望</option>
                  </select>
                  {v.kind === 'work' && (
                    <>
                      <span className="text-xs" style={{ color: 'var(--gray)' }}>出勤</span>
                      <input disabled={reqLocked} type="text" inputMode="numeric" list="time-options" placeholder="10:00" maxLength={5}
                        value={v.start} onChange={e => setReqDay(day, { start: e.target.value })}
                        onBlur={e => setReqDay(day, { start: normTimeInput(e.target.value) })}
                        className="px-2 py-1 rounded border text-xs w-16 text-center" style={{ borderColor: 'var(--gray-light)' }} />
                      <span className="text-xs" style={{ color: 'var(--gray)' }}>退勤</span>
                      <input disabled={reqLocked} type="text" inputMode="numeric" list="time-options" placeholder="19:00" maxLength={5}
                        value={v.end} onChange={e => setReqDay(day, { end: e.target.value })}
                        onBlur={e => setReqDay(day, { end: normTimeInput(e.target.value) })}
                        className="px-2 py-1 rounded border text-xs w-16 text-center" style={{ borderColor: 'var(--gray-light)' }} />
                    </>
                  )}
                </div>
              )
            })}
          </div>
          {reqMsg && (
            <div className={`mt-3 text-sm rounded-lg px-3 py-2 ${reqMsg.type === 'success' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>{reqMsg.text}</div>
          )}
          <button onClick={handleSubmitRequests} disabled={reqSaving || reqLocked}
            className="btn-gold w-full py-3 rounded-lg text-sm tracking-[0.15em] mt-3">
            {reqSaving ? '提出中...' : 'シフト希望を提出'}
          </button>
          </>)}
        </div>

        {/* 勤怠履歴 */}
        <div className="card p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="text-xs tracking-[0.2em]" style={{ color: 'var(--gray)' }}>
              MY HISTORY — 勤怠履歴
            </div>
            <input
              type="month"
              value={historyMonth}
              onChange={e => setHistoryMonth(e.target.value)}
              className="px-2 py-1 rounded-lg text-xs border focus:outline-none"
              style={{ borderColor: 'var(--gray-light)', background: 'var(--off-white)', color: 'var(--navy)' }}
            />
          </div>
          {history.length === 0 ? (
            <p className="text-sm text-center py-4" style={{ color: 'var(--gray)' }}>この月の記録はありません</p>
          ) : (
            <div className="space-y-2">
              {history.map(h => (
                <div key={h.date} className="flex items-center justify-between text-sm py-1.5 border-b border-gray-50">
                  <span className="text-xs" style={{ color: 'var(--gray)' }}>
                    {new Date(h.date).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric', weekday: 'short' })}
                  </span>
                  <span style={{ color: 'var(--navy)' }}>
                    {h.clockIn ? formatTime(h.clockIn) : '—'}〜{h.clockOut ? formatTime(h.clockOut) : '—'}
                  </span>
                  <span className="text-xs" style={{ color: 'var(--gold)' }}>
                    {h.workMin > 0 ? `${Math.floor(h.workMin / 60)}h ${Math.floor(h.workMin % 60)}m` : '—'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 管理者へ連絡 */}
        <div className="card p-6">
          <div className="text-xs tracking-[0.2em] mb-1" style={{ color: 'var(--gray)' }}>
            CONTACT ADMIN
          </div>
          <div className="text-xs mb-3" style={{ color: 'var(--gray)' }}>
            打刻ミスや修正依頼など、管理者へ連絡できます
          </div>
          <textarea
            value={msgBody}
            onChange={e => setMsgBody(e.target.value)}
            rows={3}
            placeholder="例：9時に出勤打刻を押し忘れました。修正をお願いします。"
            className="w-full px-3 py-2 rounded-lg text-sm border focus:outline-none resize-none"
            style={{ borderColor: 'var(--gray-light)', background: 'var(--off-white)', color: 'var(--navy)' }}
          />
          <button
            onClick={handleSendMessage}
            disabled={msgSending || !msgBody.trim()}
            className="btn-gold w-full py-3 rounded-lg text-sm tracking-[0.15em] mt-3"
          >
            {msgSending ? '...' : '管理者へ送信'}
          </button>

          {myMessages.length > 0 && (
            <>
              <div className="divider-gold mt-5"></div>
              <div className="text-xs tracking-wider mt-3 mb-2" style={{ color: 'var(--gray)' }}>送信履歴</div>
              <div className="space-y-2">
                {myMessages.map(m => (
                  <div key={m.id} className="text-sm rounded-lg px-3 py-2" style={{ background: 'var(--off-white)' }}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs" style={{ color: 'var(--gray)' }}>
                        {new Date(m.created_at).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </span>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        m.resolved ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                      }`}>
                        {m.resolved ? '対応済み' : '未対応'}
                      </span>
                    </div>
                    <div style={{ color: 'var(--navy)' }}>{m.body}</div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* パスワード変更（本人） */}
        <div className="card p-6">
          <div className="text-xs tracking-[0.2em] mb-1" style={{ color: 'var(--gray)' }}>
            CHANGE PASSWORD
          </div>
          <div className="text-xs mb-3" style={{ color: 'var(--gray)' }}>
            自分のログインパスワードを変更できます（勤怠・在庫アプリ共通）
          </div>
          <input
            type="password"
            value={pwNew}
            onChange={e => setPwNew(e.target.value)}
            placeholder="新しいパスワード（6文字以上）"
            className="w-full px-3 py-2 rounded-lg text-sm border focus:outline-none mb-2"
            style={{ borderColor: 'var(--gray-light)', background: 'var(--off-white)', color: 'var(--navy)' }}
          />
          <input
            type="password"
            value={pwConfirm}
            onChange={e => setPwConfirm(e.target.value)}
            placeholder="新しいパスワード（確認）"
            className="w-full px-3 py-2 rounded-lg text-sm border focus:outline-none"
            style={{ borderColor: 'var(--gray-light)', background: 'var(--off-white)', color: 'var(--navy)' }}
          />
          {pwMsg && (
            <div className={`text-xs mt-2 ${pwMsg.type === 'success' ? 'text-emerald-600' : 'text-red-500'}`}>
              {pwMsg.text}
            </div>
          )}
          <button
            onClick={handleChangePassword}
            disabled={pwSaving || !pwNew || !pwConfirm}
            className="btn-gold w-full py-3 rounded-lg text-sm tracking-[0.15em] mt-3"
          >
            {pwSaving ? '...' : 'パスワードを変更'}
          </button>
          <div className="text-xs mt-3" style={{ color: 'var(--gray)' }}>
            忘れてしまった場合は、管理者に「パスワード再設定」を依頼してください。
          </div>
        </div>
      </div>
    </div>
  )
}
