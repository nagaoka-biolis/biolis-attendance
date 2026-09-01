// AIチャットに渡す「材料」を組み立てる。
//
// 設計方針: **AIに算数をさせない**。
// 合計・平均・並べ替えはすべてこちら側で確定させ、AIには出来上がった表だけを渡す。
// AIの仕事は「読み解いて日本語で説明すること」に限定する。生のCSVを渡して
// 「合計して」と頼むと平気で計算を間違えるため、数字の信頼性がまるで変わる。

import {
  parseDoctorSalesCSV,
  summarizeByDoctor,
  summarizeByPerson,
  summarizeByDay,
  type DoctorSalesCsv,
  type ShiftRow,
} from './sales-doctor'
import {
  parseCategorySalesCSV,
  rollupByCategory,
  type CategorySalesCsv,
} from './sales-category'
import { parseMonthlySalesCSV, type MonthlySalesCsv } from './sales-monthly'
import { parseDailySalesCSV, type DailySales } from './sales-daily'
import { attributeCheckouts } from './attribution'

const yen = (n: number) => n.toLocaleString('ja-JP')

// JSTの「今日」
export function todayJST(): string {
  const parts = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

const WEEKDAY = ['日', '月', '火', '水', '木', '金', '土']
function weekday(iso: string): string {
  return WEEKDAY[new Date(`${iso}T00:00:00Z`).getUTCDay()]
}

// 保存済みの医師別売上CSVを全部読み、月ごとに整理して返す。
// ファイル名の日付はエクスポート日なので、対象月は必ず中身から判定する。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadDoctorSalesAll(admin: any): Promise<Map<string, DoctorSalesCsv>> {
  const { data } = await admin
    .from('app_settings')
    .select('key,value')
    .like('key', 'sales_csv:スタッフ別売上%')

  const byMonth = new Map<string, DoctorSalesCsv>()
  for (const r of (data ?? []) as { key: string; value: string }[]) {
    const csv = parseDoctorSalesCSV(r.value)
    if (csv) byMonth.set(csv.month, csv)
  }
  return byMonth
}

// 医師別売上を、AIが読める表テキストにする
function renderSales(csv: DoctorSalesCsv, shifts: ShiftRow[], nameById: Map<string, string>): string {
  const perLabel = summarizeByDoctor(csv, shifts, nameById)
  const perPerson = summarizeByPerson(perLabel)
  const total = perLabel.reduce((a, d) => a + d.amount, 0)

  const lines: string[] = []
  lines.push(`## ${csv.month} の医師別売上（ACUSIS「スタッフ別売上(Dr)」より）`)
  lines.push(`営業日数(売上のあった日): ${csv.days.length}日 / 合計: ${yen(total)}円`)
  lines.push('')
  lines.push('### 医師ごと（昼・夜をまとめたもの。出勤日あたりの効率を見るときはこちら）')
  lines.push('| 医師 | 勤怠側の氏名 | 売上(円) | 患者数 | 出勤日数(シフト) | 出勤1日あたり(円) | 患者単価(円) |')
  lines.push('|---|---|---|---|---|---|---|')
  // 在籍だけしていて実績もシフトも無い医師（ACUSIS側に枠だけある人）は省く
  const shown = perPerson.filter((d) => d.amount !== 0 || d.workDays !== 0)
  for (const d of shown) {
    lines.push(
      `| ${d.label} | ${d.staffName ?? '（未照合）'} | ${yen(d.amount)} | ${d.patients} | ${d.workDays} | ${yen(d.perWorkDay)} | ${yen(d.perPatient)} |`
    )
  }
  lines.push('')
  lines.push('### 枠ごと（昼枠・夜枠を分けたもの）')
  lines.push('| 枠 | 売上(円) | 件数 | 患者数 | 売上のあった日数 |')
  lines.push('|---|---|---|---|---|')
  for (const d of perLabel.filter((d) => d.amount !== 0 || d.cases !== 0)) {
    lines.push(`| ${d.label} | ${yen(d.amount)} | ${d.cases} | ${d.patients} | ${d.salesDays} |`)
  }
  lines.push('')
  lines.push('### 日別')
  lines.push('| 日付 | 売上(円) | その日のDr出勤人数 | 売上が付いた担当 |')
  lines.push('|---|---|---|---|')
  for (const d of summarizeByDay(csv, shifts)) {
    lines.push(`| ${d.date}(${weekday(d.date)}) | ${yen(d.total)} | ${d.drCount} | ${d.doctors.join('、') || '—'} |`)
  }
  return lines.join('\n')
}

