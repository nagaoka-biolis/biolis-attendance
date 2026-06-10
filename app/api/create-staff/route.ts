import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/server-admin'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const admin = auth.admin

  const body = await req.json().catch(() => null)
  const name = String(body?.name ?? '').trim()
  const email = String(body?.email ?? '').trim()
  const password = String(body?.password ?? '')
  const role = body?.role === 'admin' ? 'admin' : 'staff'

  if (!name || !email || password.length < 6) {
    return NextResponse.json({ error: '名前・メール・パスワード（6文字以上）を入力してください' }, { status: 400 })
  }

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  if (createErr || !created.user) {
    return NextResponse.json({ error: `作成に失敗しました: ${createErr?.message ?? '不明なエラー'}` }, { status: 400 })
  }

  const { error: profileErr } = await admin.from('profiles').insert({ id: created.user.id, name, role })
  if (profileErr) {
    await admin.auth.admin.deleteUser(created.user.id)
    return NextResponse.json({ error: `プロフィール登録に失敗しました: ${profileErr.message}` }, { status: 400 })
  }

  return NextResponse.json({ ok: true, name, email, role })
}
