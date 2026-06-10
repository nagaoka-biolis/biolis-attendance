import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

export async function POST(req: NextRequest) {
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } })

  // 1) リクエスト元が管理者か検証
  const token = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: '認証が必要です' }, { status: 401 })

  const { data: { user }, error: authErr } = await admin.auth.getUser(token)
  if (authErr || !user) return NextResponse.json({ error: '認証に失敗しました' }, { status: 401 })

  const { data: me } = await admin.from('profiles').select('role').eq('id', user.id).single()
  if ((me as { role?: string } | null)?.role !== 'admin') {
    return NextResponse.json({ error: '管理者のみ実行できます' }, { status: 403 })
  }

  // 2) 入力チェック
  const body = await req.json().catch(() => null)
  const name = String(body?.name ?? '').trim()
  const email = String(body?.email ?? '').trim()
  const password = String(body?.password ?? '')
  const role = body?.role === 'admin' ? 'admin' : 'staff'

  if (!name || !email || password.length < 6) {
    return NextResponse.json({ error: '名前・メール・パスワード（6文字以上）を入力してください' }, { status: 400 })
  }

  // 3) アカウント作成（メール確認済みで作成）
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  if (createErr || !created.user) {
    return NextResponse.json({ error: `作成に失敗しました: ${createErr?.message ?? '不明なエラー'}` }, { status: 400 })
  }

  // 4) プロフィール登録
  const { error: profileErr } = await admin.from('profiles').insert({
    id: created.user.id,
    name,
    role,
  })
  if (profileErr) {
    // プロフィール作成に失敗したら作ったアカウントを削除（整合性維持）
    await admin.auth.admin.deleteUser(created.user.id)
    return NextResponse.json({ error: `プロフィール登録に失敗しました: ${profileErr.message}` }, { status: 400 })
  }

  return NextResponse.json({ ok: true, name, email, role })
}