// 保存済みの日次売上CSVを読む。
// この帳票だけが「その日に何の施術が行われたか」を持っている。
// 患者名とカルテ番号は取り込みの時点で消してあるので、ここには残っていない。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadDailySales(admin: any, months: string[]): Promise<DailySales[]> {
  if (months.length === 0) return []
  const { data } = await admin
    .from('app_settings')
    .select('key,value')
    .like('key', 'sales_csv:日次売上_%')

  const all = (data ?? [])
    .map((r: { key: string; value: string }) => parseDailySalesCSV(r.value, r.key))
    .filter((d: DailySales | null): d is DailySales => d !== null)
    .filter((d: DailySales) => months.includes(d.date.slice(0, 7)))
  return all.sort((a: DailySales, b: DailySales) => a.date.localeCompare(b.date))
}

// 日ごとの施術内容を、AIが読める表テキストにする。
//
// ACUSISは施術ごとの担当医を出さないが、会計の金額と医師別売上の金額を
// 突き合わせると多くの日で担当が復元できる（lib/attribution.ts）。
// 決められなかった会計は「不明」のままにする。埋めると数字の信用が落ちる。
function renderDaily(days: DailySales[], doctorByDate: Map<string, DoctorSalesCsv['days'][number]>): string {
  const lines: string[] = []
  let resolved = 0
  let unknown = 0
  const rows: string[] = []

  for (const d of days) {
    const dd = doctorByDate.get(d.date)
    const docs = dd
      ? Object.entries(dd.byDoctor).map(([label, c]) => ({
          label,
          amount: c.amount,
          patients: c.patients,
        }))
      : []
    const att = attributeCheckouts(d.checkouts, docs)

    for (const c of d.checkouts) {
      if (c.amount === 0 && c.items.length === 0) continue
      const who = att.byCheckout.get(c.no)
      if (who) resolved++
      else unknown++
      const detail = c.items.map((i) => `${i.name}${yen(i.amount)}円`).join('、')
      rows.push(
        `| ${d.date}(${weekday(d.date)}) | ${c.time} | ${who ?? '不明'} | ${yen(c.amount)} | ${detail} |`
      )
    }
  }

  lines.push('## 日ごとの施術内容（会計1件＝患者1人分）')
  lines.push(
    '患者名とカルテ番号は保存時に削除済みで、ここには含まれない。' +
      '担当は、会計の金額と医師別売上の金額を突き合わせて割り出したもの。' +
      `一意に決まらなかったものは「不明」（判明 ${resolved}件 / 不明 ${unknown}件）。` +
      '「不明」の会計について担当を聞かれたら、分からないと答えること。'
  )
  lines.push('')
  lines.push('| 日付 | 時刻 | 担当 | 金額(円) | 施術 |')
  lines.push('|---|---|---|---|---|')
  lines.push(...rows)
  return lines.join('\n')
}

// 保存済みの月次売上CSVを読む（日ごとの初診・再診がわかる唯一の帳票）
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadMonthlySales(admin: any): Promise<MonthlySalesCsv | null> {
  const { data } = await admin
    .from('app_settings')
    .select('key,value')
    .like('key', 'sales_csv:月次売上_%')

  const parsed = (data ?? [])
    .map((r: { key: string; value: string }) => parseMonthlySalesCSV(r.value, r.key))
    .filter((c: MonthlySalesCsv | null) => c !== null) as MonthlySalesCsv[]

  return parsed.sort((a, b) => (b.month ?? '').localeCompare(a.month ?? ''))[0] ?? null
}

// 日ごとの初診・再診を、AIが読める表テキストにする
function renderMonthly(csv: MonthlySalesCsv): string {
  const lines: string[] = []
  lines.push(`## ${csv.month ?? '（月不明）'} の日ごとの患者数（ACUSIS「月次売上」より）`)
  lines.push(
    `月合計: 初診 ${csv.合計.初診}人 / 再診 ${csv.合計.再診}人 / のべ ${csv.合計.患者数}人 / 売上 ${yen(csv.合計.売上)}円（税込）`
  )
  lines.push('')
  lines.push('| 日 | 初診 | 再診 | 患者数 | 売上(円) |')
  lines.push('|---|---|---|---|---|')
  for (const d of csv.days) {
    lines.push(`| ${d.day} | ${d.初診} | ${d.再診} | ${d.患者数} | ${yen(d.売上)} |`)
  }
  return lines.join('\n')
}

