import { NextRequest, NextResponse } from 'next/server'
import { adminClient, requireAdmin } from '@/lib/server-admin'
import { getSetting, sendChannelMessage } from '@/lib/lineworks'

export const runtime = 'nodejs'

// 各医師の出勤「前日」夜に、その医師専用グループへリマインドを送る（Vercel Cronから叩く）。
// 対応表は app_settings key=doctor_reminder_channels に JSON { userId: channelId } で保持。
// test=true のときは本文の頭に「テスト送信」注記を付ける（先生が既にグループにいるため）。

// JST基準の「明日」を YYYY-MM-DD と表示ラベルで返す
function tomorrowJST(): { date: string; label: string } {
  const parts = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  const y = Number(get('year'))
  const m = Number(get('month'))
  const d = Number(get('day'))
  const tmr = new Date(Date.UTC(y, m - 1, d) + 24 * 60 * 60 * 1000)
  const yy = tmr.getUTCFullYear()
  const mm = tmr.getUTCMonth() + 1
  const dd = tmr.getUTCDate()
  const weekday = ['日', '月', '火', '水', '木', '金', '土'][tmr.getUTCDay()]
  return {
    date: `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`,
    label: `${mm}月${dd}日(${weekday})`,
  }
}

const TEST_NOTICE =
  '🧪【テスト送信・ご対応不要】\nこれは動作確認のテストです。実際の予定連絡ではありません。\n\n'

async function buildAndSend(
  test: boolean
): Promise<{ ok: boolean; date?: string; sent?: number; results?: unknown[]; error?: string }> {
  const { date, label } = tomorrowJST()
  const admin = adminClient()

  // 対応表（医師userId → channelId）
  const mapRaw = await getSetting('doctor_reminder_channels')
  let map: Record<string, string> = {}
  try {
    map = mapRaw ? JSON.parse(mapRaw) : {}
  } catch {
    return { ok: false, error: '対応表(doctor_reminder_channels)のJSONが不正です' }
  }
  const userIds = Object.keys(map)
  if (userIds.length === 0) {
    return { ok: false, error: '対応表が未登録です（doctor_reminder_channels）' }
  }

  // 明日の「出勤」シフト（対応表にいる医師だけ）
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: shifts } = await (admin.from('shifts') as any)
    .select('user_id, start_time, end_time, kind')
    .eq('date', date)
    .eq('kind', 'work')
    .in('user_id', userIds)
  const rows = (shifts ?? []) as {
    user_id: string
    start_time: string | null
    end_time: string | null
  }[]

  // 氏名
  const { data: profs } = await admin.from('profiles').select('id, name')
  const nameById = new Map<string, string>()
  for (const p of (profs ?? []) as { id: string; name: string }[]) nameById.set(p.id, p.name)

  const botId = process.env.LINEWORKS_SHIFT_BOT_ID
  if (!botId) return { ok: false, error: 'LINEWORKS_SHIFT_BOT_ID が未設定です' }

  const results: { name: string; ok: boolean; error?: string }[] = []
  let sent = 0
  for (const r of rows) {
    const channelId = map[r.user_id]
    if (!channelId) continue
    const name = nameById.get(r.user_id) ?? '先生'
    const time = r.start_time ? `${r.start_time}${r.end_time ? `-${r.end_time}` : ''}` : '時間未定'
    let text = `🔔 出勤リマインド\n${name} 先生\n明日 ${label} ${time} の出勤予定です。\nよろしくお願いいたします。`
    // テスト送信時のみ、頭にテスト注記＋末尾に自動送信の案内を付ける
    if (test) {
      text =
        TEST_NOTICE +
        text +
        '\n\n※今後、出勤日の前日19時ごろに、このリマインドを自動でお送りします。'
    }
    try {
      await sendChannelMessage(channelId, text, botId)
      sent++
      results.push({ name, ok: true })
    } catch (e) {
      results.push({ name, ok: false, error: String(e) })
    }
  }
  return { ok: true, date, sent, results }
}

// Cron(CRON_SECRET) もしくは 管理者ログイン のどちらかで実行を許可
async function authorized(req: NextRequest): Promise<boolean> {
  const secret = process.env.CRON_SECRET
  if (secret && req.headers.get('authorization') === `Bearer ${secret}`) return true
  if (!secret) return true
  const auth = await requireAdmin(req)
  return auth.ok
}

// test判定：クエリ ?test=1 または body {test:true}
async function isTest(req: NextRequest): Promise<boolean> {
  if (req.nextUrl.searchParams.get('test') === '1') return true
  try {
    const body = await req.json()
    return body?.test === true
  } catch {
    return false
  }
}

export async function GET(req: NextRequest) {
  if (!(await authorized(req))) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  // Cron本番実行（GET）。test はクエリで指定可能。
  try {
    const r = await buildAndSend(req.nextUrl.searchParams.get('test') === '1')
    return NextResponse.json(r)
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  if (!(await authorized(req))) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  try {
    const r = await buildAndSend(await isTest(req))
    return NextResponse.json(r)
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 })
  }
}
