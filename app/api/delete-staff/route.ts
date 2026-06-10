import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/server-admin'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const admin = auth.admin

  const body = await req.json().catch(() => null)
  const userId = String(body?.userId ?? '')
  if (!userId) return NextResponse.json({ error: '対象が不正です' }, { status: 400 })

  // 打刻履歴・プロフィールを先に削除してからアカウントを削除
  await admin.from('attendance').delete().eq('user_id', userId)
  await admin.from('messages').delete().eq('user_id', userId)
  await admin.from('profiles').delete().eq('id', userId)

  const { error } = await admin.auth.admin.deleteUser(userId)
  if (error) return NextResponse.json({ error: `削除に失敗しました: ${error.message}` }, { status: 400 })

  return NextResponse.json({ ok: true })
}
