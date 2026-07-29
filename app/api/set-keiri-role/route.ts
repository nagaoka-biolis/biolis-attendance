import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/server-admin'

export const runtime = 'nodejs'

// 経理（領収書 手動保管）権限を付与/解除する（管理者のみ）。
// body: { userId, enabled }  enabled=true で付与（行を追加）、false で解除（行を削除）。
export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const admin = auth.admin

  const body = await req.json().catch(() => null)
  const userId = String(body?.userId ?? '')
  const enabled = Boolean(body?.enabled)

  if (!userId) return NextResponse.json({ error: 'ユーザーが指定されていません' }, { status: 400 })

  if (!enabled) {
    const { error } = await admin.from('receipt_managers').delete().eq('id', userId)
    if (error) return NextResponse.json({ error: `解除に失敗しました: ${error.message}` }, { status: 400 })
    return NextResponse.json({ ok: true, enabled: false })
  }

  const { error } = await admin
    .from('receipt_managers')
    .upsert({ id: userId }, { onConflict: 'id' })
  if (error) return NextResponse.json({ error: `付与に失敗しました: ${error.message}` }, { status: 400 })

  return NextResponse.json({ ok: true, enabled: true })
}
