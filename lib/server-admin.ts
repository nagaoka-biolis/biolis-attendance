import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { NextRequest } from 'next/server'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

export function adminClient(): SupabaseClient {
  return createClient(url, serviceKey, { auth: { persistSession: false } })
}

// リクエスト元が管理者か検証する。OKなら admin クライアントを返す。
export async function requireAdmin(req: NextRequest): Promise<
  { ok: true; admin: SupabaseClient } | { ok: false; error: string; status: number }
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
  return { ok: true, admin }
}
