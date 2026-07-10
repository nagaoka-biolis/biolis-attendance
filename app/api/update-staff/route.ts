import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/server-admin'

export const runtime = 'nodejs'

// スタッフの氏名・権限を変更する（管理者専用）。
// body: { userId, name?, role? } — 渡された項目だけ更新。
export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const admin = auth.admin

  const body = await req.json().catch(() => null)
  const userId = String(body?.userId ?? '').trim()
  if (!userId) return NextResponse.json({ error: 'userId が必要です' }, { status: 400 })

  const patch: { name?: string; role?: 'staff' | 'admin' } = {}

  if (body?.name !== undefined) {
    const name = String(body.name).trim()
    if (!name) return NextResponse.json({ error: '氏名を入力してください' }, { status: 400 })
    patch.name = name
  }

  if (body?.role !== undefined) {
    if (body.role !== 'staff' && body.role !== 'admin') {
      return NextResponse.json({ error: 'role が不正です' }, { status: 400 })
    }
    // 自分自身を管理者から外すのは禁止（ロックアウト防止）
    if (userId === auth.adminId && body.role !== 'admin') {
      return NextResponse.json({ error: '自分自身の管理者権限は外せません' }, { status: 400 })
    }
    patch.role = body.role
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: '変更内容がありません' }, { status: 400 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (admin.from('profiles') as any).update(patch).eq('id', userId)
  if (error) return NextResponse.json({ error: `更新に失敗しました: ${error.message}` }, { status: 400 })

  return NextResponse.json({ ok: true })
}
