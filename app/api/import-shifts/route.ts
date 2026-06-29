import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/server-admin'
import { readSheetValues } from '@/lib/google-sheets'

export const runtime = 'nodejs'

const HEADERS = new Set(['Dr', 'Ns', 'UK', 'ABLNS', 'ABLUK'])
const nk = (s: string) => (s || '').replace('Dr.', '').replace(/　/g, '').replace(/ /g, '').replace('⼀', '一').trim()
function normTime(t: string) {
  t = t.trim()
  if (t.includes(':')) { const [h, m] = t.split(':'); return `${h.padStart(2, '0')}:${m}` }
  return `${t.padStart(2, '0')}:00`
}
function parseTime(v: string): { kind: string; start: string | null; end: string | null } | null {
  const s = (v || '').trim()
  if (!s) return null
  if (s === '休') return { kind: 'off', start: null, end: null }
  let paid = false; let rest = s
  if (s.includes('有給')) { paid = true; rest = s.replace('有給', '').trim() }
  const m = rest.match(/^(\d{1,2}(?::\d{2})?)\s*[-~]\s*(\d{1,2}(?::\d{2})?)?$/)
  if (m) return { kind: paid ? 'paid' : 'work', start: normTime(m[1]), end: m[2] ? normTime(m[2]) : null }
  if (paid) return { kind: 'paid', start: null, end: null }
  return null
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const admin = auth.admin

  const body = await req.json().catch(() => null)
  const month = String(body?.month ?? '')  // "YYYY-MM"
  const mm = month.match(/^(\d{4})-(\d{2})$/)
  if (!mm) return NextResponse.json({ error: '月の指定が不正です' }, { status: 400 })
  const year = Number(mm[1]); const mon = Number(mm[2])
  const tab = `${year}年${mon}月`
  const daysInMonth = new Date(year, mon, 0).getDate()

  let values: string[][]
  try {
    values = await readSheetValues(tab)
  } catch (e) {
    return NextResponse.json({ error: `シート読み取り失敗: ${(e as Error).message}` }, { status: 400 })
  }

  // 登録スタッフ名 → id
  const { data: profs } = await admin.from('profiles').select('id,name')
  const exact = new Map<string, string>(); const normed = new Map<string, string>()
  for (const p of (profs ?? []) as { id: string; name: string }[]) {
    exact.set(p.name, p.id); normed.set(nk(p.name), p.id)
  }
  const matchId = (a: string) => exact.get(a.trim()) ?? normed.get(nk(a)) ?? null

  // 解析：各自2行（上=時間 / 下=備考）
  const byUser = new Map<string, { user_id: string; date: string; start_time: string | null; end_time: string | null; kind: string; status: string; note: string | null }[]>()
  const updatedNames: string[] = []
  const skipped = new Set<string>()

  let i = 4 // sheet row 5 から
  while (i < values.length) {
    const a = (values[i]?.[0] ?? '').toString()
    const key = nk(a)
    if (!a) { i++; continue }
    if (HEADERS.has(key)) { i++; continue }
    const timeRow = values[i] ?? []; const noteRow = values[i + 1] ?? []
    const uid = matchId(a)
    const rows: typeof byUser extends Map<string, infer V> ? V : never = []
    let hasData = false
    for (let c = 2; c <= 32; c++) {
      const day = c - 1
      if (day > daysInMonth) break
      const t = parseTime(timeRow[c] ?? '')
      const note = (noteRow[c] ?? '').toString().trim()
      if (!t) continue
      hasData = true
      if (uid) rows.push({ user_id: uid, date: `${year}-${String(mon).padStart(2, '0')}-${String(day).padStart(2, '0')}`, start_time: t.start, end_time: t.end, kind: t.kind, status: '確定', note: note || null })
    }
    if (uid) { if (rows.length) { byUser.set(uid, rows); updatedNames.push(a.trim()) } }
    else if (hasData) skipped.add(a.trim())
    i += 2
  }

  // 取り込み（対象月を一旦削除→投入）
  const start = `${year}-${String(mon).padStart(2, '0')}-01`
  const end = `${year}-${String(mon).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`
  let count = 0
  for (const [uid, rows] of byUser.entries()) {
    await admin.from('shifts').delete().eq('user_id', uid).gte('date', start).lte('date', end)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (admin.from('shifts') as any).insert(rows)
    if (!error) count += rows.length
  }

  return NextResponse.json({ ok: true, month: tab, count, updated: updatedNames, skipped: Array.from(skipped) })
}
