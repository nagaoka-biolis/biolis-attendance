'use client'

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

// 時給スタッフの基本給（計算＋時給マスタ）。利用は payroll_viewers 名簿のみ（サーバ側で判定）。
// ルールの出所: vault/人事給与/給与ルール_全社まとめ.md

type Day = { date: string; clockIn: string; clockOut: string; breakMin: number; breakLabel: string; workedMin: number; overtimeMin: number; nightMin: number; rate: number; note: string; pay: number }
type Alert = { date: string; msg: string }
type Row = {
  user_id: string; name: string; payType: string
  base: number; overtimePay: number; nightPay: number; fixedOvertime: number; commute: number
  workDays: number; workedMin: number; overtimeMin: number; nightMin: number
  commuteRoundTrip: number | null; gross: number
  note: string; alerts: Alert[]; days: Day[]
}
type Grand = { base: number; overtimePay: number; nightPay: number; commute: number; gross: number }
type Wage = {
  user_id: string; effective_from: string; pay_type: string
  hourly_rate: number | null; monthly_salary: number | null; fixed_overtime: number
  commute_round_trip: number | null; freee_employee_code: string | null; note: string | null
}
type Staff = { id: string; name: string; role: string }

const yen = (n: number) => `¥${Math.round(n).toLocaleString()}`
const hm = (min: number) => `${Math.floor(min / 60)}:${String(Math.round(min % 60)).padStart(2, '0')}`
const hours = (min: number) => (min / 60).toFixed(2)
const thisMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }

