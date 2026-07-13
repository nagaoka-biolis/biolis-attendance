import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

// シフト通知Bot専用のコールバック受け口。
// Botがシフト通知グループに追加された時の channelId を専用キーに保存する。
export async function POST(req: NextRequest) {
  let body: unknown = null
  try { body = await req.json() } catch { /* noop */ }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b = body as any
  const channelId = b?.source?.channelId
  if (channelId) {
    try {
      const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
      // シフト通知の送信先は一度確定したら保護する（未設定のときだけ初期セット）。
      // 医師リマインド用Botを各先生グループに招待した際、ここが上書きされて
      // 全体シフト通知が別グループに飛ぶ事故が起きたため、上書きしない。
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: existing } = await (admin.from('app_settings') as any)
        .select('value').eq('key', 'lineworks_shift_channel_id').maybeSingle()
      if (!existing?.value) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (admin.from('app_settings') as any).upsert({ key: 'lineworks_shift_channel_id', value: String(channelId) })
      }
      // 直近に見かけたchannelIdは参照用に別キーへ記録（上書き先を分離）。
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (admin.from('app_settings') as any).upsert({ key: 'lineworks_shift_last_channel', value: String(channelId) })
    } catch { /* noop */ }
  }
  return NextResponse.json({ ok: true })
}

export async function GET() {
  return NextResponse.json({ ok: true })
}
