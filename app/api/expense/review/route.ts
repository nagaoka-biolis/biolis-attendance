import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/server-admin'

export const runtime = 'nodejs'

// POST : 経費申請の承認/却下（管理者のみ）。{ id, action: 'approve'|'reject', reason? }
export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const b = await req.json().catch(() => null)
  const id = String(b?.id ?? '')
  const action = String(b?.action ?? '')
  if (!id) return NextResponse.json({ error: 'id がありません' }, { status: 400 })
  if (action !== 'approve' && action !== 'reject') {
    return NextResponse.json({ error: 'action が不正です' }, { status: 400 })
  }

  const patch = {
    status: action === 'approve' ? 'approved' : 'rejected',
    reject_reason: action === 'reject' ? (b?.reason ? String(b.reason).slice(0, 300) : null) : null,
    reviewed_by: auth.adminId,
    reviewed_at: new Date().toISOString(),
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (auth.admin.from('expense_requests') as any).update(patch).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
