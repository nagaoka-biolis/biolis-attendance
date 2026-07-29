import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { NextRequest } from 'next/server'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

export function adminClient(): SupabaseClient {
  return createClient(url, serviceKey, { auth: { persistSession: false } })
}

// リクエスト元が管理者か検証する。OKなら admin クライアントを返す。
export async function requireAdmin(req: NextRequest): Promise<
  { ok: true; admin: SupabaseClient; adminId: string } | { ok: false; error: string; status: number }
> {
  const admin = adminClient()
  const token = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return { ok: false, error: '認証が必要です', status: 401 }

  const { data: { user }, error } = await admin.auth.getUser(token)
  if (error || !user) return { ok: false, error: '認証に失敗しました', status: 401 }

  const { data: me } = await admin.from('profiles').select('role').eq('id', user.id).single()
  if ((me as { role?: string } | null)?.role !== 'admin') {
    return { ok: false, error: '管理者のみ実行できます', status: 403 }
  }
  return { ok: true, admin, adminId: user.id }
}

// ログイン済みユーザーなら誰でも（本人確認）
export async function requireUser(req: NextRequest): Promise<
  { ok: true; admin: SupabaseClient; userId: string } | { ok: false; error: string; status: number }
> {
  const admin = adminClient()
  const t = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!t) return { ok: false, error: '認証が必要です', status: 401 }
  const { data: { user }, error } = await admin.auth.getUser(t)
  if (error || !user) return { ok: false, error: '認証に失敗しました', status: 401 }
  return { ok: true, admin, userId: user.id }
}

// 経理権限（領収書の手動保管）を持つか検証する。
// 「メインroleがadmin」または「receipt_managers に行がある」なら許可。
export async function requireReceiptManager(req: NextRequest): Promise<
  { ok: true; admin: SupabaseClient; userId: string; isAdmin: boolean } | { ok: false; error: string; status: number }
> {
  const admin = adminClient()
  const t = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!t) return { ok: false, error: '認証が必要です', status: 401 }
  const { data: { user }, error } = await admin.auth.getUser(t)
  if (error || !user) return { ok: false, error: '認証に失敗しました', status: 401 }

  const { data: me } = await admin.from('profiles').select('role').eq('id', user.id).single()
  const isAdmin = (me as { role?: string } | null)?.role === 'admin'
  if (isAdmin) return { ok: true, admin, userId: user.id, isAdmin: true }

  const { data: km } = await admin.from('receipt_managers').select('id').eq('id', user.id).maybeSingle()
  if (km) return { ok: true, admin, userId: user.id, isAdmin: false }

  return { ok: false, error: '経理権限が必要です', status: 403 }
}