async function authHeaders(): Promise<HeadersInit> {
  const { data: { session } } = await supabase.auth.getSession()
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token ?? ''}` }
}

export default function StaffPayroll() {
  const [view, setView] = useState<'calc' | 'master' | 'freee'>('calc')
  const [month, setMonth] = useState(thisMonth())
  const [rows, setRows] = useState<Row[]>([])
  const [grand, setGrand] = useState<Grand | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)

  const fetchCalc = useCallback(async (m: string) => {
    setLoading(true); setError('')
    try {
      const res = await fetch('/api/staff-payroll', { method: 'POST', headers: await authHeaders(), body: JSON.stringify({ month: m }) })
      const d = await res.json()
      if (!res.ok) { setError(d?.error ?? '取得に失敗しました'); setRows([]); setGrand(null); return }
      setRows(d.results ?? []); setGrand(d.grand ?? null)
    } catch { setError('通信に失敗しました') } finally { setLoading(false) }
  }, [])

  useEffect(() => { if (view === 'calc') fetchCalc(month) }, [view, month, fetchCalc])

  const exportCSV = () => {
    const header = ['氏名', '給与形態', '出勤日数', '実働(時間)', '実働(時:分)', '残業(時間)', '残業(時:分)', '深夜(時間)', '深夜(時:分)', '基本給', '時間外手当', '深夜手当', '固定残業', '通勤手当', '支給合計', 'アラート']
    const body = rows.map(r => [
      r.name, r.payType === 'monthly' ? '月給' : '時給', r.workDays,
      hours(r.workedMin), hm(r.workedMin), hours(r.overtimeMin), hm(r.overtimeMin), hours(r.nightMin), hm(r.nightMin),
      r.base, r.overtimePay, r.nightPay, r.fixedOvertime, r.commute, r.gross,
      r.alerts.map(a => `${a.date} ${a.msg}`).join(' / '),
    ])
    const csv = [header, ...body].map(row => row.map(c => {
      const s = String(c ?? '')
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }).join(',')).join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = `基本給_${month}.csv`; a.click(); URL.revokeObjectURL(url)
  }

  return (
    <div className="card p-5">
      <div className="flex flex-col sm:flex-row gap-3 sm:items-center mb-3">
        <div className="text-xs tracking-[0.2em] flex-1" style={{ color: 'var(--gray)' }}>BASE PAY — 基本給（時給スタッフ）</div>
        <div className="flex gap-1 p-1 rounded-lg" style={{ background: 'var(--gray-light)' }}>
          {([['calc', '計算'], ['master', '時給マスタ'], ['freee', 'freee連携']] as const).map(([k, l]) => (
            <button key={k} onClick={() => setView(k)}
              className="px-3 py-1.5 rounded-md text-sm transition"
              style={{ background: view === k ? '#fff' : 'transparent', color: view === k ? 'var(--navy)' : 'var(--gray)', fontWeight: view === k ? 600 : 400 }}>{l}</button>
          ))}
        </div>
      </div>

      <div className="text-xs rounded-lg px-3 py-2 mb-4" style={{ background: '#FFF8E7', color: '#9A7B1F' }}>
        ※これは「見込み・試算」です。源泉徴収・社会保険・欠勤控除・差引支給額はfreeeで計算します。ここでは freee に渡す支給項目（基本給・時間外手当・深夜手当・通勤手当）までを出します。月給の人の実残業超過は第2弾。
      </div>

      {view === 'calc' && (
        <>
          <div className="flex items-center gap-3 mb-4">
            <input type="month" value={month} onChange={e => setMonth(e.target.value)}
              className="px-3 py-2 rounded-lg text-sm border focus:outline-none" style={{ borderColor: 'var(--gray-light)', background: 'var(--off-white)', color: 'var(--navy)' }} />
            <button onClick={exportCSV} disabled={!rows.length} className="btn-outline text-sm px-4 py-2 rounded-lg disabled:opacity-40">CSV（freee用）</button>
          </div>

          {error && <div className="text-sm rounded-lg px-3 py-2 mb-3" style={{ background: '#FEECEC', color: '#B4232A' }}>{error}</div>}
          {loading && <div className="text-sm py-6 text-center" style={{ color: 'var(--gray)' }}>計算中…</div>}

          {!loading && !error && rows.length === 0 && (
            <div className="text-sm py-6 text-center" style={{ color: 'var(--gray)' }}>この月の対象データがありません。「時給マスタ」で時給を登録してください。</div>
          )}

          {!loading && grand && rows.length > 0 && (
            <div className="rounded-lg p-3 mb-4 flex flex-wrap gap-x-6 gap-y-1 text-sm" style={{ background: 'var(--off-white)' }}>
              <span style={{ color: 'var(--gray)' }}>基本給計 <b style={{ color: 'var(--navy)' }}>{yen(grand.base)}</b></span>
              <span style={{ color: 'var(--gray)' }}>時間外 <b style={{ color: 'var(--navy)' }}>{yen(grand.overtimePay)}</b></span>
              <span style={{ color: 'var(--gray)' }}>深夜 <b style={{ color: 'var(--navy)' }}>{yen(grand.nightPay)}</b></span>
              <span style={{ color: 'var(--gray)' }}>通勤 <b style={{ color: 'var(--navy)' }}>{yen(grand.commute)}</b></span>
              <span style={{ color: 'var(--gray)' }}>支給合計 <b style={{ color: 'var(--gold)' }}>{yen(grand.gross)}</b></span>
            </div>
          )}

          <div className="space-y-2">
            {rows.map(r => (
              <div key={r.user_id} className="rounded-lg border" style={{ borderColor: 'var(--gray-light)' }}>
                <button onClick={() => setOpenId(openId === r.user_id ? null : r.user_id)} className="w-full text-left px-4 py-3">
                  <div className="flex items-center justify-between flex-wrap gap-x-3">
                    <span className="text-sm font-medium" style={{ color: 'var(--navy)' }}>
                      {r.name}
                      <span className="ml-2 text-xs px-1.5 py-0.5 rounded" style={{ background: 'var(--gray-light)', color: 'var(--gray)' }}>{r.payType === 'monthly' ? '月給' : '時給'}</span>
                      {r.alerts.length > 0 && <span className="ml-2 text-xs px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">要確認 {r.alerts.length}</span>}
                    </span>
                    <span className="text-sm font-bold" style={{ color: 'var(--gold)' }}>{yen(r.gross)}</span>
                  </div>
                  <div className="text-xs mt-1" style={{ color: 'var(--gray)' }}>
                    {r.payType === 'monthly'
                      ? `月給 ${yen(r.base)}${r.fixedOvertime ? ` ＋固定残業 ${yen(r.fixedOvertime)}` : ''}${r.commute ? ` ＋通勤 ${yen(r.commute)}` : ''} ／ 出勤${r.workDays}日`
                      : `出勤${r.workDays}日 ／ 実働${hm(r.workedMin)} ／ 残業${hm(r.overtimeMin)} ／ 深夜${hm(r.nightMin)}`}
                  </div>
                </button>
                {openId === r.user_id && (
                  <div className="px-4 pb-4 border-t" style={{ borderColor: 'var(--gray-light)' }}>
                    {r.alerts.length > 0 && (
                      <div className="text-xs rounded-lg px-3 py-2 my-3" style={{ background: '#FFF4E5', color: '#9A5B00' }}>
                        {r.alerts.map((a, i) => <div key={i}>⚠ {a.date}：{a.msg}</div>)}
                      </div>
                    )}
                    {r.payType !== 'monthly' && (
                      <div className="text-xs mb-3 mt-3 flex flex-wrap gap-x-5 gap-y-1">
                        <span style={{ color: 'var(--gray)' }}>基本給 <b style={{ color: 'var(--navy)' }}>{yen(r.base)}</b></span>
                        <span style={{ color: 'var(--gray)' }}>時間外(×0.25) <b style={{ color: 'var(--navy)' }}>{yen(r.overtimePay)}</b></span>
                        <span style={{ color: 'var(--gray)' }}>深夜(×0.25) <b style={{ color: 'var(--navy)' }}>{yen(r.nightPay)}</b></span>
                        <span style={{ color: 'var(--gray)' }}>通勤 <b style={{ color: 'var(--navy)' }}>{yen(r.commute)}{r.commuteRoundTrip == null ? '（往復額未取得）' : ''}</b></span>
                      </div>
                    )}
                    {r.days.length > 0 && (
                      <table className="w-full text-xs mt-2">
                        <thead>
                          <tr style={{ color: 'var(--gray)' }}>
                            <th className="text-left font-normal py-1">日付</th><th className="text-left font-normal">出</th><th className="text-left font-normal">退</th>
                            <th className="text-left font-normal">休憩</th><th className="text-right font-normal">実働</th><th className="text-right font-normal">残業</th><th className="text-right font-normal">深夜</th><th className="text-right font-normal">時給</th><th className="text-right font-normal">給与</th><th></th>
                          </tr>
                        </thead>
                        <tbody>
                          {r.days.map((d, i) => (
                            <tr key={i} style={{ borderTop: '1px solid var(--gray-light)' }}>
                              <td className="py-1" style={{ color: 'var(--navy)' }}>{d.date.slice(5)}</td>
                              <td>{d.clockIn || '—'}</td><td>{d.clockOut || '—'}</td>
                              <td style={{ whiteSpace: 'nowrap' }}>{d.breakLabel || (d.breakMin ? hm(d.breakMin) : '—')}</td>
                              <td className="text-right">{d.workedMin ? hm(d.workedMin) : '—'}</td>
                              <td className="text-right">{d.overtimeMin ? hm(d.overtimeMin) : '—'}</td>
                              <td className="text-right">{d.nightMin ? hm(d.nightMin) : '—'}</td>
                              <td className="text-right">{d.rate ? d.rate.toLocaleString() : '—'}</td>
                              <td className="text-right" style={{ color: 'var(--navy)' }}>{d.pay ? yen(d.pay) : '—'}</td>
                              <td className="text-right" style={{ color: '#9A5B00' }}>{d.note}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {view === 'master' && <WageMaster />}
      {view === 'freee' && <FreeeExport />}
    </div>
  )
}

// ---- freee連携（従業員番号の編集＋勤怠サマリーCSV出力） ----
const FREEE_HEADERS = ['従業員番号', '氏名', '所定労働時間（分）', '法定内残業時間（分）', '時間外労働時間（分）', '所定休日労働時間（分）', '深夜労働時間（分）', '法定休日労働時間（分）', '総労働時間（分）', '総労働日数', '所定労働出勤日数', '所定休日出勤日数', '法定休日出勤日数', '遅刻時間（分）', '早退時間（分）', '欠勤日数', '遅刻日数', '早退日数', '有休取得日数', '集計開始日', '集計終了日', 'みなし外の法定内残業時間（分）', 'みなし外の時間外労働時間（分）', '不足時間（分）']

function FreeeExport() {
  const [month, setMonth] = useState(thisMonth())
  const [profiles, setProfiles] = useState<Staff[]>([])
  const [codes, setCodes] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')

  const load = useCallback(async () => {
    setError('')
    try {
      const res = await fetch('/api/freee-map', { headers: await authHeaders() })
      const d = await res.json()
      if (!res.ok) { setError(d?.error ?? '取得に失敗しました'); return }
      setProfiles(d.profiles ?? [])
      const m: Record<string, string> = {}
      for (const r of (d.map ?? []) as { user_id: string; employee_code: string | null }[]) m[r.user_id] = r.employee_code ?? ''
      setCodes(m)
    } catch { setError('通信に失敗しました') }
  }, [])
  useEffect(() => { load() }, [load])

  const saveCode = async (user_id: string, employee_code: string) => {
    await fetch('/api/freee-map', { method: 'POST', headers: await authHeaders(), body: JSON.stringify({ user_id, employee_code }) })
  }

  const exportFreeeCSV = async () => {
    setError(''); setMsg('組み立て中…')
    try {
      const h = await authHeaders()
      const [staffRes, docRes] = await Promise.all([
        fetch('/api/staff-payroll', { method: 'POST', headers: h, body: JSON.stringify({ month }) }).then(r => r.json()),
        fetch('/api/payroll', { method: 'POST', headers: h, body: JSON.stringify({ month: month + '' }) }).then(r => r.json()).catch(() => ({ results: [] })),
      ])
      const [y, mo] = month.split('-')
      const last = new Date(Number(y), Number(mo), 0).getDate()
      const start = `${y}/${mo}/01`
      const end = `${y}/${mo}/${String(last).padStart(2, '0')}`
      const rows: (string | number)[][] = []
      const blank = (code: string, name: string) => [code, name, 0, 0, 0, '', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, start, end, '', '', '']

      // 時給/月給スタッフ
      for (const r of (staffRes?.results ?? []) as Row[]) {
        const code = codes[r.user_id]; if (!code) continue
        const row = blank(code, r.name)
        if (r.payType === 'hourly') {
          row[2] = Math.max(0, r.workedMin - r.overtimeMin) // 所定労働時間
          row[4] = r.overtimeMin                             // 時間外労働時間
          row[6] = r.nightMin                                // 深夜労働時間
          row[8] = r.workedMin                               // 総労働時間
        }
        row[9] = r.workDays; row[10] = r.workDays            // 総労働日数 / 所定労働出勤日数
        rows.push(row)
      }
      // 医師（日給）：総労働日数＝雇用日給が出る日数
      for (const r of (docRes?.results ?? []) as { user_id: string; name: string; days?: { employ: number }[] }[]) {
        const code = codes[r.user_id]; if (!code) continue
        const employDays = (r.days ?? []).filter(d => d.employ > 0).length
        if (employDays === 0) continue
        const row = blank(code, r.name)
        row[9] = employDays; row[10] = employDays
        rows.push(row)
      }

      if (rows.length === 0) { setMsg(''); setError('対象データがありません（従業員番号が未設定か、この月の勤務がありません）'); return }
      const csv = [FREEE_HEADERS, ...rows].map(rw => rw.map(c => {
        const s = String(c ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
      }).join(',')).join('\n')
      const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url; a.download = `freee勤怠サマリー_${month}.csv`; a.click(); URL.revokeObjectURL(url)
      setMsg(`${rows.length}名分を出力しました`)
    } catch { setError('組み立てに失敗しました'); setMsg('') }
  }

  return (
    <div>
      <div className="text-xs rounded-lg px-3 py-2 mb-3" style={{ background: '#EEF4FF', color: '#28527A' }}>
        freeeの「勤怠 → 勤怠サマリーの一括更新」に取り込む形式で出します。<b>紐付けは従業員番号</b>。freee側とここで同じ番号にしてください（今は仮番号）。委託分は給与でなく請求書なので含みません。
      </div>
      {error && <div className="text-sm rounded-lg px-3 py-2 mb-3" style={{ background: '#FEECEC', color: '#B4232A' }}>{error}</div>}

      <div className="flex items-center gap-3 mb-4">
        <input type="month" value={month} onChange={e => setMonth(e.target.value)}
          className="px-3 py-2 rounded-lg text-sm border focus:outline-none" style={{ borderColor: 'var(--gray-light)', background: 'var(--off-white)', color: 'var(--navy)' }} />
        <button onClick={exportFreeeCSV} className="btn-gold text-sm px-4 py-2 rounded-lg">勤怠サマリーCSV（freee形式）</button>
        {msg && <span className="text-xs" style={{ color: 'var(--gray)' }}>{msg}</span>}
      </div>

      <div className="text-xs tracking-widest mb-2" style={{ color: 'var(--gray)' }}>従業員番号（freeeと一致させる）</div>
      <div className="space-y-1">
        {profiles.map(p => (
          <div key={p.id} className="flex items-center justify-between text-sm py-1" style={{ borderTop: '1px solid var(--gray-light)' }}>
            <span style={{ color: 'var(--navy)' }}>{p.name}<span className="ml-2 text-xs" style={{ color: 'var(--gray)' }}>{p.role === 'admin' ? '管理者' : 'スタッフ'}</span></span>
            <input
              value={codes[p.id] ?? ''}
              onChange={e => setCodes({ ...codes, [p.id]: e.target.value })}
              onBlur={e => saveCode(p.id, e.target.value)}
              className="w-28 px-2 py-1 rounded border text-sm text-right" style={{ borderColor: 'var(--gray-light)' }} placeholder="番号"
            />
          </div>
        ))}
      </div>
    </div>
  )
}

// ---- 時給マスタ編集 ----
function WageMaster() {
  const [staff, setStaff] = useState<Staff[]>([])
  const [wages, setWages] = useState<Wage[]>([])
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<Wage | null>(null)

  const load = useCallback(async () => {
    setError('')
    try {
      const res = await fetch('/api/staff-wages', { headers: await authHeaders() })
      const d = await res.json()
      if (!res.ok) { setError(d?.error ?? '取得に失敗しました'); return }
      setStaff(d.staff ?? []); setWages(d.wages ?? [])
    } catch { setError('通信に失敗しました') }
  }, [])
  useEffect(() => { load() }, [load])

  const nameOf = (id: string) => staff.find(s => s.id === id)?.name ?? '—'
  const save = async () => {
    if (!editing) return
    const res = await fetch('/api/staff-wages', { method: 'POST', headers: await authHeaders(), body: JSON.stringify(editing) })
    const d = await res.json()
    if (!res.ok) { setError(d?.error ?? '保存に失敗しました'); return }
    setEditing(null); await load()
  }
  const del = async (w: Wage) => {
    if (!confirm(`${nameOf(w.user_id)} の ${w.effective_from} からの単価を削除しますか？`)) return
    const res = await fetch('/api/staff-wages', { method: 'DELETE', headers: await authHeaders(), body: JSON.stringify({ user_id: w.user_id, effective_from: w.effective_from }) })
    if (res.ok) await load()
  }
  const newRow = (user_id: string): Wage => ({ user_id, effective_from: thisMonth() + '-01', pay_type: 'hourly', hourly_rate: null, monthly_salary: null, fixed_overtime: 0, commute_round_trip: null, freee_employee_code: null, note: null })

  const wagesByUser = new Map<string, Wage[]>()
  for (const w of wages) { const a = wagesByUser.get(w.user_id) ?? []; a.push(w); wagesByUser.set(w.user_id, a) }

  return (
    <div>
      {error && <div className="text-sm rounded-lg px-3 py-2 mb-3" style={{ background: '#FEECEC', color: '#B4232A' }}>{error}</div>}
      <div className="text-xs mb-3" style={{ color: 'var(--gray)' }}>時給は「適用日」つき。単価が変わったら新しい行を足すと、その日から自動で切り替わります。</div>

      <div className="space-y-3">
        {staff.map(s => (
          <div key={s.id} className="rounded-lg border p-3" style={{ borderColor: 'var(--gray-light)' }}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium" style={{ color: 'var(--navy)' }}>{s.name}<span className="ml-2 text-xs" style={{ color: 'var(--gray)' }}>{s.role === 'admin' ? '管理者' : 'スタッフ'}</span></span>
              <button onClick={() => setEditing(newRow(s.id))} className="text-xs px-2 py-1 rounded border" style={{ borderColor: 'var(--gray-light)', color: 'var(--navy)' }}>＋単価を追加</button>
            </div>
            {(wagesByUser.get(s.id) ?? []).length === 0
              ? <div className="text-xs" style={{ color: 'var(--gray)' }}>未設定</div>
              : (wagesByUser.get(s.id) ?? []).map(w => (
                <div key={w.effective_from} className="flex items-center justify-between text-xs py-1" style={{ borderTop: '1px solid var(--gray-light)' }}>
                  <span style={{ color: 'var(--navy)' }}>
                    {w.effective_from}〜 ／ {w.pay_type === 'monthly' ? `月給 ${(w.monthly_salary ?? 0).toLocaleString()}${w.fixed_overtime ? ` ＋固定残業 ${w.fixed_overtime.toLocaleString()}` : ''}` : `時給 ${(w.hourly_rate ?? 0).toLocaleString()}円`}
                    {w.commute_round_trip != null ? ` ／ 通勤往復 ${w.commute_round_trip}円` : ' ／ 通勤未取得'}
                    {w.note ? ` ／ ${w.note}` : ''}
                  </span>
                  <span className="flex gap-2">
                    <button onClick={() => setEditing(w)} style={{ color: 'var(--gold)' }}>編集</button>
                    <button onClick={() => del(w)} style={{ color: '#B4232A' }}>削除</button>
                  </span>
                </div>
              ))}
          </div>
        ))}
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,.4)' }} onClick={() => setEditing(null)}>
          <div className="card p-5 w-full max-w-sm" style={{ background: '#fff' }} onClick={e => e.stopPropagation()}>
            <div className="text-sm font-bold mb-3" style={{ color: 'var(--navy)' }}>{nameOf(editing.user_id)} の単価</div>
            <div className="space-y-2 text-sm">
              <label className="block"><span className="text-xs" style={{ color: 'var(--gray)' }}>適用開始日</span>
                <input type="date" value={editing.effective_from} onChange={e => setEditing({ ...editing, effective_from: e.target.value })} className="w-full px-3 py-2 rounded-lg border" style={{ borderColor: 'var(--gray-light)' }} /></label>
              <label className="block"><span className="text-xs" style={{ color: 'var(--gray)' }}>給与形態</span>
                <select value={editing.pay_type} onChange={e => setEditing({ ...editing, pay_type: e.target.value })} className="w-full px-3 py-2 rounded-lg border" style={{ borderColor: 'var(--gray-light)' }}>
                  <option value="hourly">時給</option><option value="monthly">月給</option>
                </select></label>
              {editing.pay_type === 'hourly'
                ? <label className="block"><span className="text-xs" style={{ color: 'var(--gray)' }}>時給（円）</span>
                    <input type="number" value={editing.hourly_rate ?? ''} onChange={e => setEditing({ ...editing, hourly_rate: e.target.value === '' ? null : Number(e.target.value) })} className="w-full px-3 py-2 rounded-lg border" style={{ borderColor: 'var(--gray-light)' }} /></label>
                : <>
                    <label className="block"><span className="text-xs" style={{ color: 'var(--gray)' }}>月額固定給（円）</span>
                      <input type="number" value={editing.monthly_salary ?? ''} onChange={e => setEditing({ ...editing, monthly_salary: e.target.value === '' ? null : Number(e.target.value) })} className="w-full px-3 py-2 rounded-lg border" style={{ borderColor: 'var(--gray-light)' }} /></label>
                    <label className="block"><span className="text-xs" style={{ color: 'var(--gray)' }}>固定残業手当（円・みなし）</span>
                      <input type="number" value={editing.fixed_overtime} onChange={e => setEditing({ ...editing, fixed_overtime: Number(e.target.value) || 0 })} className="w-full px-3 py-2 rounded-lg border" style={{ borderColor: 'var(--gray-light)' }} /></label>
                  </>}
              <label className="block"><span className="text-xs" style={{ color: 'var(--gray)' }}>通勤手当・往復額/日（円・空欄=未取得）</span>
                <input type="number" value={editing.commute_round_trip ?? ''} onChange={e => setEditing({ ...editing, commute_round_trip: e.target.value === '' ? null : Number(e.target.value) })} className="w-full px-3 py-2 rounded-lg border" style={{ borderColor: 'var(--gray-light)' }} /></label>
              <label className="block"><span className="text-xs" style={{ color: 'var(--gray)' }}>備考</span>
                <input type="text" value={editing.note ?? ''} onChange={e => setEditing({ ...editing, note: e.target.value })} className="w-full px-3 py-2 rounded-lg border" style={{ borderColor: 'var(--gray-light)' }} /></label>
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={save} className="btn-gold flex-1 py-2 rounded-lg text-sm">保存</button>
              <button onClick={() => setEditing(null)} className="btn-outline flex-1 py-2 rounded-lg text-sm">キャンセル</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
