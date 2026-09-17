import { NextRequest, NextResponse } from 'next/server'
import { requirePayrollViewer } from '@/lib/server-admin'

export const runtime = 'nodejs'

// 給与マスタ（時給/月給・発効日つき）の一覧取得＋編集。給与を見られる人だけ。

export async function GET(req: NextRequest) {
  const auth = await requirePayrollViewer(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const admin = auth.admin
  const { data: staff } = await admin.from('profiles').select('id,name,role').order('created_at', { ascending: true })
  const { data: wages } = await admin.from('staff_wages').select('*').order('effective_from', { ascending: false })
  return NextResponse.json({ ok: true, staff: staff ?? [], wages: wages ?? [] })
}

export async function POST(req: NextRequest) {
  const auth = await requirePayrollViewer(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const admin = auth.admin
  const b = await req.json().catch(() => null)
  const user_id = String(b?.user_id ?? '')
  const effective_from = String(b?.effective_from ?? '')
  if (!user_id || !/^\d{4}-\d{2}-\d{2}$/.test(effective_from)) {
    return NextResponse.json({ error: 'user_id と effective_from(YYYY-MM-DD) が必要です' }, { status: 400 })
  }
  const pay_type = b?.pay_type === 'monthly' ? 'monthly' : 'hourly'
  const num = (v: unknown): number | null => (v === '' || v == null ? null : Number(v))
  const row = {
    user_id, effective_from, pay_type,
    hourly_rate: pay_type === 'hourly' ? num(b?.hourly_rate) : null,
    monthly_salary: pay_type === 'monthly' ? num(b?.monthly_salary) : null,
    fixed_overtime: Number(b?.fixed_overtime) || 0,
    commute_round_trip: num(b?.commute_round_trip),
    freee_employee_code: b?.freee_employee_code ? String(b.freee_employee_code) : null,
    note: b?.note ? String(b.note) : null,
    updated_at: new Date().toISOString(),
  }
  const { error } = await (admin.from('staff_wages') as ReturnType<typeof admin.from>).upsert(row, { onConflict: 'user_id,effective_from' })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const auth = await requirePayrollViewer(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const admin = auth.admin
  const b = await req.json().catch(() => null)
  const user_id = String(b?.user_id ?? '')
  const effective_from = String(b?.effective_from ?? '')
  if (!user_id || !effective_from) return NextResponse.json({ error: 'user_id と effective_from が必要です' }, { status: 400 })
  const { error } = await admin.from('staff_wages').delete().eq('user_id', user_id).eq('effective_from', effective_from)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
