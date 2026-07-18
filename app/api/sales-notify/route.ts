import { NextRequest, NextResponse } from 'next/server'
import { adminClient, requireAdmin } from '@/lib/server-admin'
import { getSetting, sendChannelMessage } from '@/lib/lineworks'

export const runtime = 'nodejs'

// 毎日23:30に、その日の売上サマリを専用グループへ通知する（Vercel Cronから叩く）。
// 保存済みCSV(app_settings key=sales_csv:*)を解析。日次売上が無くても
// 月次売上＋日次統計＋月次統計で当日/当月/当年をカバーする。

// クオート対応CSVパーサ
function parseCSV(text: string): string[][] {
  return text.split(/\r?\n/).map((line) => {
    const out: string[] = []
    let cur = ''
    let q = false
    for (let i = 0; i < line.length; i++) {
      const c = line[i]
      if (c === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++ } else q = !q }
      else if (c === ',' && !q) { out.push(cur); cur = '' }
      else cur += c
    }
    out.push(cur)
    return out.map((s) => s.replace(/^﻿/, '').trim())
  })
}
const num = (s: string | undefined) => Number(String(s ?? '').replace(/[",]/g, '')) || 0
const yen = (n: number) => n.toLocaleString('ja-JP') + '円'

// 対象営業日(JST)。このcronは23:30発火想定だが、Vercel Hobbyの遅延で
// 0時をまたいで翌0時過ぎに発火することがある。その場合でも「意図した営業日」
// (=昨日ではなく発火が本来狙っていた当日)を返すため、現在時刻から8時間戻して
// からJST日付を採る。23:30〜翌朝7:30頃までの遅延は全て正しい営業日にマップされ、
// 月末・年末の繰り上がりも自動で正しくなる。
function todayJST(): { ymd: string; ym: string; day: number; label: string } {
  const shifted = new Date(Date.now() - 8 * 60 * 60 * 1000)
  const parts = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
  }).formatToParts(shifted)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  const y = get('year'), m = get('month'), d = get('day'), w = get('weekday')
  return { ymd: `${y}${m}${d}`, ym: `${y}${m}`, day: Number(d), label: `${Number(m)}月${Number(d)}日(${w})` }
}

async function getCSV(admin: ReturnType<typeof adminClient>, base: string): Promise<string[][] | null> {
  const v = await getSetting(`sales_csv:${base}`)
  return v ? parseCSV(v) : null
}

async function buildMessage(dateYmd: string, dateYm: string, day: number, label: string): Promise<{ text: string; found: number }> {
  const admin = adminClient()
  const monthlySales = await getCSV(admin, `月次売上_${dateYm}`)   // 当日/当月の患者数・売上
  const dailyStats = await getCSV(admin, `日次統計_${dateYmd}`)     // 当日の施術種別内訳
  const monthlyStats = await getCSV(admin, `月次統計_${dateYm}`)    // 当年累計
  let found = 0

  // --- 月次売上から 当日(その日の行) と 当月(計 行) ---
  // 列: 日,初診,再診,合計,税抜,消費税,税込金額,...
  let dToday = { sho: 0, sai: 0, pt: 0, uri: 0 }
  let dMonth = { pt: 0, uri: 0 }
  if (monthlySales) {
    found++
    const rowDay = monthlySales.find((r) => r[0] === String(day))
    if (rowDay) dToday = { sho: num(rowDay[1]), sai: num(rowDay[2]), pt: num(rowDay[3]), uri: num(rowDay[6]) }
    const rowSum = monthlySales.find((r) => r[0] === '計')
    if (rowSum) dMonth = { pt: num(rowSum[3]), uri: num(rowSum[6]) }
  }

  // --- 日次統計から 当日の施術種別内訳（先頭ブロック: 施術種別,施術/カウンセリング/...）col7=合計売上 ---
  const bd: Record<string, number> = {}
  if (dailyStats) {
    found++
    for (const name of ['施術', 'カウンセリング', 'コース', '物販']) {
      const r = dailyStats.find((row) => row[0] === '施術種別' && row[1] === name)
      if (r) bd[name] = num(r[7])
    }
    // 当日売上が月次から取れない場合の保険（当日累計 合計 col7）
    if (dToday.uri === 0) {
      const r = dailyStats.find((row) => row[0] === '当日累計' && row[1] === '合計')
      if (r) dToday.uri = num(r[7])
    }
  }

  // --- 月次統計から 当年累計 合計 col7 ---
  let yearTotal = 0
  if (monthlyStats) {
    found++
    const r = monthlyStats.find((row) => row[0] === '当年累計' && row[1] === '合計')
    if (r) yearTotal = num(r[7])
  }

  const bdLine = Object.entries(bd).filter(([, v]) => v > 0).map(([k, v]) => `${k} ${yen(v)}`).join('／')

  const lines: string[] = [`💰 本日の売上｜${label}`, '', '■ 本日']
  lines.push(`・売上(税込)：${yen(dToday.uri)}`)
  lines.push(`・患者数：${dToday.pt}名（初診${dToday.sho} / 再診${dToday.sai}）`)
  if (bdLine) lines.push(`　└ ${bdLine}`)
  lines.push('', '■ 今月の累計')
  lines.push(`・売上：${yen(dMonth.uri)}`)
  lines.push(`・患者数：${dMonth.pt}名`)
  if (yearTotal) lines.push('', `（今年の累計：${yen(yearTotal)}）`)

  return { text: lines.join('\n'), found }
}

const TEST_NOTICE = '🧪【テスト送信・ご対応不要】これは動作確認のテストです。\n\n'

async function authorized(req: NextRequest): Promise<boolean> {
  const secret = process.env.CRON_SECRET
  if (secret && req.headers.get('authorization') === `Bearer ${secret}`) return true
  if (!secret) return true
  const auth = await requireAdmin(req)
  return auth.ok
}

async function handle(req: NextRequest) {
  if (!(await authorized(req))) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  const sp = req.nextUrl.searchParams
  // 日付指定（テスト用）: ?date=2026-07-16。省略時は当日(JST)
  const dateParam = sp.get('date')
  let ymd: string, ym: string, day: number, label: string
  if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
    const [y, m, d] = dateParam.split('-')
    ymd = `${y}${m}${d}`; ym = `${y}${m}`; day = Number(d)
    const w = ['日', '月', '火', '水', '木', '金', '土'][new Date(Date.UTC(Number(y), Number(m) - 1, Number(d))).getUTCDay()]
    label = `${Number(m)}月${Number(d)}日(${w})`
  } else {
    ({ ymd, ym, day, label } = todayJST())
  }

  const { text, found } = await buildMessage(ymd, ym, day, label)
  if (found === 0) return NextResponse.json({ ok: false, error: `該当日(${ymd})のCSVが未保存です` })

  // dry=1 は送信せず本文だけ返す（確認用）
  if (sp.get('dry') === '1') return NextResponse.json({ ok: true, dry: true, message: text })

  const channelId = await getSetting('lineworks_sales_channel_id')
  const botId = process.env.LINEWORKS_SHIFT_BOT_ID
  if (!channelId || !botId) return NextResponse.json({ ok: false, error: '売上通知グループ(channelId)が未設定です' })

  const finalText = sp.get('test') === '1' ? TEST_NOTICE + text : text
  await sendChannelMessage(channelId, finalText, botId)
  return NextResponse.json({ ok: true, sent: true })
}

export async function GET(req: NextRequest) {
  try { return await handle(req) } catch (e) { return NextResponse.json({ ok: false, error: String(e) }, { status: 500 }) }
}
export async function POST(req: NextRequest) {
  try { return await handle(req) } catch (e) { return NextResponse.json({ ok: false, error: String(e) }, { status: 500 }) }
}
