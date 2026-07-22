import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/server-admin'

export const runtime = 'nodejs'

type Shift = { user_id: string; date: string; start_time: string | null; end_time: string | null; kind: string }
type Att = { user_id: string; type: string; timestamp: string }
type Rate = { user_id: string; employ_daily: number; contract_daily: number; monthly_allowance: number; both_contracts: boolean; contractor_name: string | null; note: string | null }
type Adj = { user_id: string; date: string; kind: string; contract: string; amount: number; reason: string | null }

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const admin = auth.admin

  const body = await req.json().catch(() => null)
  const month = String(body?.month ?? '')
  const mm = month.match(/^(\d{4})-(\d{2})$/)
  if (!mm) return NextResponse.json({ error: '月の指定が不正です' }, { status: 400 })
  const year = Number(mm[1]); const mon = Number(mm[2])
  const start = `${year}-${String(mon).padStart(2, '0')}-01`
  const end = `${year}-${String(mon).padStart(2, '0')}-${String(new Date(year, mon, 0).getDate()).padStart(2, '0')}`

  const { data: profs } = await admin.from('profiles').select('id,name')
  const name = new Map<string, string>((profs ?? []).map((p: { id: string; name: string }) => [p.id, p.name]))
  const { data: rates } = await admin.from('doctor_rates').select('*')
  const { data: shifts } = await admin.from('shifts').select('user_id,date,start_time,end_time,kind').gte('date', start).lte('date', end)
  const { data: adjs } = await admin.from('pay_adjustments').select('*').gte('date', start).lte('date', end)
  // 承認済みの交通費（実費）をその月ぶん合算する
  const { data: exps } = await admin.from('expense_requests').select('user_id,amount').eq('status', 'approved').gte('date', start).lte('date', end)
  const transportByUser = new Map<string, number>()
  for (const e of (exps ?? []) as { user_id: string; amount: number }[]) {
    transportByUser.set(e.user_id, (transportByUser.get(e.user_id) ?? 0) + (e.amount || 0))
  }

  // 打刻(勤怠)から 出勤/退勤/休憩 を (ユーザー×日)ごとに集計（明細表示用。金額計算はシフトベースのまま）
  const { data: att } = await admin.from('attendance').select('user_id,type,timestamp')
    .gte('timestamp', `${start}T00:00:00+09:00`).lte('timestamp', `${end}T23:59:59+09:00`)
    .order('timestamp', { ascending: true })
  const jstShift = (ts: string) => new Date(new Date(ts).getTime() + 9 * 60 * 60 * 1000)
  const jstDate = (ts: string) => { const d = jstShift(ts); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}` }
  const jstHM = (ts: string) => { const d = jstShift(ts); return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}` }
  const attMap = new Map<string, { clockIn: string; clockOut: string; breakMin: number }>()
  const brkTmp = new Map<string, string | null>()
  for (const a of (att ?? []) as Att[]) {
    const key = `${a.user_id}|${jstDate(a.timestamp)}`
    let e = attMap.get(key)
    if (!e) { e = { clockIn: '', clockOut: '', breakMin: 0 }; attMap.set(key, e) }
    if (a.type === 'clock_in' && !e.clockIn) e.clockIn = jstHM(a.timestamp)
    if (a.type === 'clock_out') e.clockOut = jstHM(a.timestamp)
    if (a.type === 'break_start') brkTmp.set(key, a.timestamp)
    if (a.type === 'break_end') { const bs = brkTmp.get(key); if (bs) { e.breakMin += Math.round((new Date(a.timestamp).getTime() - new Date(bs).getTime()) / 60000); brkTmp.set(key, null) } }
  }

  const shiftsByUser = new Map<string, Shift[]>()
  for (const s of (shifts ?? []) as Shift[]) { const a = shiftsByUser.get(s.user_id) ?? []; a.push(s); shiftsByUser.set(s.user_id, a) }
  const adjByUser = new Map<string, Adj[]>()
  for (const a of (adjs ?? []) as Adj[]) { const x = adjByUser.get(a.user_id) ?? []; x.push(a); adjByUser.set(a.user_id, x) }

  const results = []
  for (const r of (rates ?? []) as Rate[]) {
    const sList = (shiftsByUser.get(r.user_id) ?? []).filter(s => s.kind === 'work' || s.kind === 'paid')
    const aList = adjByUser.get(r.user_id) ?? []
    const transport = transportByUser.get(r.user_id) ?? 0  // 承認済み交通費(実費)
    const dates = new Set<string>([...sList.map(s => s.date), ...aList.map(a => a.date)])
    if (dates.size === 0 && r.monthly_allowance === 0 && transport === 0) continue

    const shiftByDate = new Map(sList.map(s => [s.date, s]))
    const days = []
    let employTotal = 0, contractTotal = 0
    for (const d of Array.from(dates).sort()) {
      const sh = shiftByDate.get(d)
      const daytime = sh ? (!sh.start_time || sh.start_time < '19:00') : false
      let employ = (sh && daytime) ? r.employ_daily : 0
      let contract = (sh && r.both_contracts && r.contract_daily > 0) ? r.contract_daily : 0
      // 個別調整
      for (const a of aList.filter(a => a.date === d)) {
        if (a.kind === 'override') { if (a.contract === 'employ') employ = a.amount; else contract = a.amount }
        else { if (a.contract === 'employ') employ += a.amount; else contract += a.amount } // add
      }
      if (employ || contract) {
        const at = attMap.get(`${r.user_id}|${d}`)
        days.push({
          date: d, employ, contract,
          time: at?.clockIn || (sh ? (sh.start_time ?? '') : ''),   // 出勤（打刻優先、なければシフト開始）
          end: at?.clockOut || (sh ? (sh.end_time ?? '') : ''),      // 退勤（打刻優先、なければシフト終了）
          breakMin: at?.breakMin ?? 0,                               // 休憩（分）
          adj: aList.some(a => a.date === d),
        })
      }
      employTotal += employ; contractTotal += contract
    }
    const worked = days.length > 0
    const allowance = worked ? (r.monthly_allowance || 0) : 0
    contractTotal += allowance // 手当は委託(税込)に乗せる
    const contractTax = Math.round(contractTotal * 10 / 110)
    const total = employTotal + contractTotal + transport
    if (total === 0) continue
    results.push({
      user_id: r.user_id, name: name.get(r.user_id) ?? '—',
      employTotal, contractTotal, contractTax, allowance, transport,
      daysCount: days.length, total, note: r.note ?? '', contractorName: r.contractor_name ?? '', days,
    })
  }
  results.sort((a, b) => b.total - a.total)
  const grand = results.reduce((g, r) => ({ employ: g.employ + r.employTotal, contract: g.contract + r.contractTotal, tax: g.tax + r.contractTax, transport: g.transport + r.transport, total: g.total + r.total }), { employ: 0, contract: 0, tax: 0, transport: 0, total: 0 })

  return NextResponse.json({ ok: true, month: `${year}年${mon}月`, results, grand })
}
