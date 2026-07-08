import { NextRequest, NextResponse } from 'next/server'
import { adminClient } from '@/lib/server-admin'
import { notifyKintai } from '@/lib/lineworks'

export const runtime = 'nodejs'

// テスト送信 & 疎通確認用エンドポイント。
// GET  : いま保存されている channelId を確認できる（動作確認用）
// POST : { text } を勤怠管理グループへ送信（未指定ならテスト文言）
export async function GET() {
  const admin = adminClient()
  const { data } = await admin
    .from('app_settings')
    .select('value')
    .eq('key', 'lineworks_channel_id')
    .maybeSingle()
  const channelId = (data as { value?: string } | null)?.value ?? null
  return NextResponse.json({ ok: true, channelId })
}

export async function POST(req: NextRequest) {
  let text = 'BiOLiS勤怠通知：テスト送信です'
  try {
    const body = await req.json()
    if (body?.text) text = String(body.text)
  } catch {
    /* body無しならデフォルト文言 */
  }
  try {
    const sent = await notifyKintai(text)
    if (!sent) {
      return NextResponse.json(
        { ok: false, error: 'channelId未保存です。先に勤怠管理グループへBotを招待してください。' },
        { status: 400 }
      )
    }
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 })
  }
}