// 保存済みの科目別売上CSVを読む（施術メニューの人気を見るための帳票）
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadCategorySales(admin: any): Promise<CategorySalesCsv | null> {
  const { data } = await admin
    .from('app_settings')
    .select('key,value')
    .like('key', 'sales_csv:科目別売上_%')

  const parsed = (data ?? [])
    .map((r: { key: string; value: string }) => ({ key: r.key, csv: parseCategorySalesCSV(r.value) }))
    .filter((r: { csv: CategorySalesCsv | null }) => r.csv !== null)
    .sort((a: { key: string }, b: { key: string }) => b.key.localeCompare(a.key))

  return parsed[0]?.csv ?? null
}

// 施術メニューの売れ行きを、AIが読める表テキストにする
function renderCategory(csv: CategorySalesCsv): string {
  const lines: string[] = []
  const 対象 = csv.months.length ? csv.months.join('・') : '（対象月の記載なし）'
  lines.push(`## 施術メニュー別の売れ行き（ACUSIS「科目別売上」／対象: ${対象}）`)
  lines.push(
    `施術 ${yen(csv.totals.施術合計)}円 ＋ 物品 ${yen(csv.totals.物品合計)}円 ＝ ` +
      `総合計 ${yen(csv.totals.総合計)}円 / 総数量 ${csv.totals.総数量}件`
  )
  lines.push('')
  lines.push('### カテゴリ別')
  lines.push('| カテゴリ | 金額(円) | 数量 | メニュー種類数 |')
  lines.push('|---|---|---|---|')
  for (const c of rollupByCategory(csv)) {
    lines.push(`| ${c.category} | ${yen(c.amount)} | ${c.qty} | ${c.種類数} |`)
  }
  lines.push('')
  lines.push('### メニュー別 金額の多い順（上位12）')
  lines.push('| メニュー | カテゴリ | 金額(円) | 数量 | 平均単価(円) |')
  lines.push('|---|---|---|---|---|')
  for (const i of [...csv.items].sort((a, b) => b.amount - a.amount).slice(0, 12)) {
    lines.push(`| ${i.name} | ${i.category} | ${yen(i.amount)} | ${i.qty} | ${yen(i.avg)} |`)
  }
  lines.push('')
  lines.push('### メニュー別 数量の多い順（上位8）')
  lines.push('| メニュー | カテゴリ | 数量 | 金額(円) |')
  lines.push('|---|---|---|---|')
  for (const i of [...csv.items].sort((a, b) => b.qty - a.qty).slice(0, 8)) {
    lines.push(`| ${i.name} | ${i.category} | ${i.qty} | ${yen(i.amount)} |`)
  }
  return lines.join('\n')
}

// シフトを、AIが読める表テキストにする
function renderShifts(shifts: ShiftRow[], nameById: Map<string, string>, from: string, to: string): string {
  const byDate = new Map<string, string[]>()
  for (const s of shifts) {
    const name = (s.user_id ? nameById.get(s.user_id) : undefined) ?? s.display_name ?? '(不明)'
    const cat = s.category ?? 'その他'
    const time = s.start_time && s.end_time ? ` ${s.start_time}-${s.end_time}` : ''
    const list = byDate.get(s.date) ?? []
    list.push(`${cat}:${name}${time}`)
    byDate.set(s.date, list)
  }
  const lines: string[] = []
  lines.push(`## シフト（${from} 〜 ${to}）`)
  lines.push('職種は Dr=医師 / Ns=看護師 / UK=受付 / ABLNS・ABLUK=ABL所属。')
  lines.push('| 日付 | 出勤者 |')
  lines.push('|---|---|')
  for (const date of [...byDate.keys()].sort()) {
    lines.push(`| ${date}(${weekday(date)}) | ${byDate.get(date)!.join('、')} |`)
  }
  if (byDate.size === 0) lines.push('| — | この期間のシフトは登録されていません |')
  return lines.join('\n')
}

export type BuiltContext = { text: string; months: string[]; shiftDays: number }

