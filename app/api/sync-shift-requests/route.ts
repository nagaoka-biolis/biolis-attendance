import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/server-admin'
import { writeShiftGrid, readSheetValues } from '@/lib/google-sheets'

export const runtime = 'nodejs'

type Req = { user_id: string; date: string; kind: string; start_time: string | null; end_time: string | null }
const WK = ['日', '月', '火', '水', '木', '金', '土']
const HEADERS = new Set(['Dr', 'Ns', 'UK', 'ABLNS', 'ABLUK'])
const CATLABEL: Record<string, string> = { Dr: 'Dr', Ns: 'Ns', UK: 'UK', ABLNS: 'ABL NS', ABLUK: 'ABL UK' }
const nk = (s: string) => (s || '').replace('Dr.', '').replace(/　/g, '').replace(/ /g, '').replace('⼀', '一').trim()

export async function POST(req: NextRequest) {
  const auth = await requireUser(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const admin = auth.admin

  const body = await req.json().catch(() => null)
  const month = String(body?.month ?? '')
  const mm = month.match(/^(\d{4})-(\d{2})$/)
  if (!mm) return NextResponse.json({ error: '月の指定が不正です' }, { status: 400 })
  const year = Number(mm[1]); const mon = Number(mm[2])
  const start = `${year}-${String(mon).padStart(2, '0')}-01`
  const days = new Date(year, mon, 0).getDate()
  const end = `${year}-${String(mon).padStart(2, '0')}-${String(days).padStart(2, '0')}`

  const { data: profs } = await admin.from('profiles').select('id,name,role').eq('role', 'staff').order('created_at')
  const staff = (profs ?? []) as { id: string; name: string }[]
  const normId = new Map<string, string>(staff.map(p => [nk(p.name), p.id]))
  const { data: reqs } = await admin.from('shift_requests').select('user_id,date,kind,start_time,end_time').gte('date', start).lte('date', end)
  const byUser = new Map<string, Map<number, string>>()
  for (const r of (reqs ?? []) as Req[]) {
    const d = new Date(r.date).getDate()
    const label = r.kind === 'off' ? '休み希望' : r.kind === 'undecided' ? '未定'
      : (r.start_time ? (r.end_time ? `${r.start_time}-${r.end_time}` : `${r.start_time}-`) : '勤務希望')
    if (!byUser.has(r.user_id)) byUser.set(r.user_id, new Map())
    byUser.get(r.user_id)!.set(d, label)
  }

  // 確定タブから 区分/名前 の並びを読む（同じグルーピングにする）
  const sections: { label: string; people: { name: string; info: string; id?: string }[] }[] = []
  const seen = new Set<string>()
  try {
    const ref = await readSheetValues(`${year}年${mon}月`)
    let cur: { label: string; people: { name: string; info: string; id?: string }[] } | null = null
    for (let i = 4; i < ref.length; i++) {
      const a = (ref[i]?.[0] ?? '').toString()
      const b = (ref[i]?.[1] ?? '').toString()
      if (!a) continue
      const k = nk(a)
      if (HEADERS.has(k)) { cur = { label: CATLABEL[k], people: [] }; sections.push(cur); continue }
      if (!cur) continue
      cur.people.push({ name: a, info: b, id: normId.get(nk(a)) })
      seen.add(nk(a))
    }
  } catch { /* 確定タブが無ければ後段でフラット */ }
  // 確定タブに居ない登録スタッフ
  const others = staff.filter(p => !seen.has(nk(p.name))).map(p => ({ name: p.name, info: '', id: p.id }))
  if (others.length) sections.push({ label: 'その他', people: others })
  if (sections.length === 0) sections.push({ label: '全スタッフ', people: staff.map(p => ({ name: p.name, info: '', id: p.id })) })

  // グリッド生成
  const dayNums: (string | number)[] = ['区分/名前', '基本情報', ...Array.from({ length: days }, (_, i) => i + 1)]
  const weekdays: (string | number)[] = ['', '', ...Array.from({ length: days }, (_, i) => WK[new Date(year, mon - 1, i + 1).getDay()])]
  const values: (string | number)[][] = [[`${year}年 ${mon}月 シフト希望（アプリ提出・自動反映）`], dayNums, weekdays]
  const sectionRows: number[] = []
  for (const sec of sections) {
    sectionRows.push(values.length)
    const hrow: (string | number)[] = [sec.label]
    for (let c = 0; c < days + 1; c++) hrow.push('')
    values.push(hrow)
    for (const p of sec.people) {
      const dmap = p.id ? byUser.get(p.id) : undefined
      const row: (string | number)[] = [p.name, p.info]
      for (let d = 1; d <= days; d++) row.push(dmap?.get(d) ?? '')
      values.push(row)
    }
  }

  const tab = `希望_${year}年${mon}月`
  try {
    await writeShiftGrid(tab, values, year, mon, { dayStartCol: 2, sectionRows })
  } catch (e) {
    return NextResponse.json({ error: `シート書き込み失敗: ${(e as Error).message}` }, { status: 400 })
  }
  return NextResponse.json({ ok: true, tab, submitted: byUser.size })
}
