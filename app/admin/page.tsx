'use client'

import { useEffect, useState, useCallback, Fragment } from 'react'
import { useRouter } from 'next/navigation'
import { supabase, Profile, Attendance, Message, Shift } from '@/lib/supabase'
import ShiftCalendar, { shiftTimeLabel } from '@/components/ShiftCalendar'

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
  const [tab, setTab] = useState<'attendance' | 'shift' | 'staff' | 'messages' | 'payroll' | 'expense'>('attendance')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [payroll, setPayroll] = useState<any>(null)
  const [payrollLoading, setPayrollLoading] = useState(false)
  const [payrollOpen, setPayrollOpen] = useState<Set<string>>(new Set())
  const togglePayroll = (id: string) => setPayrollOpen(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const [payrollTarget, setPayrollTarget] = useState('summary')  // 'summary' or user_id
  // 経費（交通費申請）
  type AdminExpense = {
    id: string; user_id: string; name: string; date: string; amount: number; category: string
    from_place: string | null; to_place: string | null; transport: string | null; purpose: string | null
    receipt_url: string | null; status: string; reject_reason: string | null
  }
  const [expenses, setExpenses] = useState<AdminExpense[]>([])
  const [expLoading, setExpLoading] = useState(false)
  const [expPending, setExpPending] = useState(0)

  const fmtD = (d: string) => new Date(d).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric', weekday: 'short' })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const summaryRows = (): (string | number)[][] => {
    const rows: (string | number)[][] = [['先生', '雇用(対象外)', '委託(税込)', '内消費税', '交通費(実費)', '総合計']]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const r of payroll.results) rows.push([r.name, r.employTotal, r.contractTotal, r.contractTax, r.transport ?? 0, r.total])
    rows.push(['合計', payroll.grand.employ, payroll.grand.contract, payroll.grand.tax, payroll.grand.transport ?? 0, payroll.grand.total])
    return rows
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const doctorRows = (r: any): (string | number)[][] => {
    const rows: (string | number)[][] = [[`${r.name} / ${payroll.month} / 稼働${r.daysCount}日${r.contractorName ? ' / 委託先:' + r.contractorName : ''}`], ['日付', '時間', '雇用(対象外)', '委託(税込)', '個別調整']]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const d of r.days) rows.push([fmtD(d.date), d.time, d.employ, d.contract, d.adj ? '有' : ''])
    if (r.allowance > 0) rows.push(['管理医師手当(委託)', '', '', r.allowance, ''])
    rows.push(['雇用 小計', '', r.employTotal, '', ''])
    rows.push(['委託 小計(税込)', '', '', r.contractTotal, ''])
    rows.push(['内消費税(委託)', '', '', r.contractTax, ''])
    if (r.transport > 0) rows.push(['交通費(実費)', '', '', r.transport, ''])
    rows.push(['総合計', '', '', '', r.total])
    if (r.note) rows.push([`別途・注意: ${r.note}`])
    return rows
  }
  const exportPayrollCSV = () => {
    if (!payroll?.results?.length) return
    if (payrollTarget === 'summary') downloadCSV(`報酬_サマリー_${selectedMonth}.csv`, summaryRows())
    else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r = payroll.results.find((x: any) => x.user_id === payrollTarget)
      if (r) downloadCSV(`報酬_${r.name}_${selectedMonth}.csv`, doctorRows(r))
    }
  }
  const printPayrollPDF = () => {
    if (!payroll?.results?.length) return
    const note = '<p style="color:#9A7B1F;font-size:11px;background:#FFF8E7;padding:8px 10px;border-radius:6px">※これは「見込み・試算」です。税務・課税区分の最終判断は顧問税理士の確認が前提です。</p>'
    const th = 'style="text-align:right;padding:6px 8px;border-bottom:1px solid #ddd;font-size:11px;color:#888"'
    const td = 'style="text-align:right;padding:6px 8px;border-bottom:1px solid #eee"'
    const tdl = 'style="text-align:left;padding:6px 8px;border-bottom:1px solid #eee"'
    let html = ''
    if (payrollTarget === 'summary') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const body = payroll.results.map((r: any) => `<tr><td ${tdl}>${r.name}</td><td ${td}>${r.employTotal.toLocaleString()}</td><td ${td}>${r.contractTotal.toLocaleString()}</td><td ${td}>${r.contractTax.toLocaleString()}</td><td ${td}>${(r.transport ?? 0).toLocaleString()}</td><td ${td}><b>${r.total.toLocaleString()}</b></td></tr>`).join('')
      html = `<h2>BiOLiS 報酬サマリー（${payroll.month}）</h2>${note}<table style="border-collapse:collapse;width:100%"><tr><th ${th.replace('right', 'left')}>先生</th><th ${th}>雇用(対象外)</th><th ${th}>委託(税込)</th><th ${th}>内消費税</th><th ${th}>交通費(実費)</th><th ${th}>総合計</th></tr>${body}<tr><td ${tdl}><b>合計</b></td><td ${td}><b>${payroll.grand.employ.toLocaleString()}</b></td><td ${td}><b>${payroll.grand.contract.toLocaleString()}</b></td><td ${td}>${payroll.grand.tax.toLocaleString()}</td><td ${td}>${(payroll.grand.transport ?? 0).toLocaleString()}</td><td ${td}><b>${payroll.grand.total.toLocaleString()}</b></td></tr></table>`
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r = payroll.results.find((x: any) => x.user_id === payrollTarget)
      if (!r) return
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const body = r.days.map((d: any) => `<tr><td ${tdl}>${fmtD(d.date)}</td><td ${tdl}>${d.time || ''}</td><td ${td}>${d.employ ? d.employ.toLocaleString() : ''}</td><td ${td}>${d.contract ? d.contract.toLocaleString() : ''}</td></tr>`).join('')
      const allowRow = r.allowance > 0 ? `<tr><td ${tdl} colspan="2">管理医師手当(委託)</td><td ${td}></td><td ${td}>${r.allowance.toLocaleString()}</td></tr>` : ''
      const transRow = r.transport > 0 ? `<tr><td ${tdl} colspan="3">交通費(実費)</td><td ${td}>${r.transport.toLocaleString()}</td></tr>` : ''
      html = `<h2>BiOLiS 報酬明細 — ${r.name}（${payroll.month}）</h2>${note}<p style="font-size:12px;color:#555">稼働${r.daysCount}日${r.contractorName ? ' ／ 委託先：' + r.contractorName : ''}</p><table style="border-collapse:collapse;width:100%"><tr><th ${th.replace('right', 'left')}>日付</th><th ${th.replace('right', 'left')}>時間</th><th ${th}>雇用(対象外)</th><th ${th}>委託(税込)</th></tr>${body}${allowRow}<tr><td ${tdl} colspan="2"><b>小計</b></td><td ${td}><b>${r.employTotal.toLocaleString()}</b></td><td ${td}><b>${r.contractTotal.toLocaleString()}</b></td></tr><tr><td ${tdl} colspan="3">内消費税(委託)</td><td ${td}>${r.contractTax.toLocaleString()}</td></tr>${transRow}<tr><td ${tdl} colspan="3"><b>総合計</b></td><td ${td}><b>${r.total.toLocaleString()}</b></td></tr></table>${r.note ? `<p style="color:#c00;font-size:11px">別途・注意：${r.note}</p>` : ''}`
    }
    const w = window.open('', '_blank')
    if (!w) return
    w.document.write(`<html><head><meta charset="utf-8"><title>報酬_${selectedMonth}</title><style>body{font-family:"Hiragino Sans",sans-serif;padding:24px;color:#1A1A2E}h2{font-size:18px}</style></head><body>${html}</body></html>`)
    w.document.close(); w.focus()
    setTimeout(() => w.print(), 300)
  }

  const fetchPayroll = useCallback(async (month: string) => {
    setPayrollLoading(true)
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch('/api/payroll', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token ?? ''}` },
      body: JSON.stringify({ month }),
    })
    const r = await res.json().catch(() => ({}))
    setPayroll(res.ok ? r : { error: r.error })
    setPayrollLoading(false)
  }, [])

  const fetchExpenses = useCallback(async (month: string) => {
    setExpLoading(true)
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch(`/api/expense?month=${month}`, { headers: { Authorization: `Bearer ${session?.access_token ?? ''}` } })
    const j = await res.json().catch(() => null)
    setExpenses(j?.ok ? (j.rows as AdminExpense[]) : [])
    setExpLoading(false)
  }, [])

  const fetchExpPending = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch('/api/expense?status=pending', { headers: { Authorization: `Bearer ${session?.access_token ?? ''}` } })
    const j = await res.json().catch(() => null)
    setExpPending(j?.ok ? (j.rows as AdminExpense[]).length : 0)
  }, [])

  const reviewExpense = async (id: string, action: 'approve' | 'reject') => {
    let reason: string | undefined
    if (action === 'reject') {
      const r = window.prompt('却下理由（任意・申請者に表示されます）', '')
      if (r === null) return // キャンセル
      reason = r
    }
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch('/api/expense/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token ?? ''}` },
      body: JSON.stringify({ id, action, reason }),
    })
    if (res.ok) { await fetchExpenses(selectedMonth); await fetchExpPending() }
  }

  const exportExpenseCSV = () => {
    if (!expenses.length) return
    const label = (s: string) => s === 'approved' ? '承認' : s === 'rejected' ? '却下' : '申請中'
    const rows: (string | number)[][] = [['申請者', '利用日', '金額', '費目', '出発', '到着', '交通手段', '目的', '状態']]
    for (const e of [...expenses].sort((a, b) => a.name.localeCompare(b.name, 'ja') || a.date.localeCompare(b.date))) {
      rows.push([e.name, e.date, e.amount, e.category, e.from_place ?? '', e.to_place ?? '', e.transport ?? '', e.purpose ?? '', label(e.status)])
    }
    const approved = expenses.filter(e => e.status === 'approved').reduce((s, e) => s + e.amount, 0)
    rows.push([])
    rows.push(['承認済み合計', '', approved, '', '', '', '', '', ''])
    downloadCSV(`交通費_${selectedMonth}.csv`, rows)
  }
  const [staffList, setStaffList] = useState<Profile[]>([])
  const [shiftStaffId, setShiftStaffId] = useState('')
  const [adminShifts, setAdminShifts] = useState<Shift[]>([])
  const [acceptMonth, setAcceptMonth] = useState('')
  const [deadlineInput, setDeadlineInput] = useState('')
  const [deadlineMsg, setDeadlineMsg] = useState('')
  const [acceptSaving, setAcceptSaving] = useState(false)

  const loadAcceptance = useCallback(async () => {
    const { data: s } = await supabase.from('app_settings').select('value').eq('key', 'shift_request_month').maybeSingle()
    const m = (s as { value?: string } | null)?.value ?? ''
    setAcceptMonth(m)
    if (m) {
      const { data } = await supabase.from('shift_deadlines').select('deadline').eq('month', m).maybeSingle()
      setDeadlineInput((data as { deadline?: string } | null)?.deadline ?? '')
    }
  }, [])
  const saveAcceptance = async () => {
    if (!acceptMonth) { setDeadlineMsg('受付月を選んでください'); return }
    setAcceptSaving(true); setDeadlineMsg('')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from('app_settings') as any).upsert({ key: 'shift_request_month', value: acceptMonth })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from('shift_deadlines') as any).upsert({ month: acceptMonth, deadline: deadlineInput || null })
    // 希望タブを生成（スタッフ一覧つき）
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch('/api/sync-shift-requests', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token ?? ''}` },
      body: JSON.stringify({ month: acceptMonth }),
    })
    const r = await res.json().catch(() => ({}))
    setDeadlineMsg(res.ok ? `受付月=${acceptMonth.replace('-', '年')}月・締切${deadlineInput || '未設定'}で設定。希望タブ「${r.tab}」を用意しました` : `設定は保存しましたがタブ生成に失敗：${r.error ?? ''}`)
    setAcceptSaving(false)
  }
  const [importing, setImporting] = useState(false)
  const [importMsg, setImportMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null)

  const handleImportShifts = async () => {
    if (!window.confirm(`${selectedMonth.replace('-', '年')}月のシフトを、スプレッドシートの内容で取り込みます。\n（アプリ側のその月のシフトは上書きされます）\n実行しますか？`)) return
    setImporting(true); setImportMsg(null)
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch('/api/import-shifts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token ?? ''}` },
      body: JSON.stringify({ month: selectedMonth }),
    })
    const r = await res.json().catch(() => ({}))
    if (res.ok) {
      const skip = r.skipped?.length ? `／未登録でスキップ: ${r.skipped.join('、')}` : ''
      setImportMsg({ text: `取り込み完了：${r.updated?.length ?? 0}名・${r.count}件を反映${skip}`, type: 'success' })
      if (shiftStaffId) await reloadShifts()
    } else {
      setImportMsg({ text: r.error ?? '取り込みに失敗しました', type: 'error' })
    }
    setImporting(false)
  }

  const [editShiftId, setEditShiftId] = useState<string | null>(null)
  const [editShift, setEditShift] = useState<{ kind: string; start: string; end: string; note: string }>({ kind: 'work', start: '', end: '', note: '' })
  const [newShift, setNewShift] = useState<{ day: string; kind: string; start: string; end: string; note: string }>({ day: '', kind: 'work', start: '', end: '', note: '' })

  const reloadShifts = async () => {
    if (!shiftStaffId) return
    const [year, mon] = selectedMonth.split('-').map(Number)
    const start = `${year}-${String(mon).padStart(2, '0')}-01`
    const end = `${year}-${String(mon).padStart(2, '0')}-${new Date(year, mon, 0).getDate()}`
    const { data } = await supabase.from('shifts').select('*').eq('user_id', shiftStaffId).gte('date', start).lte('date', end)
    setAdminShifts((data as Shift[]) ?? [])
  }

  const saveShiftEdit = async (s: Shift) => {
    const isOff = editShift.kind === 'off'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from('shifts') as any).update({
      kind: editShift.kind,
      start_time: isOff ? null : (editShift.start || null),
      end_time: isOff ? null : (editShift.end || null),
      note: editShift.note || null,
    }).eq('id', s.id)
    setEditShiftId(null)
    await reloadShifts()
  }

  const deleteShift = async (id: string) => {
    if (!window.confirm('このシフトを削除しますか？')) return
    await supabase.from('shifts').delete().eq('id', id)
    await reloadShifts()
  }

  const addShift = async () => {
    if (!shiftStaffId || !newShift.day) { alert('日付を選んでください'); return }
    const isOff = newShift.kind === 'off'
    const date = `${selectedMonth}-${String(newShift.day).padStart(2, '0')}`
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from('shifts') as any).upsert({
      user_id: shiftStaffId, date,
      kind: newShift.kind,
      start_time: isOff ? null : (newShift.start || null),
      end_time: isOff ? null : (newShift.end || null),
      note: newShift.note || null,
      status: '確定',
    }, { onConflict: 'user_id,date' })
    if (error) { alert('追加に失敗しました: ' + error.message); return }
    setNewShift({ day: '', kind: 'work', start: '', end: '', note: '' })
    await reloadShifts()
  }
  const [invRoles, setInvRoles] = useState<Record<string, string>>({})
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
    // 在庫アプリのロールも取得（userId → role のマップ）
    const { data: inv } = await supabase.from('inventory_roles').select('id, role')
    if (inv) {
      const map: Record<string, string> = {}
      for (const r of inv as { id: string; role: string }[]) map[r.id] = r.role
      setInvRoles(map)
    }
  }, [])

  const handleSetInventoryRole = async (s: Profile, role: string) => {
    setInvRoles(prev => ({ ...prev, [s.id]: role }))  // 楽観的更新
    const res = await fetch('/api/set-inventory-role', {
      method: 'POST', headers: await authHeader(),
      body: JSON.stringify({ userId: s.id, role }),
    })
    if (!res.ok) {
      const r = await res.json().catch(() => ({}))
      alert(`失敗: ${r.error ?? '不明なエラー'}`)
      await fetchStaff()  // 失敗時は再取得して戻す
    }
  }

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

  const handleRenameStaff = async (s: Profile) => {
    const name = window.prompt(`${s.name} さんの新しい氏名を入力してください`, s.name)
    if (name === null) return
    if (!name.trim()) { alert('氏名を入力してください'); return }
    const res = await fetch('/api/update-staff', {
      method: 'POST', headers: await authHeader(),
      body: JSON.stringify({ userId: s.id, name: name.trim() }),
    })
    const r = await res.json().catch(() => ({}))
    if (res.ok) await fetchStaff()
    else alert(`失敗: ${r.error ?? '不明なエラー'}`)
  }

  const handleChangeRole = async (s: Profile, role: string) => {
    const label = role === 'admin' ? '管理者' : 'スタッフ'
    if (!window.confirm(`${s.name} さんの権限を「${label}」に変更します。よろしいですか？`)) return
    const res = await fetch('/api/update-staff', {
      method: 'POST', headers: await authHeader(),
      body: JSON.stringify({ userId: s.id, role }),
    })
    const r = await res.json().catch(() => ({}))
    if (res.ok) await fetchStaff()
    else alert(`失敗: ${r.error ?? '不明なエラー'}`)
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

    // 最初の打刻時刻(実時刻)で昇順ソート。日付は正しい時系列順になり、
    // 同じ日の中は「その日に最初に打刻した順」を維持する。
    // ※以前は日付を文字列比較していたため 7/10〜7/19 が 7/2 より前に来るズレがあった。
    setSummaries(Array.from(map.values()).sort(
      (a, b) => new Date(a.records[0].timestamp).getTime() - new Date(b.records[0].timestamp).getTime()
    ))
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

  useEffect(() => {
    if (!shiftStaffId) { setAdminShifts([]); return }
    let active = true
    const run = async () => {
      const [year, mon] = selectedMonth.split('-').map(Number)
      const start = `${year}-${String(mon).padStart(2, '0')}-01`
      const end = `${year}-${String(mon).padStart(2, '0')}-${new Date(year, mon, 0).getDate()}`
      const { data } = await supabase
        .from('shifts').select('*').eq('user_id', shiftStaffId).gte('date', start).lte('date', end)
      if (active) setAdminShifts((data as Shift[]) ?? [])
    }
    run()
    return () => { active = false }
  }, [shiftStaffId, selectedMonth])

  useEffect(() => {
    if (tab === 'payroll') fetchPayroll(selectedMonth)
    if (tab === 'expense') fetchExpenses(selectedMonth)
  }, [tab, selectedMonth, fetchPayroll, fetchExpenses])

  useEffect(() => {
    if (tab === 'shift') loadAcceptance()
  }, [tab, loadAcceptance])

  useEffect(() => { fetchExpPending() }, [fetchExpPending])

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
            ['shift', 'シフト'],
            ['payroll', '報酬'],
            ['expense', '経費'],
            ['staff', 'スタッフ管理'],
            ['messages', '連絡'],
          ] as const).map(([key, label]) => {
            const unresolved = key === 'messages' ? messages.filter(m => !m.resolved).length : key === 'expense' ? expPending : 0
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

        {/* 報酬（管理者のみ・サーバー計算） */}
        {tab === 'payroll' && (
        <div className="card p-5">
          <div className="flex flex-col sm:flex-row gap-3 sm:items-center mb-3">
            <div className="text-xs tracking-[0.2em] flex-1" style={{ color: 'var(--gray)' }}>PAYROLL — 報酬（医師報酬の試算）</div>
            <input type="month" value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)}
              className="px-3 py-2 rounded-lg text-sm border focus:outline-none" style={{ borderColor: 'var(--gray-light)', background: 'var(--off-white)', color: 'var(--navy)' }} />
          </div>
          <div className="text-xs rounded-lg px-3 py-2 mb-4" style={{ background: '#FFF8E7', color: '#9A7B1F' }}>
            ※これは「見込み・試算」です。税務・課税区分の最終判断は顧問税理士の確認が前提です。委託分は税込・内消費税10%を割り戻して表示しています。
          </div>
          {payroll?.results?.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap mb-4">
              <span className="text-xs" style={{ color: 'var(--gray)' }}>出力対象：</span>
              <select value={payrollTarget} onChange={e => setPayrollTarget(e.target.value)}
                className="px-3 py-2 rounded-lg text-sm border focus:outline-none" style={{ borderColor: 'var(--gray-light)', background: 'var(--off-white)', color: 'var(--navy)' }}>
                <option value="summary">全体（サマリー）</option>
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                {payroll.results.map((r: any) => <option key={r.user_id} value={r.user_id}>{r.name}（明細）</option>)}
              </select>
              <button onClick={exportPayrollCSV} className="btn-outline text-sm px-4 py-2 rounded-lg">CSVダウンロード</button>
              <button onClick={printPayrollPDF} className="btn-gold text-sm px-4 py-2 rounded-lg">PDF（印刷）</button>
            </div>
          )}
          {payrollLoading ? (
            <p className="text-sm text-center py-6" style={{ color: 'var(--gray)' }}>計算中...</p>
          ) : payroll?.error ? (
            <p className="text-sm text-center py-6 text-red-500">{payroll.error}</p>
          ) : !payroll?.results?.length ? (
            <p className="text-sm text-center py-6" style={{ color: 'var(--gray)' }}>この月の対象データがありません</p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs tracking-wider" style={{ color: 'var(--gray)' }}>
                      <th className="text-left pb-2 font-normal">先生</th>
                      <th className="text-right pb-2 font-normal">雇用(対象外)</th>
                      <th className="text-right pb-2 font-normal">委託(税込)</th>
                      <th className="text-right pb-2 font-normal">内消費税</th>
                      <th className="text-right pb-2 font-normal">交通費</th>
                      <th className="text-right pb-2 font-normal">総合計</th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                    {payroll.results.map((r: any) => (
                      <Fragment key={r.user_id}>
                        <tr onClick={() => togglePayroll(r.user_id)} className="border-t border-gray-50 cursor-pointer hover:bg-amber-50/40">
                          <td className="py-2.5 font-medium" style={{ color: 'var(--navy)' }}>
                            <span className="inline-block w-3" style={{ color: 'var(--gold)' }}>{payrollOpen.has(r.user_id) ? '▾' : '▸'}</span>{r.name}
                          </td>
                          <td className="py-2.5 text-right" style={{ color: 'var(--navy)' }}>{r.employTotal.toLocaleString()}</td>
                          <td className="py-2.5 text-right" style={{ color: 'var(--navy)' }}>{r.contractTotal.toLocaleString()}</td>
                          <td className="py-2.5 text-right text-xs" style={{ color: 'var(--gray)' }}>{r.contractTax.toLocaleString()}</td>
                          <td className="py-2.5 text-right text-xs" style={{ color: (r.transport ?? 0) > 0 ? 'var(--navy)' : 'var(--gray)' }}>{(r.transport ?? 0).toLocaleString()}</td>
                          <td className="py-2.5 text-right font-medium" style={{ color: 'var(--gold)' }}>{r.total.toLocaleString()}</td>
                        </tr>
                        {payrollOpen.has(r.user_id) && (
                          <tr><td colSpan={6} className="px-4 py-3 bg-amber-50/40">
                            <div className="text-xs mb-2" style={{ color: 'var(--gray)' }}>
                              根拠（{r.name} ／ {payroll.month} ／ 稼働{r.daysCount}日{r.allowance > 0 ? ` ／ 手当 ${r.allowance.toLocaleString()}円` : ''}）
                              {r.contractorName && <span> ／ 委託先：{r.contractorName}</span>}
                            </div>
                            <div className="space-y-1">
                              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                              {r.days.map((d: any, i: number) => (
                                <div key={i} className="flex items-center gap-3 text-xs">
                                  <span className="w-16" style={{ color: 'var(--gray)' }}>{new Date(d.date).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric', weekday: 'short' })}</span>
                                  {d.time && <span style={{ color: 'var(--gray)' }}>{d.time}</span>}
                                  {d.employ > 0 && <span style={{ color: 'var(--navy)' }}>雇用 {d.employ.toLocaleString()}</span>}
                                  {d.contract > 0 && <span style={{ color: 'var(--navy)' }}>委託 {d.contract.toLocaleString()}</span>}
                                  {d.adj && <span style={{ color: '#B8932F' }}>（個別調整）</span>}
                                </div>
                              ))}
                              {r.allowance > 0 && (
                                <div className="flex items-center gap-3 text-xs">
                                  <span className="w-16" style={{ color: 'var(--gray)' }}>手当</span>
                                  <span style={{ color: 'var(--navy)' }}>委託 {r.allowance.toLocaleString()}（管理医師手当）</span>
                                </div>
                              )}
                              {r.transport > 0 && (
                                <div className="flex items-center gap-3 text-xs">
                                  <span className="w-16" style={{ color: 'var(--gray)' }}>交通費</span>
                                  <span style={{ color: 'var(--navy)' }}>実費 {r.transport.toLocaleString()}（承認済み交通費の合計）</span>
                                </div>
                              )}
                            </div>
                            {r.note && <div className="text-xs mt-2" style={{ color: '#EF4444' }}>別途・注意：{r.note}</div>}
                          </td></tr>
                        )}
                      </Fragment>
                    ))}
                    <tr className="border-t-2" style={{ borderColor: 'var(--gold)' }}>
                      <td className="py-2.5 font-bold" style={{ color: 'var(--navy)' }}>合計</td>
                      <td className="py-2.5 text-right font-medium" style={{ color: 'var(--navy)' }}>{payroll.grand.employ.toLocaleString()}</td>
                      <td className="py-2.5 text-right font-medium" style={{ color: 'var(--navy)' }}>{payroll.grand.contract.toLocaleString()}</td>
                      <td className="py-2.5 text-right text-xs" style={{ color: 'var(--gray)' }}>{payroll.grand.tax.toLocaleString()}</td>
                      <td className="py-2.5 text-right font-medium" style={{ color: 'var(--navy)' }}>{(payroll.grand.transport ?? 0).toLocaleString()}</td>
                      <td className="py-2.5 text-right font-bold" style={{ color: 'var(--gold)' }}>{payroll.grand.total.toLocaleString()}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div className="text-xs mt-3" style={{ color: 'var(--gray)' }}>各行をタップすると、日ごとの根拠が開きます。鑓水先生の夜間歩合・今井先生の手術10%などは「別途」（データ待ち）です。</div>
            </>
          )}
        </div>
        )}

        {/* 経費（交通費申請） */}
        {tab === 'expense' && (
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            <div className="text-xs tracking-[0.2em] flex-1" style={{ color: 'var(--gray)' }}>EXPENSE — 交通費申請</div>
            <input type="month" value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)}
              className="px-2 py-1 rounded-lg text-xs border focus:outline-none"
              style={{ borderColor: 'var(--gray-light)', background: 'var(--off-white)', color: 'var(--navy)' }} />
            <button onClick={exportExpenseCSV} disabled={!expenses.length}
              className="btn-outline text-xs px-3 py-1.5 rounded-lg tracking-wider disabled:opacity-40">CSV</button>
          </div>

          {expLoading ? (
            <p className="text-sm text-center py-6" style={{ color: 'var(--gray)' }}>読み込み中...</p>
          ) : expenses.length === 0 ? (
            <p className="text-sm text-center py-6" style={{ color: 'var(--gray)' }}>{selectedMonth.replace('-', '年')}月の申請はありません</p>
          ) : (
            <>
              {(() => {
                const approvedTotal = expenses.filter(e => e.status === 'approved').reduce((s, e) => s + e.amount, 0)
                const pendingCount = expenses.filter(e => e.status === 'pending').length
                return (
                  <div className="flex gap-4 mb-4 text-sm">
                    <div><span className="text-xs" style={{ color: 'var(--gray)' }}>承認済み合計 </span><b style={{ color: 'var(--navy)' }}>{approvedTotal.toLocaleString()}円</b></div>
                    {pendingCount > 0 && <div><span className="text-xs" style={{ color: 'var(--gray)' }}>未承認 </span><b style={{ color: '#B45309' }}>{pendingCount}件</b></div>}
                  </div>
                )
              })()}
              {(() => {
                const groups = new Map<string, AdminExpense[]>()
                for (const e of expenses) { const a = groups.get(e.user_id) ?? []; a.push(e); groups.set(e.user_id, a) }
                const entries = [...groups.entries()].sort((a, b) => a[1][0].name.localeCompare(b[1][0].name, 'ja'))
                return entries.map(([uid, list]) => {
                  const approved = list.filter(e => e.status === 'approved').reduce((s, e) => s + e.amount, 0)
                  return (
                    <div key={uid} className="mb-4">
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="text-sm font-semibold" style={{ color: 'var(--navy)' }}>{list[0].name}</div>
                        <div className="text-xs" style={{ color: 'var(--gold)' }}>承認済み {approved.toLocaleString()}円</div>
                      </div>
                      <div className="space-y-1.5">
                        {[...list].sort((a, b) => a.date.localeCompare(b.date)).map(e => (
                          <div key={e.id} className="rounded-lg px-3 py-2" style={{ background: 'var(--off-white)' }}>
                            <div className="flex items-center gap-2 text-sm">
                              <span className="text-xs w-12 shrink-0" style={{ color: 'var(--gray)' }}>{fmtD(e.date)}</span>
                              <span className="shrink-0" style={{ color: 'var(--navy)' }}>{e.amount.toLocaleString()}円</span>
                              <span className="flex-1 min-w-0 truncate text-xs" style={{ color: 'var(--gray)' }}>
                                {e.transport ?? ''}{e.from_place ? ` ${e.from_place}→${e.to_place ?? ''}` : ''}{e.purpose ? `／${e.purpose}` : ''}
                              </span>
                              {e.receipt_url && <a href={e.receipt_url} target="_blank" rel="noopener noreferrer" className="text-xs shrink-0" style={{ color: 'var(--gold)' }}>📷領収書</a>}
                              <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${e.status === 'approved' ? 'bg-emerald-100 text-emerald-700' : e.status === 'rejected' ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-700'}`}>
                                {e.status === 'approved' ? '承認' : e.status === 'rejected' ? '却下' : '申請中'}
                              </span>
                            </div>
                            {e.status === 'rejected' && e.reject_reason && (
                              <div className="text-xs mt-1" style={{ color: '#EF4444' }}>却下理由：{e.reject_reason}</div>
                            )}
                            {e.status === 'pending' && (
                              <div className="flex gap-2 mt-2">
                                <button onClick={() => reviewExpense(e.id, 'approve')}
                                  className="text-xs px-3 py-1 rounded-lg bg-emerald-600 text-white tracking-wider">承認</button>
                                <button onClick={() => reviewExpense(e.id, 'reject')}
                                  className="text-xs px-3 py-1 rounded-lg border tracking-wider" style={{ borderColor: 'var(--gray-light)', color: '#EF4444' }}>却下</button>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })
              })()}
              <div className="text-xs mt-2" style={{ color: 'var(--gray)' }}>承認した交通費は、その月の「報酬」明細に「交通費(実費)」として合算されます。</div>
            </>
          )}
        </div>
        )}

        {/* シフト */}
        {tab === 'shift' && (
        <div className="card p-5">
          <div className="flex flex-col sm:flex-row gap-3 sm:items-center mb-4">
            <div className="text-xs tracking-[0.2em] flex-1" style={{ color: 'var(--gray)' }}>
              SHIFT — シフト表
            </div>
            <select
              value={shiftStaffId}
              onChange={e => setShiftStaffId(e.target.value)}
              className="px-3 py-2 rounded-lg text-sm border focus:outline-none"
              style={{ borderColor: 'var(--gray-light)', background: 'var(--off-white)', color: 'var(--navy)' }}
            >
              <option value="">スタッフを選択</option>
              {staffList.map(s => <option key={s.id} value={s.id}>{staffLabel(s)}</option>)}
            </select>
            <input
              type="month"
              value={selectedMonth}
              onChange={e => setSelectedMonth(e.target.value)}
              className="px-3 py-2 rounded-lg text-sm border focus:outline-none"
              style={{ borderColor: 'var(--gray-light)', background: 'var(--off-white)', color: 'var(--navy)' }}
            />
            <button
              onClick={handleImportShifts}
              disabled={importing}
              className="btn-gold text-sm px-4 py-2 rounded-lg whitespace-nowrap"
            >
              {importing ? '取り込み中...' : 'スプレッドシートから取り込み'}
            </button>
          </div>
          {importMsg && (
            <div className={`mb-4 text-sm rounded-lg px-3 py-2 ${importMsg.type === 'success' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
              {importMsg.text}
            </div>
          )}
          <div className="mb-4 p-3 rounded-lg" style={{ background: 'var(--off-white)' }}>
            <div className="text-xs mb-2" style={{ color: 'var(--gray)' }}>シフト希望の受付設定（この月がスタッフの提出対象になります）</div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs" style={{ color: 'var(--gray)' }}>受付月</span>
              <input type="month" value={acceptMonth} onChange={e => setAcceptMonth(e.target.value)}
                className="px-2 py-1 rounded border text-xs" style={{ borderColor: 'var(--gray-light)' }} />
              <span className="text-xs" style={{ color: 'var(--gray)' }}>締切</span>
              <input type="date" value={deadlineInput} onChange={e => setDeadlineInput(e.target.value)}
                className="px-2 py-1 rounded border text-xs" style={{ borderColor: 'var(--gray-light)' }} />
              <button onClick={saveAcceptance} disabled={acceptSaving} className="btn-gold text-xs px-4 py-1.5 rounded-full">{acceptSaving ? '設定中...' : '受付を設定＆希望タブ生成'}</button>
            </div>
            {deadlineMsg && <div className="text-xs mt-2" style={{ color: 'var(--gray)' }}>{deadlineMsg}</div>}
          </div>
          {!shiftStaffId ? (
            <p className="text-sm text-center py-6" style={{ color: 'var(--gray)' }}>スタッフを選ぶと、その人のシフトが表示されます</p>
          ) : (
            <>
              {adminShifts.length > 0 && (
                <ShiftCalendar year={Number(selectedMonth.split('-')[0])} month={Number(selectedMonth.split('-')[1])} shifts={adminShifts} />
              )}

              {/* 一覧（編集可） */}
              <div className="divider-gold mt-5"></div>
              <div className="text-xs tracking-wider mt-3 mb-2" style={{ color: 'var(--gray)' }}>一覧・編集</div>
              <div className="space-y-1">
                {[...adminShifts].sort((a, b) => a.date.localeCompare(b.date)).map(s => (
                  <div key={s.id} className="text-sm py-2 border-b border-gray-50">
                    {editShiftId === s.id ? (
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs w-16" style={{ color: 'var(--gray)' }}>{new Date(s.date).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' })}</span>
                        <select value={editShift.kind} onChange={e => setEditShift({ ...editShift, kind: e.target.value })}
                          className="px-2 py-1 rounded border text-xs" style={{ borderColor: 'var(--gray-light)' }}>
                          <option value="work">出勤</option><option value="off">休み</option><option value="paid">有給</option>
                        </select>
                        {editShift.kind !== 'off' && (<>
                          <input type="time" value={editShift.start} onChange={e => setEditShift({ ...editShift, start: e.target.value })} className="px-2 py-1 rounded border text-xs" style={{ borderColor: 'var(--gray-light)' }} />
                          <span className="text-xs">〜</span>
                          <input type="time" value={editShift.end} onChange={e => setEditShift({ ...editShift, end: e.target.value })} className="px-2 py-1 rounded border text-xs" style={{ borderColor: 'var(--gray-light)' }} />
                        </>)}
                        <input type="text" value={editShift.note} placeholder="備考" onChange={e => setEditShift({ ...editShift, note: e.target.value })} className="px-2 py-1 rounded border text-xs flex-1 min-w-20" style={{ borderColor: 'var(--gray-light)' }} />
                        <button onClick={() => saveShiftEdit(s)} className="btn-gold text-xs px-3 py-1 rounded-full">保存</button>
                        <button onClick={() => setEditShiftId(null)} className="text-xs px-3 py-1 rounded-full bg-slate-100 text-slate-600">取消</button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="text-xs w-16" style={{ color: 'var(--gray)' }}>{new Date(s.date).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric', weekday: 'short' })}</span>
                        <span className="flex-1" style={{ color: s.kind === 'off' ? 'var(--gray)' : 'var(--navy)' }}>{shiftTimeLabel(s)}</span>
                        {s.note && <span className="text-xs" style={{ color: 'var(--gray)' }}>{s.note}</span>}
                        <button onClick={() => { setEditShiftId(s.id); setEditShift({ kind: s.kind, start: s.start_time ?? '', end: s.end_time ?? '', note: s.note ?? '' }) }}
                          className="text-xs px-2 py-0.5 rounded-full border hover:bg-white transition" style={{ borderColor: 'var(--gray-light)', color: 'var(--gray)' }}>編集</button>
                        <button onClick={() => deleteShift(s.id)} className="text-xs px-2 py-0.5 rounded-full border border-red-200 text-red-500 hover:bg-red-50 transition">削除</button>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* シフトを追加 */}
              <div className="mt-4 p-3 rounded-lg" style={{ background: 'var(--off-white)' }}>
                <div className="text-xs mb-2" style={{ color: 'var(--gray)' }}>シフトを追加・上書き（{selectedMonth.replace('-', '年')}月）</div>
                <div className="flex items-center gap-2 flex-wrap">
                  <select value={newShift.day} onChange={e => setNewShift({ ...newShift, day: e.target.value })} className="px-2 py-1 rounded border text-xs" style={{ borderColor: 'var(--gray-light)' }}>
                    <option value="">日</option>
                    {Array.from({ length: new Date(Number(selectedMonth.split('-')[0]), Number(selectedMonth.split('-')[1]), 0).getDate() }, (_, i) => i + 1).map(d => <option key={d} value={d}>{d}日</option>)}
                  </select>
                  <select value={newShift.kind} onChange={e => setNewShift({ ...newShift, kind: e.target.value })} className="px-2 py-1 rounded border text-xs" style={{ borderColor: 'var(--gray-light)' }}>
                    <option value="work">出勤</option><option value="off">休み</option><option value="paid">有給</option>
                  </select>
                  {newShift.kind !== 'off' && (<>
                    <input type="time" value={newShift.start} onChange={e => setNewShift({ ...newShift, start: e.target.value })} className="px-2 py-1 rounded border text-xs" style={{ borderColor: 'var(--gray-light)' }} />
                    <span className="text-xs">〜</span>
                    <input type="time" value={newShift.end} onChange={e => setNewShift({ ...newShift, end: e.target.value })} className="px-2 py-1 rounded border text-xs" style={{ borderColor: 'var(--gray-light)' }} />
                  </>)}
                  <input type="text" value={newShift.note} placeholder="備考" onChange={e => setNewShift({ ...newShift, note: e.target.value })} className="px-2 py-1 rounded border text-xs" style={{ borderColor: 'var(--gray-light)' }} />
                  <button onClick={addShift} className="btn-gold text-xs px-4 py-1.5 rounded-full">追加</button>
                </div>
              </div>
            </>
          )}
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
                    <button
                      onClick={() => handleRenameStaff(s)}
                      className="text-xs px-2 py-0.5 rounded-full border hover:bg-white transition"
                      style={{ borderColor: 'var(--gray-light)', color: 'var(--gray)' }}
                    >
                      名前変更
                    </button>
                    <div className="flex items-center gap-1">
                      <span className="text-xs" style={{ color: 'var(--gray)' }}>権限</span>
                      {s.id === profile.id ? (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">管理者（自分）</span>
                      ) : (
                        <select
                          value={s.role}
                          onChange={e => handleChangeRole(s, e.target.value)}
                          className="text-xs px-2 py-1 rounded-full border bg-white"
                          style={{ borderColor: 'var(--gray-light)', color: 'var(--navy)' }}
                        >
                          <option value="staff">スタッフ</option>
                          <option value="admin">管理者</option>
                        </select>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1">
                      <span className="text-xs" style={{ color: 'var(--gray)' }}>在庫</span>
                      <select
                        value={invRoles[s.id] ?? ''}
                        onChange={e => handleSetInventoryRole(s, e.target.value)}
                        className="text-xs px-2 py-1 rounded-full border bg-white"
                        style={{ borderColor: 'var(--gray-light)', color: 'var(--navy)' }}
                      >
                        <option value="">なし</option>
                        <option value="staff">スタッフ</option>
                        <option value="orderer">発注担当</option>
                        <option value="admin">管理者</option>
                      </select>
                    </div>
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
            パスワードを忘れたスタッフには「パスワード再設定」で新しいパスワードを設定し、本人に伝えてください。<br />
            「在庫」欄で在庫管理アプリの権限を設定できます（なし＝在庫アプリを使えない / スタッフ・発注担当・管理者）。勤怠の権限とは別に付与されます。
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
