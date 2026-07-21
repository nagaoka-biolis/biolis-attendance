import { NextRequest, NextResponse } from 'next/server'
import { adminClient, requireUser } from '@/lib/server-admin'
import { notifyClock, ClockType } from '@/lib/lineworks'

export const runtime = 'nodejs'

// GET : いま保存されている channelId を確認できる（動作確認用）
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

// POST : 打刻通知（要ログイン）。{ type, isValid } を受け取り、
// 名前はサーバー側でプロフィールから引く（クライアント申告を信用しない）。
export async function POST(req: NextRequest) {
  const auth = await requireUser(req)
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status })
  }

  let type: ClockType | undefined
  let isValid = true
  let lat: number | null = null
  let lng: number | null = null
  let distance: number | null = null
  let test = false
  try {
    const body = await req.json()
    type = body?.type
    isValid = body?.isValid !== false
    lat = typeof body?.lat === 'number' ? body.lat : null
    lng = typeof body?.lng === 'number' ? body.lng : null
    distance = typeof body?.distance === 'number' ? body.distance : null
    test = body?.test === true
  } catch {
    /* noop */
  }

  const validTypes: ClockType[] = ['clock_in', 'clock_out', 'break_start', 'break_end']
  if (!type || !validTypes.includes(type)) {
    return NextResponse.json({ ok: false, error: 'type が不正です' }, { status: 400 })
  }

  const { data: me } = await auth.admin
    .from('profiles')
    .select('name')
    .eq('id', auth.userId)
    .single()
  const name = (me as { name?: string } | null)?.name ?? 'スタッフ'

  try {
    const sent = await notifyClock(name, type, isValid, { lat, lng, distance }, test)
    // channelId未保存でも打刻自体は成功させたいので ok:true を返す（sentで判別可能）
    return NextResponse.json({ ok: true, sent })
  } catch (e) {
    // 通知失敗は打刻をブロックしない
    return NextResponse.json({ ok: false, error: String(e) }, { status: 200 })
  }
}
