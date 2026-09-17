import { NextRequest, NextResponse } from 'next/server'
import { requirePayrollViewer } from '@/lib/server-admin'

export const runtime = 'nodejs'

// freee従業員番号マスタの取得・編集。給与を見られる人だけ。
export async function GET(req: NextRequest) {
  const auth = await requirePayrollViewer(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const admin = auth.admin
  const { data: profs } = await admin.from('profiles').select('id,name,role').order('created_at', { ascending: true })
  const { data: map } = await admin.from('freee_employee_map').select('user_id,employee_code')
  return NextResponse.json({ ok: true, profiles: profs ?? [], map: map ?? [] })
}

export async function POST(req: NextRequest) {
  const auth = await requirePayrollViewer(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const admin = auth.admin
  const b = await req.json().catch(() => null)
  const user_id = String(b?.user_id ?? '')
  if (!user_id) return NextResponse.json({ error: 'user_id が必要です' }, { status: 400 })
  const employee_code = b?.employee_code == null ? null : String(b.employee_code)
  const { error } = await (admin.from('freee_employee_map') as ReturnType<typeof admin.from>)
    .upsert({ user_id, employee_code, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
