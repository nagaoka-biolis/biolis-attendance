'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { supabase, Profile, Attendance } from '@/lib/supabase'

// クリニックの座標（後で実際の座標に変更）
const CLINIC_LAT = 35.6895
const CLINIC_LNG = 139.6917
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
    }
    init()
  }, [router, fetchTodayRecords])

  const handleClock = async (type: 'clock_in' | 'clock_out') => {
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

    const { error } = await supabase.from('attendance').insert({
      user_id: profile.id,
      type: type,
      latitude: lat,
      longitude: lng,
      is_valid: isValid,
    } as { user_id: string; type: string; latitude: number | null; longitude: number | null; is_valid: boolean })

    if (error) {
      setMessage({ text: '打刻に失敗しました。もう一度お試しください。', type: 'error' })
    } else {
      setMessage({
        text: type === 'clock_in' ? '出勤を記録しました' : '退勤を記録しました',
        type: 'success'
      })
      await fetchTodayRecords(profile.id)
    }
    setLoading(false)
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/')
  }

  const lastClockIn = [...todayRecords].reverse().find(r => r.type === 'clock_in')
  const lastClockOut = [...todayRecords].reverse().find(r => r.type === 'clock_out')

  // 本日の合計勤務時間（分）
  let totalMinutes = 0
  let tempIn: string | null = null
  for (const r of todayRecords) {
    if (r.type === 'clock_in') { tempIn = r.timestamp }
    else if (r.type === 'clock_out' && tempIn) {
      totalMinutes += (new Date(r.timestamp).getTime() - new Date(tempIn).getTime()) / 60000
      tempIn = null
    }
  }
  const totalHours = Math.floor(totalMinutes / 60)
  const totalMins = Math.floor(totalMinutes % 60)

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
          <div className="text-xs tracking-[0.2em] text-center mb-5" style={{ color: 'var(--gray)' }}>
            PUNCH IN / OUT
          </div>
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => handleClock('clock_in')}
              disabled={loading}
              className="btn-gold py-5 rounded-xl text-sm tracking-[0.15em]"
            >
              {loading ? '...' : '出　勤'}
            </button>
            <button
              onClick={() => handleClock('clock_out')}
              disabled={loading}
              className="btn-outline py-5 rounded-xl text-sm tracking-[0.15em]"
            >
              {loading ? '...' : '退　勤'}
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
                      r.type === 'clock_in'
                        ? 'bg-emerald-100 text-emerald-700'
                        : 'bg-slate-100 text-slate-600'
                    }`}>
                      {r.type === 'clock_in' ? '出勤' : '退勤'}
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
      </div>
    </div>
  )
}
