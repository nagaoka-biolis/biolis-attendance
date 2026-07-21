import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/server-admin'

export const runtime = 'nodejs'

type ExpenseRow = {
  id: string
  user_id: string
  date: string
  amount: number
  category: string
  from_place: string | null
  to_place: string | null
  transport: string | null
  purpose: string | null
  receipt_url: string | null
  status: string
  reject_reason: string | null
  reviewed_at: string | null
  created_at: string
}

// GET : 経費申請の一覧。
//   スタッフ=自分の申請のみ / 管理者=全員（?user_id / ?month=YYYY-MM / ?status でフィルタ可）。
export async function GET(req: NextRequest) {
  const auth = await requireUser(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { data: me } = await auth.admin.from('profiles').select('role').eq('id', auth.userId).single()
  const isAdmin = (me as { role?: string } | null)?.role === 'admin'

  const sp = req.nextUrl.searchParams
  let q = auth.admin.from('expense_requests').select('*').order('date', { ascending: false }).order('created_at', { ascending: false })

  if (isAdmin) {
    const u = sp.get('user_id')
    if (u) q = q.eq('user_id', u)
  } else {
    // スタッフは自分の分だけ
    q = q.eq('user_id', auth.userId)
  }
  const status = sp.get('status')
  if (status) q = q.eq('status', status)
  const month = sp.get('month')
  const mm = month?.match(/^(\d{4})-(\d{2})$/)
  if (mm) {
    const y = Number(mm[1]); const mon = Number(mm[2])
    const start = `${y}-${String(mon).padStart(2, '0')}-01`
    const end = `${y}-${String(mon).padStart(2, '0')}-${String(new Date(y, mon, 0).getDate()).padStart(2, '0')}`
    q = q.gte('date', start).lte('date', end)
  }

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // 名前を添える
  const { data: profs } = await auth.admin.from('profiles').select('id,name')
  const name = new Map<string, string>((profs ?? []).map((p: { id: string; name: string }) => [p.id, p.name]))
  const rows = ((data ?? []) as ExpenseRow[]).map((r) => ({ ...r, name: name.get(r.user_id) ?? '—' }))
  return NextResponse.json({ ok: true, isAdmin, rows })
}

// POST : 経費申請を作成（要ログイン。user_id はトークンから）。
export async function POST(req: NextRequest) {
  const auth = await requireUser(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const b = await req.json().catch(() => null)
  const date = String(b?.date ?? '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: '利用日が不正です' }, { status: 400 })
  const amount = Math.round(Number(b?.amount))
  if (!Number.isFinite(amount) || amount <= 0) return NextResponse.json({ error: '金額を入力してください' }, { status: 400 })

  const insert = {
    user_id: auth.userId,
    date,
    amount,
    category: (typeof b?.category === 'string' && b.category.trim()) || '交通費',
    from_place: b?.from_place ? String(b.from_place).slice(0, 100) : null,
    to_place: b?.to_place ? String(b.to_place).slice(0, 100) : null,
    transport: b?.transport ? String(b.transport).slice(0, 40) : null,
    purpose: b?.purpose ? String(b.purpose).slice(0, 300) : null,
    receipt_url: b?.receipt_url ? String(b.receipt_url) : null,
    status: 'pending',
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (auth.admin.from('expense_requests') as any).insert(insert).select('id').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, id: (data as { id: string }).id })
}
