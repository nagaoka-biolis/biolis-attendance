import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

// LINE WORKS Bot のコールバック受け口。
// Botがグループに追加された/メッセージが来た時に channelId を捕まえて保存する。
export async function POST(req: NextRequest) {
  let body: unknown = null
  try { body = await req.json() } catch { /* noop */ }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b = body as any
  const channelId = b?.source?.channelId
  if (channelId) {
    try {
      const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (admin.from('app_settings') as any).upsert({ key: 'lineworks_channel_id', value: String(channelId) })
    } catch { /* noop */ }
  }
  return NextResponse.json({ ok: true })
}

// 登録時の疎通確認（GET）用
export async function GET() {
  return NextResponse.json({ ok: true })
}
