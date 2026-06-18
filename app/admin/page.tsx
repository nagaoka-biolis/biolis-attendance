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
  const [selectedStaffId, setSelectedStaffId] = useState('')
  const [loading, setLoading] = useState(true)
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [messages, setMessages] = useState<MessageWithProfile[]>([])
  const [newStaff, setNewStaff] = useState({ name: '', email: '', password: '', role: 'staff' })
  const [staffSaving, setStaffSaving] = useState(false)
  const [staffMsg, setStaffMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const [tab, setTab] = useState<'attendance' | 'staff' | 'messages'>('attendance')
  const [staffList, setStaffList] = useState<Profile[]>([])
  const [manual, setManual] = useState({ userId: '', type: 'clock_in', datetime: '' })
  const [manualMsg, setManualMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const [standardMinutes, setStandardMinutes] = useState(480)  // 所定労働時間（分）デフォルト8h
  const [settingHours, setSettingHours] = useState('8')
  const [settingMsg, setSettingMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null)

  const fetchSettings = useCallback(async () => {
    const { data } = await supabase.from('app_settings').select('value').eq('key', 'standard_work_minutes').maybeSingle()
    const v = (data as { value?: string } | null)?.value
    if (v) { setStandardMinutes(Number(v)); setSettingHours(String(Number(v) / 60)) }
  }, [])

  const handleSaveSetting = async () => {
    const mins = Math.round(Number(settingHours) * 60)
    if (!Number.isFinite(mins) || mins <= 0) { setSettingMsg({ text: '正しい時間を入力してください', type: 'error' }); return }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from('app_settings') as any).upsert({ key: 'standard_work_minutes', value: String(mins) })
    if (error) {
      setSettingMsg({ text: '保存に失敗しました（設定テーブル未作成の可能性）', type: 'error' })
    } else {
      setStandardMinutes(mins)
      setSettingMsg({ text: `所定労働時間を ${Number(settingHours)} 時間に設定しました`, type: 'success' })
    }
  }

  const overtimeOf = (workMinutes: number) => workMinutes > standardMinutes ? workMinutes - standardMinutes : 0

  const handleManualAdd = async () => {
    if (!manual.userId || !manual.datetime) {
      setManualMsg({ text: 'スタッフと日時を選んでください', type: 'error' }); return
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from('attendance') as any).insert({
      user_id: manual.userId,
      type: manual.type,
      timestamp: new Date(manual.datetime).toISOString(),
      is_valid: true,
    })
    if (error) {
      setManualMsg({ text: '追加に失敗しました', type: 'error' })
    } else {
      setManualMsg({ text: '打刻を追加しました', type: 'success' })
      setManual({ ...manual, datetime: '' })
      await fetchData()
    }
  }

  const fetchStaff = useCallback(async () => {
    const { data } = await supabase.from('profiles').select('*').order('created_at', { ascending: true })
    if (data) setStaffList(data as Profile[])
  }, [])

  const authHeader = async () => {
    const { data: { session } } = await supabase.auth.getSession()
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token ?? ''}` }
  }

  const handleResetPassword = async (s: Profile) => {
    const pw = window.prompt(`${s.name} さんの新しいパスワードを入力してください（6文字以上）`)
    if (!pw) return
    if (pw.length < 6) { alert('パスワードは6文字以上にしてください'); return }
    const res = await fetch('/api/reset-password', {
      method: 'POST', headers: await authHeader(),
      body: JSON.stringify({ userId: s.id, password: pw }),
    })
    const r = await res.json().catch(() => ({}))
    alert(res.ok ? `${s.name} さんのパスワードを再設定しました` : `失敗: ${r.error ?? '不明なエラー'}`)
  }

  const handleDeleteStaff = async (s: Profile) => {
    if (!window.confirm(`${s.name} さんを削除します。\nこのスタッフのアカウントと打刻履歴・連絡もすべて削除され、元に戻せません。\n本当に削除しますか？`)) return
    const res = await fetch('/api/delete-staff', {
      method: 'POST', headers: await authHeader(),
      body: JSON.stringify({ userId: s.id }),
    })
    const r = await res.json().catch(() => ({}))
    if (res.ok) { await fetchStaff(); await fetchData() }
    else alert(`失敗: ${r.error ?? '不明なエラー'}`)
  }

  const handleAddStaff = async () => {
    setStaffSaving(true)
    setStaffMsg(null)
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch('/api/create-staff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token ?? ''}` },
      body: JSON.stringify(newStaff),
    })
    const result = await res.json().catch(() => ({}))
    if (res.ok) {
      setStaffMsg({ text: `${result.name} さんを登録しました（${newStaff.email}）`, type: 'success' })
      setNewStaff({ name: '', email: '', password: '', role: 'staff' })
      await fetchStaff()
    } else {
      setStaffMsg({ text: result.error ?? '登録に失敗しました', type: 'error' })
    }
    setStaffSaving(false)
  }

  // ISO日時 → datetime-local入力用（ローカル時刻 YYYY-MM-DDTHH:mm）
  const toLocalInput = (ts: string) => {
    const d = new Date(ts)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  }

  const handleSaveTime = async (id: string) => {
    if (!editValue) return
    const iso = new Date(editValue).toISOString()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from('attendance') as any).update({ timestamp: iso }).eq('id', id)
    setEditingId(null)
    setEditValue('')
    await fetchData()
  }

  const handleDeleteRecord = async (id: string) => {
    if (!window.confirm('この打刻を削除しますか？この操作は取り消せません。')) return
    await supabase.from('attendance').delete().eq('id', id)
    await fetchData()
  }

  // --- CSVエクスポート ---
  const hm = (min: number) => `${Math.floor(min / 60)}h ${Math.floor(min % 60)}m`
  const dec = (min: number) => (min / 60).toFixed(2)  // 小数時間（給与計算用）

  const downloadCSV = (filename: string, rows: (string | number)[][]) => {
    const csv = rows.map(r => r.map(cell => {
      const s = String(cell ?? '')
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }).join(',')).join('\r\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  const exportDaily = () => {
    const rows: (string | number)[][] = [['日付', '名前', '出勤', '退勤', '休憩(h:m)', '勤務時間(h:m)', '勤務時間(時間)']]
    for (const s of filtered) {
      rows.push([
        s.date, s.name,
        s.clockIn ? formatTime(s.clockIn) : '',
        s.clockOut ? formatTime(s.clockOut) : '',
        hm(s.breakMinutes), hm(s.minutes), dec(s.minutes),
      ])
    }
    downloadCSV(`勤怠_日次_${selectedMonth}.csv`, rows)
  }

  const exportRaw = () => {
    const rows: (string | number)[][] = [['日付', '名前', '種別', '時刻', '位置判定']]
    const label = { clock_in: '出勤', clock_out: '退勤', break_start: '休憩開始', break_end: '休憩終了' }
    for (const s of filtered) {
      for (const r of s.records) {
        rows.push([
          s.date, s.name, label[r.type],
          new Date(r.timestamp).toLocaleString('ja-JP'),
          r.is_valid ? 'OK' : '要確認',
        ])
      }
    }
    downloadCSV(`勤怠_打刻明細_${selectedMonth}.csv`, rows)
  }

  const exportMonthly = () => {
    // スタッフごとに月間集計（同姓を分けるため userId をキーに）
    const byStaff = new Map<string, { name: string; days: Set<string>; work: number; ot: number; brk: number }>()
    for (const s of filtered) {
      if (!byStaff.has(s.userId)) byStaff.set(s.userId, { name: s.name, days: new Set(), work: 0, ot: 0, brk: 0 })
      const e = byStaff.get(s.userId)!
      if (s.clockIn && s.clockOut) e.days.add(s.date)
      e.work += s.minutes
      e.ot += overtimeOf(s.minutes)
      e.brk += s.breakMinutes
    }
    const rows: (string | number)[][] = [['名前', '出勤日数', '勤務時間(h:m)', '勤務時間(時間)', '残業(h:m)', '残業(時間)', '休憩合計(h:m)']]
    for (const e of byStaff.values()) {
      rows.push([e.name, e.days.size, hm(e.work), dec(e.work), hm(e.ot), dec(e.ot), hm(e.brk)])
    }
    downloadCSV(`勤怠_月次集計_${selectedMonth}.csv`, rows)
  }

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
      await fetchStaff()
      await fetchSettings()
    }
    init()
  }, [router, fetchData, fetchMessages, fetchStaff, fetchSettings])

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/')
  }

  const filtered = summaries.filter(s =>
    selectedStaffId === '' || s.userId === selectedStaffId
  )

  // 同姓判定（プルダウンの表示用）
  const nameCounts = staffList.reduce((acc, s) => {
    acc[s.name] = (acc[s.name] ?? 0) + 1
    return acc
  }, {} as Record<string, number>)
  const staffLabel = (s: Profile) => nameCounts[s.name] > 1 ? `${s.name}（ID:${s.id.slice(0, 4)}）` : s.name
  const selectedStaffName = staffList.find(s => s.id === selectedStaffId)?.name ?? ''

  // スタッフ別月次集計（同姓を分けるため userId をキーに）
  const staffMonthly = Array.from(
    filtered.reduce((acc, s) => {
      const cur = acc.get(s.userId) ?? { name: s.name, mins: 0, ot: 0 }
      cur.mins += s.minutes
      cur.ot += overtimeOf(s.minutes)
      acc.set(s.userId, cur)
      return acc
    }, new Map<string, { name: string; mins: number; ot: number }>()).values()
  )

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

      {/* タブ */}
      <div className="max-w-3xl mx-auto px-5 pt-5">
        <div className="flex gap-1 p-1 rounded-xl" style={{ background: 'var(--gray-light)' }}>
          {([
            ['attendance', '勤怠'],
            ['staff', 'スタッフ管理'],
            ['messages', '連絡'],
          ] as const).map(([key, label]) => {
            const unresolved = key === 'messages' ? messages.filter(m => !m.resolved).length : 0
            return (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`flex-1 py-2.5 rounded-lg text-sm tracking-wider transition ${tab === key ? 'shadow-sm' : ''}`}
                style={{
                  background: tab === key ? '#fff' : 'transparent',
                  color: tab === key ? 'var(--navy)' : 'var(--gray)',
                  fontWeight: tab === key ? 600 : 400,
                }}
              >
                {label}
                {unresolved > 0 && (
                  <span className="ml-1.5 text-xs px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">{unresolved}</span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-5 py-6 space-y-5">

        {/* フィルター */}
        {tab === 'attendance' && (
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
            <label className="text-xs tracking-widest block mb-1" style={{ color: 'var(--gray)' }}>スタッフで絞り込み</label>
            <select
              value={selectedStaffId}
              onChange={e => setSelectedStaffId(e.target.value)}
              className="w-full px-3 py-2 rounded-lg text-sm border focus:outline-none"
              style={{ borderColor: 'var(--gray-light)', background: 'var(--off-white)', color: 'var(--navy)' }}
            >
              <option value="">全員</option>
              {staffList.map(s => (
                <option key={s.id} value={s.id}>{staffLabel(s)}</option>
              ))}
            </select>
          </div>
        </div>
        )}

        {/* スタッフ追加 */}
        {tab === 'staff' && (
        <div className="card p-5">
          <div className="text-xs tracking-[0.2em] mb-3" style={{ color: 'var(--gray)' }}>
            ADD STAFF — スタッフを追加
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input
              type="text" value={newStaff.name}
              onChange={e => setNewStaff({ ...newStaff, name: e.target.value })}
              placeholder="名前（例：佐々木 花子）"
              className="px-3 py-2 rounded-lg text-sm border focus:outline-none"
              style={{ borderColor: 'var(--gray-light)', background: 'var(--off-white)', color: 'var(--navy)' }}
            />
            <input
              type="email" value={newStaff.email}
              onChange={e => setNewStaff({ ...newStaff, email: e.target.value })}
              placeholder="メールアドレス（ログインID）"
              className="px-3 py-2 rounded-lg text-sm border focus:outline-none"
              style={{ borderColor: 'var(--gray-light)', background: 'var(--off-white)', color: 'var(--navy)' }}
            />
            <input
              type="text" value={newStaff.password}
              onChange={e => setNewStaff({ ...newStaff, password: e.target.value })}
              placeholder="初期パスワード（6文字以上）"
              className="px-3 py-2 rounded-lg text-sm border focus:outline-none"
              style={{ borderColor: 'var(--gray-light)', background: 'var(--off-white)', color: 'var(--navy)' }}
            />
            <select
              value={newStaff.role}
              onChange={e => setNewStaff({ ...newStaff, role: e.target.value })}
              className="px-3 py-2 rounded-lg text-sm border focus:outline-none"
              style={{ borderColor: 'var(--gray-light)', background: 'var(--off-white)', color: 'var(--navy)' }}
            >
              <option value="staff">スタッフ（打刻のみ）</option>
              <option value="admin">管理者（集計・管理も可能）</option>
            </select>
          </div>
          <button
            onClick={handleAddStaff}
            disabled={staffSaving || !newStaff.name || !newStaff.email || newStaff.password.length < 6}
            className="btn-gold w-full sm:w-auto px-6 py-2.5 rounded-lg text-sm tracking-[0.15em] mt-3"
          >
            {staffSaving ? '登録中...' : 'スタッフを登録'}
          </button>
          {staffMsg && (
            <div className={`mt-3 text-sm rounded-lg px-3 py-2 ${
              staffMsg.type === 'success' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'
            }`}>
              {staffMsg.text}
            </div>
          )}
          <div className="text-xs mt-2" style={{ color: 'var(--gray)' }}>
            登録したメールアドレスと初期パスワードをスタッフに伝えてください。スタッフはそれでログインし、打刻できます。
          </div>
        </div>
        )}

        {/* スタッフ一覧 */}
        {tab === 'staff' && (
        <div className="card p-5">
          <div className="text-xs tracking-[0.2em] mb-4" style={{ color: 'var(--gray)' }}>
            STAFF LIST — スタッフ一覧（{staffList.length}名）
          </div>
          {staffList.length === 0 ? (
            <p className="text-sm text-center py-4" style={{ color: 'var(--gray)' }}>スタッフがいません</p>
          ) : (
            <div className="space-y-2">
              {staffList.map(s => (
                <div key={s.id} className="flex items-center justify-between gap-2 py-2.5 border-b border-gray-50 flex-wrap">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium" style={{ color: 'var(--navy)' }}>{s.name}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      s.role === 'admin' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'
                    }`}>
                      {s.role === 'admin' ? '管理者' : 'スタッフ'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleResetPassword(s)}
                      className="text-xs px-3 py-1 rounded-full border hover:bg-white transition"
                      style={{ borderColor: 'var(--gray-light)', color: 'var(--gray)' }}
                    >
                      パスワード再設定
                    </button>
                    {s.id !== profile.id && (
                      <button
                        onClick={() => handleDeleteStaff(s)}
                        className="text-xs px-3 py-1 rounded-full border border-red-200 text-red-500 hover:bg-red-50 transition"
                      >
                        削除
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="text-xs mt-3" style={{ color: 'var(--gray)' }}>
            パスワードを忘れたスタッフには「パスワード再設定」で新しいパスワードを設定し、本人に伝えてください。
          </div>
        </div>
        )}

        {/* CSVダウンロード */}
        {tab === 'attendance' && (
        <div className="card p-5">
          <div className="text-xs tracking-[0.2em] mb-3" style={{ color: 'var(--gray)' }}>
            CSV ダウンロード — {selectedMonth.replace('-', '年')}月{selectedStaffName && `（${selectedStaffName}）`}
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={exportMonthly} className="btn-gold text-sm px-4 py-2 rounded-lg">月次集計（給与用）</button>
            <button onClick={exportDaily} className="btn-outline text-sm px-4 py-2 rounded-lg">日次集計</button>
            <button onClick={exportRaw} className="btn-outline text-sm px-4 py-2 rounded-lg">打刻明細</button>
          </div>
          <div className="text-xs mt-2" style={{ color: 'var(--gray)' }}>
            Excel・Googleスプレッドシートで開けます。上の「月」「スタッフ名」の絞り込みがそのまま反映されます。
          </div>
        </div>
        )}

        {/* 所定労働時間の設定 */}
        {tab === 'attendance' && (
        <div className="card p-5">
          <div className="text-xs tracking-[0.2em] mb-3" style={{ color: 'var(--gray)' }}>
            SETTINGS — 所定労働時間（残業判定の基準）
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-sm" style={{ color: 'var(--navy)' }}>1日</span>
            <input
              type="number" step="0.5" min="1"
              value={settingHours}
              onChange={e => setSettingHours(e.target.value)}
              className="w-24 px-3 py-2 rounded-lg text-sm border focus:outline-none"
              style={{ borderColor: 'var(--gray-light)', background: 'var(--off-white)', color: 'var(--navy)' }}
            />
            <span className="text-sm" style={{ color: 'var(--navy)' }}>時間を超えた分を残業とする</span>
            <button onClick={handleSaveSetting} className="btn-gold px-5 py-2 rounded-lg text-sm">保存</button>
          </div>
          {settingMsg && (
            <div className={`mt-3 text-sm rounded-lg px-3 py-2 ${
              settingMsg.type === 'success' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'
            }`}>
              {settingMsg.text}
            </div>
          )}
          <div className="text-xs mt-2" style={{ color: 'var(--gray)' }}>
            現在の設定：1日 {standardMinutes / 60} 時間。いつでも変更できます。
          </div>
        </div>
        )}

        {/* 打刻の手動追加 */}
        {tab === 'attendance' && (
        <div className="card p-5">
          <div className="text-xs tracking-[0.2em] mb-3" style={{ color: 'var(--gray)' }}>
            ADD PUNCH — 打刻の手動追加（押し忘れた分）
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <select
              value={manual.userId}
              onChange={e => setManual({ ...manual, userId: e.target.value })}
              className="px-3 py-2 rounded-lg text-sm border focus:outline-none"
              style={{ borderColor: 'var(--gray-light)', background: 'var(--off-white)', color: 'var(--navy)' }}
            >
              <option value="">スタッフを選択</option>
              {staffList.map(s => <option key={s.id} value={s.id}>{staffLabel(s)}</option>)}
            </select>
            <select
              value={manual.type}
              onChange={e => setManual({ ...manual, type: e.target.value })}
              className="px-3 py-2 rounded-lg text-sm border focus:outline-none"
              style={{ borderColor: 'var(--gray-light)', background: 'var(--off-white)', color: 'var(--navy)' }}
            >
              <option value="clock_in">出勤</option>
              <option value="clock_out">退勤</option>
              <option value="break_start">休憩開始</option>
              <option value="break_end">休憩終了</option>
            </select>
            <input
              type="datetime-local"
              value={manual.datetime}
              onChange={e => setManual({ ...manual, datetime: e.target.value })}
              className="px-3 py-2 rounded-lg text-sm border focus:outline-none"
              style={{ borderColor: 'var(--gray-light)', background: 'var(--off-white)', color: 'var(--navy)' }}
            />
          </div>
          <button onClick={handleManualAdd} className="btn-gold px-6 py-2.5 rounded-lg text-sm tracking-[0.15em] mt-3">
            打刻を追加
          </button>
          {manualMsg && (
            <div className={`mt-3 text-sm rounded-lg px-3 py-2 ${
              manualMsg.type === 'success' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'
            }`}>
              {manualMsg.text}
            </div>
          )}
        </div>
        )}

        {/* 月次集計（スタッフ別） */}
        {tab === 'attendance' && (
        <div className="card p-5">
          <div className="text-xs tracking-[0.2em] mb-4" style={{ color: 'var(--gray)' }}>
            MONTHLY SUMMARY — {selectedMonth.replace('-', '年')}月
          </div>
          {staffMonthly.length === 0 ? (
            <p className="text-sm text-center py-4" style={{ color: 'var(--gray)' }}>データがありません</p>
          ) : (
            <div className="space-y-2">
              {[...staffMonthly].sort((a, b) => b.mins - a.mins).map((e, i) => (
                <div key={i} className="flex items-center justify-between py-2 border-b border-gray-50">
                  <span className="text-sm font-medium" style={{ color: 'var(--navy)' }}>{e.name}</span>
                  <div className="flex items-center gap-4">
                    {e.ot > 0 && (
                      <span className="text-xs" style={{ color: '#EF4444' }}>
                        残業 {Math.floor(e.ot / 60)}h {Math.floor(e.ot % 60)}m
                      </span>
                    )}
                    <span className="text-sm" style={{ color: 'var(--gold)' }}>
                      {Math.floor(e.mins / 60)}h {Math.floor(e.mins % 60)}m
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        )}

        {/* スタッフからの連絡 */}
        {tab === 'messages' && (
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
        )}

        {/* 日別打刻ログ */}
        {tab === 'attendance' && (
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
                    <th className="text-right pb-3 font-normal">残業</th>
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
                        <td className="py-2.5 text-right text-xs" style={{ color: overtimeOf(s.minutes) > 0 ? '#EF4444' : 'var(--gray-light)' }}>
                          {overtimeOf(s.minutes) > 0 ? `${Math.floor(overtimeOf(s.minutes) / 60)}h ${Math.floor(overtimeOf(s.minutes) % 60)}m` : '—'}
                        </td>
                        <td className="py-2.5 text-right" style={{ color: s.minutes > 0 ? 'var(--gold)' : 'var(--gray)' }}>
                          {s.minutes > 0 ? `${Math.floor(s.minutes / 60)}h ${Math.floor(s.minutes % 60)}m` : '—'}
                        </td>
                      </tr>
                      {expandedKey === s.key && (
                        <tr>
                          <td colSpan={7} className="px-4 py-3 bg-amber-50/40">
                            <div className="text-xs tracking-wider mb-2" style={{ color: 'var(--gray)' }}>
                              打刻の詳細（{s.name} ・ {formatDate(s.clockIn || s.date)}）
                            </div>
                            <div className="space-y-1.5">
                              {s.records.map(r => (
                                <div key={r.id} className="flex items-center gap-3 text-sm flex-wrap">
                                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                                    r.type === 'clock_in' ? 'bg-emerald-100 text-emerald-700' :
                                    r.type === 'clock_out' ? 'bg-slate-100 text-slate-600' :
                                    'bg-amber-100 text-amber-700'
                                  }`}>
                                    {{ clock_in: '出勤', clock_out: '退勤', break_start: '休憩開始', break_end: '休憩終了' }[r.type]}
                                  </span>
                                  {editingId === r.id ? (
                                    <>
                                      <input
                                        type="datetime-local"
                                        value={editValue}
                                        onChange={e => setEditValue(e.target.value)}
                                        className="px-2 py-1 rounded border text-xs"
                                        style={{ borderColor: 'var(--gray-light)', background: '#fff', color: 'var(--navy)' }}
                                      />
                                      <button onClick={() => handleSaveTime(r.id)} className="btn-gold text-xs px-3 py-1 rounded-full">保存</button>
                                      <button onClick={() => { setEditingId(null); setEditValue('') }} className="text-xs px-3 py-1 rounded-full bg-slate-100 text-slate-600">取消</button>
                                    </>
                                  ) : (
                                    <>
                                      <span style={{ color: 'var(--navy)' }}>{formatTime(r.timestamp)}</span>
                                      {!r.is_valid && <span className="text-xs" style={{ color: '#EF4444' }}>要確認（位置）</span>}
                                      <button
                                        onClick={() => { setEditingId(r.id); setEditValue(toLocalInput(r.timestamp)) }}
                                        className="text-xs px-2 py-0.5 rounded-full border hover:bg-white transition"
                                        style={{ borderColor: 'var(--gray-light)', color: 'var(--gray)' }}
                                      >
                                        時刻編集
                                      </button>
                                      <button
                                        onClick={() => handleDeleteRecord(r.id)}
                                        className="text-xs px-2 py-0.5 rounded-full border border-red-200 text-red-500 hover:bg-red-50 transition"
                                      >
                                        削除
                                      </button>
                                    </>
                                  )}
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
        )}

      </div>
    </div>
  )
}
