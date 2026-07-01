import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/server-admin'
import { writeSheet } from '@/lib/google-sheets'

export const runtime = 'nodejs'

type Req = { user_id: string; date: string; kind: string; start_time: string | null; end_time: string | null }

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

  const { data: profs } = await admin.from('profiles').select('id,name')
  const name = new Map<string, string>((profs ?? []).map((p: { id: string; name: string }) => [p.id, p.name]))
  const { data: reqs } = await admin.from('shift_requests').select('user_id,date,kind,start_time,end_time').gte('date', start).lte('date', end)

  // 先生ごとに希望を集約
  const byUser = new Map<string, Map<number, string>>()
  for (const r of (reqs ?? []) as Req[]) {
    const d = new Date(r.date).getDate()
    const label = r.kind === 'off' ? '休み希望' : r.kind === 'undecided' ? '未定'
      : (r.start_time ? (r.end_time ? `${r.start_time}-${r.end_time}` : `${r.start_time}-`) : '勤務希望')
    if (!byUser.has(r.user_id)) byUser.set(r.user_id, new Map())
    byUser.get(r.user_id)!.set(d, label)
  }

  // グリッド作成： 先生 / 1..31
  const header: (string | number)[] = ['先生（希望）', ...Array.from({ length: days }, (_, i) => i + 1)]
  const rows: (string | number)[][] = [[`${year}年${mon}月 シフト希望（アプリ提出・自動反映）`], header]
  for (const [uid, dmap] of byUser.entries()) {
    const row: (string | number)[] = [name.get(uid) ?? '—']
    for (let d = 1; d <= days; d++) row.push(dmap.get(d) ?? '')
    rows.push(row)
  }
  if (byUser.size === 0) rows.push(['（まだ提出はありません）'])

  const tab = `希望_${year}年${mon}月`
  try {
    await writeSheet(tab, rows)
  } catch (e) {
    return NextResponse.json({ error: `シート書き込み失敗: ${(e as Error).message}` }, { status: 400 })
  }
  return NextResponse.json({ ok: true, tab, count: byUser.size })
}
