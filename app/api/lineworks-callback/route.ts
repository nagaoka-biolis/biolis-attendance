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
      // 勤怠のchannelは既に保存済みなら保護（未設定のときだけ初期セット）。
      // 別グループの活動でここが上書きされ勤怠通知が壊れるのを防ぐ。
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: existing } = await (admin.from('app_settings') as any)
        .select('value').eq('key', 'lineworks_channel_id').maybeSingle()
      if (!existing?.value) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (admin.from('app_settings') as any).upsert({ key: 'lineworks_channel_id', value: String(channelId) })
      }
      // 直近に見かけたchannelIdは常に記録（新グループのchannelId捕捉用）。
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (admin.from('app_settings') as any).upsert({ key: 'lineworks_last_channel', value: String(channelId) })
    } catch { /* noop */ }
  }
  return NextResponse.json({ ok: true })
}

// 登録時の疎通確認（GET）用
export async function GET() {
  return NextResponse.json({ ok: true })
}
