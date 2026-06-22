import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/server-admin'

export const runtime = 'nodejs'

// 在庫アプリのロールを設定/解除する（管理者のみ）。
// role: '' なら在庫アクセスを解除（行を削除）、staff/orderer/admin なら付与。
export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const admin = auth.admin

  const body = await req.json().catch(() => null)
  const userId = String(body?.userId ?? '')
  const role = String(body?.role ?? '')

  if (!userId) return NextResponse.json({ error: 'ユーザーが指定されていません' }, { status: 400 })

  if (role === '') {
    const { error } = await admin.from('inventory_roles').delete().eq('id', userId)
    if (error) return NextResponse.json({ error: `解除に失敗しました: ${error.message}` }, { status: 400 })
    return NextResponse.json({ ok: true, role: '' })
  }

  if (!['staff', 'orderer', 'admin'].includes(role)) {
    return NextResponse.json({ error: '不正なロールです' }, { status: 400 })
  }

  const { error } = await admin
    .from('inventory_roles')
    .upsert({ id: userId, role }, { onConflict: 'id' })
  if (error) return NextResponse.json({ error: `設定に失敗しました: ${error.message}` }, { status: 400 })

  return NextResponse.json({ ok: true, role })
}
