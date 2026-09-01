// ACUSIS「日次売上」CSVの解析と、患者情報の除去。
//
// この帳票だけが「その日に何の施術が行われたか」を持っている。
// 医師別売上・科目別売上では月単位でしか分からないため、
// 「8月に手術はいつあったか」「あの日は何が売れたのか」に答えるには必須。
//
// ⚠️ 明細に **患者名とカルテ番号** が含まれる。
//    取り込み時点で消す（maskDailySalesCSV）。DBに保存する時点で既に無い状態にし、
//    AIにも当然渡らないようにする。施術内容・数量・金額だけを残す。
//
// 形:
//   （先頭に税率別の合計ブロック）
//   当日,初診,再診,合計,売上,…
//   No,時間,カルテNO,患者名,施術区分,施術内容,数量,小計(税込),小計(税抜),…
//   1,10:36,00037,山田花子,,,,,,,880000,0     ← 会計の行
//   ,,,,施,ハイブリッド豊胸,1,330000,300000,…  ← 施術の行

import { parseCSV } from './sales-doctor'

const num = (s: string | undefined) => Number(String(s ?? '').replace(/[",]/g, '')) || 0

// 明細ヘッダ（No,時間,カルテNO,患者名,…）の行を探す
function detailHeaderIndex(rows: string[][]): number {
  return rows.findIndex((r) => r[2] === 'カルテNO' && r[3] === '患者名')
}

// 患者名・カルテ番号を落としたCSVを返す。取り込み時に必ず通す。
export function maskDailySalesCSV(text: string): string {
  const rows = parseCSV(text)
  const h = detailHeaderIndex(rows)
  if (h < 0) return text // 想定と違う形なら触らない

  const quote = (s: string) => (/[",]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)
  return rows
    .map((r, i) => {
      if (i > h && r.length > 3) {
        const c = [...r]
        c[2] = '' // カルテNO
        c[3] = '' // 患者名
        return c.map(quote).join(',')
      }
      return r.map(quote).join(',')
    })
    .join('\n')
}

export type DailyItem = { name: string; qty: number; amount: number }

// 会計1件（患者1人分の精算）。担当医の割り出しに使う。
export type Checkout = { no: string; time: string; amount: number; items: DailyItem[] }

export type DailySales = {
  date: string // YYYY-MM-DD
  初診: number
  再診: number
  患者数: number
  売上: number
  items: DailyItem[] // 金額の大きい順
  checkouts: Checkout[] // 会計ごと（この単位でなら担当医を割り出せる）
}

// key は 'sales_csv:日次売上_20260821' 形式。対象日はここから取る。
export function parseDailySalesCSV(text: string, key: string): DailySales | null {
  const m = key.match(/(\d{4})(\d{2})(\d{2})/)
  if (!m) return null
  const date = `${m[1]}-${m[2]}-${m[3]}`

  const rows = parseCSV(text)
  const h = detailHeaderIndex(rows)
  if (h < 0) return null

  // 「当日」行から患者数と売上
  const today = rows.find((r) => r[0] === '当日')
  const 初診 = num(today?.[1])
  const 再診 = num(today?.[2])
  const 患者数 = num(today?.[3])
  const 売上 = num(today?.[4])

  // 明細は「会計の行（No・時間・金額）」に「施術の行」がぶら下がる形。
  // 会計単位でまとめておくと、医師別売上の金額と突き合わせて担当を割り出せる。
  const checkouts: Checkout[] = []
  const acc = new Map<string, DailyItem>()
  for (const r of rows.slice(h + 1)) {
    if (r[0] && /^\d+$/.test(r[0])) {
      checkouts.push({ no: r[0], time: r[1] ?? '', amount: num(r[10]), items: [] })
      continue
    }
    if (r[4] !== '施' || !r[5]) continue
    const item = {
      name: r[5].replace(/　/g, ' ').trim(),
      qty: num(r[6]) || 1,
      amount: num(r[7]),
    }
    checkouts[checkouts.length - 1]?.items.push(item)
    const cur = acc.get(item.name) ?? { name: item.name, qty: 0, amount: 0 }
    cur.qty += item.qty
    cur.amount += item.amount
    acc.set(item.name, cur)
  }
  const items = [...acc.values()].sort((a, b) => b.amount - a.amount)

  if (患者数 === 0 && items.length === 0) return null
  return { date, 初診, 再診, 患者数, 売上, items, checkouts }
}
