import { NextRequest, NextResponse } from 'next/server'
import { adminClient, requireAdmin } from '@/lib/server-admin'
import { getSetting, sendChannelMessage } from '@/lib/lineworks'

export const runtime = 'nodejs'

// 毎朝、当日の出勤者一覧を専用LINE WORKSグループへ通知する（Vercel Cronから叩く）。
// 保護: CRON_SECRET を Authorization: Bearer で要求（Vercel Cronが自動付与）。

// JST基準の「今日」を YYYY-MM-DD で返す
function todayJST(): { date: string; label: string } {
  const parts = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  }).formatToParts(new Date())
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  const y = get('year')
  const m = get('month')
  const d = get('day')
  const w = get('weekday')
  return { date: `${y}-${m}-${d}`, label: `${Number(m)}月${Number(d)}日(${w})` }
}

// 職種セクションの表示ラベルと並び順
const CATEGORY_LABEL: Record<string, string> = {
  Dr: 'Dr',
  Ns: 'Ns',
  UK: 'UK',
  ABLNS: 'ABL Ns',
  ABLUK: 'ABL UK',
}
const CATEGORY_ORDER = ['Dr', 'Ns', 'UK', 'ABLNS', 'ABLUK']
const OTHER = '__other__'

async function buildAndSend(): Promise<{ ok: boolean; sent: boolean; count: number; error?: string }> {
  const { date, label } = todayJST()
  const admin = adminClient()

  // 当日の「出勤」シフトを取得
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: shifts } = await (admin.from('shifts') as any)
    .select('user_id, start_time, end_time, kind')
    .eq('date', date)
    .eq('kind', 'work')
  const rows = (shifts ?? []) as { user_id: string; start_time: string | null; end_time: string | null }[]

  // 氏名・職種を引く
  const { data: profs } = await admin.from('profiles').select('id, name, category')
  const nameById = new Map<string, string>()
  const catById = new Map<string, string>()
  for (const p of (profs ?? []) as { id: string; name: string; category: string | null }[]) {
    nameById.set(p.id, p.name)
    catById.set(p.id, p.category || OTHER)
  }

  // 職種ごとにまとめ、各職種内は勤務開始時刻順
  const byCat = new Map<string, { name: string; start: string | null; end: string | null }[]>()
  for (const r of rows) {
    const cat = catById.get(r.user_id) ?? OTHER
    if (!byCat.has(cat)) byCat.set(cat, [])
    byCat.get(cat)!.push({ name: nameById.get(r.user_id) ?? '(不明)', start: r.start_time, end: r.end_time })
  }
  for (const arr of byCat.values()) {
    arr.sort((a, b) => (a.start ?? '99:99').localeCompare(b.start ?? '99:99'))
  }

  const total = rows.length
  let text: string
  if (total === 0) {
    text = `📅 本日のシフト（${label}）\n\n本日の出勤予定はありません。`
  } else {
    // 並び順：定義順 → 未定義職種 → その他
    const cats = [
      ...CATEGORY_ORDER.filter((c) => byCat.has(c)),
      ...[...byCat.keys()].filter((c) => !CATEGORY_ORDER.includes(c) && c !== OTHER),
    ]
    if (byCat.has(OTHER)) cats.push(OTHER)

    const blocks = cats.map((cat) => {
      const heading = cat === OTHER ? 'その他' : CATEGORY_LABEL[cat] ?? cat
      const lines = byCat.get(cat)!.map((x) => {
        const time = x.start ? `${x.start}${x.end ? `-${x.end}` : '-'}` : '時間未設定'
        return `・${x.name}  ${time}`
      })
      return `[${heading}]\n${lines.join('\n')}`
    })
    text = `📅 本日のシフト（${label}）\n\n${blocks.join('\n\n')}\n\n👥 合計 ${total}名`
  }

  const channelId = await getSetting('lineworks_shift_channel_id')
  const botId = process.env.LINEWORKS_SHIFT_BOT_ID
  if (!channelId || !botId) {
    return { ok: false, sent: false, count: total, error: 'shift channelId または BOT_ID が未設定です' }
  }
  await sendChannelMessage(channelId, text, botId)
  return { ok: true, sent: true, count: total }
}

// Cron(CRON_SECRET) もしくは 管理者ログイン のどちらかで実行を許可
async function authorized(req: NextRequest): Promise<boolean> {
  const secret = process.env.CRON_SECRET
  if (secret && req.headers.get('authorization') === `Bearer ${secret}`) return true
  if (!secret) return true // 未設定なら素通し（開発時）
  // 管理者の手動テストを許可
  const auth = await requireAdmin(req)
  return auth.ok
}

export async function GET(req: NextRequest) {
  if (!(await authorized(req))) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  try {
    const r = await buildAndSend()
    return NextResponse.json(r)
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 })
  }
}

// 手動テスト用（同じ処理）
export async function POST(req: NextRequest) {
  return GET(req)
}
