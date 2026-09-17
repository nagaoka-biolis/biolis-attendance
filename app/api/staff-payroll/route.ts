import { NextRequest, NextResponse } from 'next/server'
import { requirePayrollViewer } from '@/lib/server-admin'
import { nightOverlapMin, commuteAmount, wageForDate, type WageRow } from '@/lib/staff-pay'

export const runtime = 'nodejs'

type Att = { user_id: string; type: string; timestamp: string }

// 給与を見られる人だけが、月を指定して 時給スタッフの基本給を取得する。
export async function POST(req: NextRequest) {
  const auth = await requirePayrollViewer(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const admin = auth.admin

  const body = await req.json().catch(() => null)
  const month = String(body?.month ?? '')
  const mm = month.match(/^(\d{4})-(\d{2})$/)
  if (!mm) return NextResponse.json({ error: '月の指定が不正です' }, { status: 400 })
  const year = Number(mm[1]); const mon = Number(mm[2])
  const start = `${year}-${String(mon).padStart(2, '0')}-01`
  const lastDay = new Date(year, mon, 0).getDate()
  const end = `${year}-${String(mon).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`

  // 所定労働時間（残業判定の基準）。既定 480分=8時間。
  let standardMin = 480
  try {
    const { data } = await admin.from('app_settings').select('value').eq('key', 'standard_work_minutes').maybeSingle()
    const v = Number((data as { value?: string } | null)?.value)
    if (Number.isFinite(v) && v > 0) standardMin = v
  } catch { /* 既定のまま */ }

  const { data: profs } = await admin.from('profiles').select('id,name')
  const nameOf = new Map<string, string>((profs ?? []).map((p: { id: string; name: string }) => [p.id, p.name]))

  const { data: wagesRaw } = await admin.from('staff_wages').select('*')
  const wagesByUser = new Map<string, WageRow[]>()
  for (const w of (wagesRaw ?? []) as WageRow[]) {
    const a = wagesByUser.get(w.user_id) ?? []; a.push(w); wagesByUser.set(w.user_id, a)
  }
  if (wagesByUser.size === 0) return NextResponse.json({ ok: true, month: `${year}年${mon}月`, results: [], grand: emptyGrand() })

  // 打刻を (ユーザー×日) に集計
  const { data: att } = await admin.from('attendance').select('user_id,type,timestamp')
    .gte('timestamp', `${start}T00:00:00+09:00`).lte('timestamp', `${end}T23:59:59+09:00`)
    .order('timestamp', { ascending: true })
  const jstShift = (ts: string) => new Date(new Date(ts).getTime() + 9 * 60 * 60 * 1000)
  const jstDate = (ts: string) => { const d = jstShift(ts); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}` }
  const jstHM = (ts: string) => { const d = jstShift(ts); return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}` }

  type DayAtt = { clockInISO: string | null; clockOutISO: string | null; clockInHM: string; clockOutHM: string; breakMin: number; hasBreak: boolean; breaks: { start: string; end: string }[] }
  const attMap = new Map<string, DayAtt>()
  const brkTmp = new Map<string, string | null>()
  for (const a of (att ?? []) as Att[]) {
    const key = `${a.user_id}|${jstDate(a.timestamp)}`
    let e = attMap.get(key)
    if (!e) { e = { clockInISO: null, clockOutISO: null, clockInHM: '', clockOutHM: '', breakMin: 0, hasBreak: false, breaks: [] }; attMap.set(key, e) }
    if (a.type === 'clock_in' && !e.clockInISO) { e.clockInISO = a.timestamp; e.clockInHM = jstHM(a.timestamp) }
    if (a.type === 'clock_out') { e.clockOutISO = a.timestamp; e.clockOutHM = jstHM(a.timestamp) }
    if (a.type === 'break_start') { brkTmp.set(key, a.timestamp); e.hasBreak = true }
    if (a.type === 'break_end') { const bs = brkTmp.get(key); if (bs) { e.breakMin += Math.floor((new Date(a.timestamp).getTime() - new Date(bs).getTime()) / 60000); e.breaks.push({ start: jstHM(bs), end: jstHM(a.timestamp) }); brkTmp.set(key, null) } }
  }

  const results = []
  for (const [userId, wageRows] of wagesByUser) {
    const latest = wageRows.slice().sort((a, b) => (a.effective_from < b.effective_from ? 1 : -1))[0]
    const payType = latest.pay_type

    // その月にこのユーザーが打刻した日を集める
    const dayKeys = Array.from(attMap.keys()).filter(k => k.startsWith(`${userId}|`))
    const dates = dayKeys.map(k => k.split('|')[1]).sort()

    if (payType === 'monthly') {
      // 月給固定。実残業超過はfreee側／第2弾。ここは額面のみ。
      const commute = commuteAmount(latest.commute_round_trip, dates.filter(d => attMap.get(`${userId}|${d}`)?.clockInISO).length)
      const base = latest.monthly_salary ?? 0
      const fixedOt = latest.fixed_overtime ?? 0
      const gross = base + fixedOt + commute
      results.push({
        user_id: userId, name: nameOf.get(userId) ?? '—', payType,
        base, overtimePay: 0, nightPay: 0, fixedOvertime: fixedOt, commute,
        workDays: dates.length, workedMin: 0, overtimeMin: 0, nightMin: 0,
        commuteRoundTrip: latest.commute_round_trip, gross,
        note: latest.note ?? '', alerts: [] as { date: string; msg: string }[], days: [] as unknown[],
      })
      continue
    }

    // 時給制。金額は日別に丸めて合計する（明細の日給の合計＝支給額がぴったり合う）。
    let baseSum = 0, otSum = 0, nightSum = 0
    let workedMin = 0, overtimeMin = 0, nightMin = 0, workDays = 0
    const alerts: { date: string; msg: string }[] = []
    const days: unknown[] = []
    let commuteRoundTrip: number | null = null

    for (const d of dates) {
      const e = attMap.get(`${userId}|${d}`)!
      const wage = wageForDate(wageRows, d)
      const rate = wage?.hourly_rate ?? 0
      if (wage?.commute_round_trip != null) commuteRoundTrip = wage.commute_round_trip
      if (e.clockInISO) workDays++ // 通勤手当は出勤打刻がある日で数える（退勤漏れでも出勤はしている）

      // 打刻不備の判定
      if (e.clockInISO && !e.clockOutISO) { alerts.push({ date: d, msg: '退勤打刻なし（実働に未算入）' }); days.push(dayRow(d, e, 0, 0, 0, rate, '退勤打刻なし', 0)); continue }
      if (!e.clockInISO && e.clockOutISO) { alerts.push({ date: d, msg: '出勤打刻なし（実働に未算入）' }); days.push(dayRow(d, e, 0, 0, 0, rate, '出勤打刻なし', 0)); continue }
      if (!e.clockInISO || !e.clockOutISO) continue

      const inMin = Math.floor((new Date(e.clockInISO).getTime() + 9 * 3600 * 1000) / 60000)
      const outMin = Math.floor((new Date(e.clockOutISO).getTime() + 9 * 3600 * 1000) / 60000)
      const gross = outMin - inMin
      if (gross <= 0) { alerts.push({ date: d, msg: '打刻の時刻が不整合' }); days.push(dayRow(d, e, 0, 0, 0, rate, '時刻不整合', 0)); continue }
      const worked = Math.max(0, gross - Math.max(0, e.breakMin))
      const ot = Math.max(0, worked - standardMin)
      const night = Math.min(nightOverlapMin(e.clockInISO, e.clockOutISO), worked)

      if (rate <= 0) alerts.push({ date: d, msg: '時給が未設定' })
      if (!e.hasBreak && worked >= 360) alerts.push({ date: d, msg: '休憩打刻なし（要確認）' })

      const dayBase = Math.round((worked / 60) * rate)
      const dayOt = Math.round((ot / 60) * rate * 0.25)
      const dayNight = Math.round((night / 60) * rate * 0.25)
      workedMin += worked; overtimeMin += ot; nightMin += night
      baseSum += dayBase; otSum += dayOt; nightSum += dayNight
      days.push(dayRow(d, e, worked, ot, night, rate, e.hasBreak ? '' : (worked >= 360 ? '休憩なし' : ''), dayBase + dayOt + dayNight))
    }

    const base = baseSum
    const overtimePay = otSum
    const nightPay = nightSum
    const commute = commuteAmount(commuteRoundTrip, workDays)
    const gross = base + overtimePay + nightPay + commute
    if (gross === 0 && workDays === 0 && alerts.length === 0) continue

    results.push({
      user_id: userId, name: nameOf.get(userId) ?? '—', payType,
      base, overtimePay, nightPay, fixedOvertime: 0, commute,
      workDays, workedMin, overtimeMin, nightMin,
      commuteRoundTrip, gross,
      note: latest.note ?? '', alerts, days,
    })
  }

  results.sort((a, b) => b.gross - a.gross)
  const grand = results.reduce((g, r) => ({
    base: g.base + r.base, overtimePay: g.overtimePay + r.overtimePay, nightPay: g.nightPay + r.nightPay,
    commute: g.commute + r.commute, gross: g.gross + r.gross,
  }), emptyGrand())

  return NextResponse.json({ ok: true, month: `${year}年${mon}月`, standardMin, results, grand })
}

function emptyGrand() { return { base: 0, overtimePay: 0, nightPay: 0, commute: 0, gross: 0 } }

function dayRow(
  date: string,
  e: { clockInHM: string; clockOutHM: string; breakMin: number; breaks: { start: string; end: string }[] },
  workedMin: number, overtimeMin: number, nightMin: number, rate: number, note: string, pay: number,
) {
  const breakLabel = e.breaks.length ? e.breaks.map(b => `${b.start}-${b.end}`).join(', ') : ''
  return { date, clockIn: e.clockInHM, clockOut: e.clockOutHM, breakMin: e.breakMin, breakLabel, workedMin, overtimeMin, nightMin, rate, note, pay }
}
