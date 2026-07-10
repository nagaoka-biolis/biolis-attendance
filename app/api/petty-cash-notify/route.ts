import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { notifyKintai, sendChannelMessage } from '@/lib/lineworks'

export const runtime = 'nodejs'

// 小口現金アプリ専用の通知中継口。
// 小口アプリ側にLINE WORKSの鍵を持たせず、稼働中の勤怠Botのcredentialで送る。
// 共有トークンで保護（サーバー間通信のみ。ブラウザには出さない）。
const RELAY_TOKEN = '478f0fcc4940dfddd8b8c3ffa8f5154fbcd07b4008ab667f'

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  })
}

// POST: { token, text, channelId? } を受けてLINE WORKSへ送信。
// channelId 指定があればそこへ、無ければ勤怠管理グループへ。
export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}))
  if (b?.token !== RELAY_TOKEN) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 403 })
  }
  const text = String(b?.text || '')
  if (!text) {
    return NextResponse.json({ ok: false, error: 'no text' }, { status: 400 })
  }
  try {
    let sent = false
    if (b?.channelId) {
      await sendChannelMessage(String(b.channelId), text)
      sent = true
    } else {
      sent = await notifyKintai(text)
    }
    return NextResponse.json({ ok: true, sent })
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 200 })
  }
}

// GET: セットアップ用。捕捉済みchannelIdを確認する（token必須）。
//   /api/petty-cash-notify?token=...
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')
  if (token !== RELAY_TOKEN) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 403 })
  }
  const db = admin()
  const { data } = await db
    .from('app_settings')
    .select('key, value')
    .in('key', ['lineworks_channel_id', 'lineworks_last_channel'])
  const map: Record<string, string> = {}
  for (const r of (data ?? []) as { key: string; value: string }[]) map[r.key] = r.value
  return NextResponse.json({
    ok: true,
    kintai_channel: map['lineworks_channel_id'] ?? null,
    last_seen_channel: map['lineworks_last_channel'] ?? null,
  })
}