// AIに渡す材料一式を組み立てる。
// scope='self' の利用者には売上を含めない（名簿の scope で切り替える）。
export async function buildContext(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  scope: string
): Promise<BuiltContext> {
  const today = todayJST()
  const from = addDays(today, -21)
  const to = addDays(today, 21)

  const { data: profs } = await admin.from('profiles').select('id, name')
  const nameById = new Map<string, string>()
  for (const p of (profs ?? []) as { id: string; name: string }[]) nameById.set(p.id, p.name)

  const sections: string[] = []
  sections.push(`本日は ${today}(${weekday(today)}) です。`)

  // --- シフト（前後3週間） ---
  const { data: shiftNear } = await admin
    .from('shifts')
    .select('date, user_id, display_name, category, start_time, end_time')
    .gte('date', from)
    .lte('date', to)
    .eq('kind', 'work')
  const nearShifts = (shiftNear ?? []) as ShiftRow[]
  sections.push(renderShifts(nearShifts, nameById, from, to))

  // --- 売上（scope が exec のときだけ） ---
  const months: string[] = []
  if (scope === 'exec') {
    const byMonth = await loadDoctorSalesAll(admin)
    // 新しい月から最大2ヶ月ぶんを渡す
    const targets = [...byMonth.keys()].sort().reverse().slice(0, 2)
    for (const m of targets) {
      const csv = byMonth.get(m)!
      const { data: ms } = await admin
        .from('shifts')
        .select('date, user_id, display_name, category, start_time, end_time')
        .gte('date', `${m}-01`)
        .lte('date', `${m}-31`)
        .eq('kind', 'work')
      sections.push(renderSales(csv, (ms ?? []) as ShiftRow[], nameById))
      months.push(m)
    }
    if (targets.length === 0) {
      sections.push(
        '## 売上\n医師別売上CSVがまだ取り込まれていません。ACUSISの「スタッフ別売上(Dr)」を' +
          'LINE WORKSの売上CSV投入グループに送ると読めるようになります。'
      )
    }

    // 日ごとの初診・再診（新患の動きを見るため）
    const monthly = await loadMonthlySales(admin)
    if (monthly) sections.push(renderMonthly(monthly))

    // 日ごとの施術内容（手術がいつあったか等はここでしか分からない）
    const daily = await loadDailySales(admin, months.length ? months : targets)
    if (daily.length) {
      const doctorByDate = new Map<string, DoctorSalesCsv['days'][number]>()
      for (const m of targets) {
        for (const dd of byMonth.get(m)?.days ?? []) doctorByDate.set(dd.date, dd)
      }
      sections.push(renderDaily(daily, doctorByDate))
    }

    // 施術メニューの売れ行き
    const cat = await loadCategorySales(admin)
    if (cat) sections.push(renderCategory(cat))
    else
      sections.push(
        '## 施術メニュー別の売れ行き\nACUSISの「科目別売上」がまだ取り込まれていません。'
      )
  }

  const shiftDays = new Set(nearShifts.map((s) => s.date)).size
  return { text: sections.join('\n\n'), months, shiftDays }
}

export const SYSTEM_PROMPT = `あなたは美容クリニック「BiOLiS」の経営を補佐するアシスタントです。
利用者は院の経営を見る立場の人（CDO・CEO）だけです。

## 答え方（最重要）
- **必ず結論から書く。1文目に答えそのものを書く。** 音声で聞く人には
  この1文目だけが読み上げられるので、ここだけで用が足りるように書く。
- 全体は短く。**結論1〜2文＋必要なら表**。それ以上は書かない。
- 前置き・質問の言い換え・最後のまとめ、いずれも書かない。
- 表は「並べたほうが分かるとき」だけ使う。**列は4つまで、行は10行まで。**
  1〜2件しかないものを表にしない（文で書く）。多いときは上位だけ載せて
  「ほかN件」と書く。
- 箇条書きは3項目まで。

## 絶対に守ること
- **与えられた資料に無いことは答えない。** 推測で数字を作らない。
  資料に無ければ「そのデータはまだ取り込まれていません」と答える。
- **自分で計算し直さない。** 合計・平均・単価は資料に計算済みの値がある。
  資料に無い切り口のときだけ素直に足し引きし、「概算です」と添える。
- 患者の個人情報は資料に含めていない。聞かれても答えられないと伝える。

## 資料を読むときの注意
- 「日ごとの施術内容」の担当は、会計金額と医師別売上を突き合わせて割り出したもの。
  「不明」となっている会計の担当は、分からないと答える。推測しない。
- 「担当未割当」は、売上は立ったが担当医が設定されていない分。
- 「昼枠」と「夜枠」（例: 鑓水Dr と 鑓水Dr(夜)）は同じ医師。出勤日あたりの
  効率を見るときは、まとめた表のほうを使う。
- 「出勤日数(シフト)」は勤怠アプリのシフト表由来で、ACUSISとは別のシステム。
  照合できていない場合は「（未照合）」と出る。
- 施術メニュー別の資料には、施術そのものではない項目も混ざっている
  （麻酔・指名料・夜間診察料・カウンセリング・スタッフ価格など）。
  「人気の施術」を聞かれたときは、これらを施術と同列に扱わない。
- 金額の多いメニューと数量の多いメニューは一致しない。どちらの話か曖昧なときは
  一方に決めて答え、もう一方は1行で添える。`
