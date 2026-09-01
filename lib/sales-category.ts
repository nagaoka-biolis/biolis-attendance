// ACUSIS「科目別売上」CSVの解析。
// 何のメニューが、いくつ、いくらで売れたか＝施術の人気を見るための帳票。
//
// ⚠️ この帳票は**出力形式が2種類ある**（実物で確認済み）。両方に対応する。
//
// 形式A（例: 科目別売上_202607-202608.csv）… 平たい表。階層が列で表現される
//   管理名称,種別,１階層,…,６階層,,金額,数量,平均単価,…
//   佐々木医師　初診カウンセリング,施術,カウンセリング,…,,"5,500",2,"2,750",…
//
// 形式B（例: 科目別売上_202608-202608.csv）… 字下げで階層を表現するツリー
//   管理名称,,合計,合計,合計,2026/08,2026/08
//   管理名称,,金額,数量,平均単価,金額,数量
//   ,施術合計,"4,442,375",274,"16,213",…
//       施術,,,,,,                      ← 字下げ4 = 種別の見出し（金額なし）
//       トリビュー,,"420,800",29,…       ← 字下げ4 = カテゴリ
//         ボトックス,,"39,600",6,…       ← 字下げ6 = サブカテゴリ
//           【…】表情筋ボトックス(1976),,"22,000",4,… ← 字下げ8 = メニュー（末端）
//
// どちらも「合計」列（全期間の合計）だけを使う。月ごとの列は本数が変わるため。

import { parseCSV } from './sales-doctor'

export type CategoryItem = {
  name: string // メニュー名
  category: string // カテゴリ（カウンセリング / 麻酔 / ボトックス / キャンペーン など）
  amount: number // 金額
  qty: number // 数量
  avg: number // 平均単価
}

export type CategorySalesCsv = {
  months: string[] // このファイルが対象にしている月（例 ['2026-08']）
  items: CategoryItem[] // 末端のメニューだけ（親カテゴリは含めない＝二重計上を防ぐ）
  totals: { 施術合計: number; 物品合計: number; 総合計: number; 総数量: number }
}

const num = (s: string | undefined) => Number(String(s ?? '').replace(/[",]/g, '')) || 0
const clean = (s: string) => s.trim()

function monthsFrom(row: string[] | undefined): string[] {
  return [...new Set((row ?? []).filter((c) => /^\d{4}\/\d{1,2}$/.test(c.trim())))].map((c) => {
    const [y, m] = c.trim().split('/')
    return `${y}-${m.padStart(2, '0')}`
  })
}

export function parseCategorySalesCSV(text: string): CategorySalesCsv | null {
  const rows = parseCSV(text, true)
  if (rows.length < 4) return null

  const headIdx = rows.findIndex((r) => clean(r[0]) === '管理名称' && r.some((c) => c === '金額'))
  if (headIdx < 0) return null
  const head = rows[headIdx]
  const isFlat = clean(head[1]) === '種別' // 形式A かどうか

  const amountCol = head.findIndex((c) => c === '金額')
  const qtyCol = head.findIndex((c) => c === '数量')
  const avgCol = head.findIndex((c) => c === '平均単価')
  if (amountCol < 0 || qtyCol < 0) return null

  const totals = { 施術合計: 0, 物品合計: 0, 総合計: 0, 総数量: 0 }
  const body = rows.slice(headIdx + 1)

  // 合計行のラベル位置は形式で違う（Aは8列目、Bは2列目）
  for (const r of body) {
    const label = isFlat ? clean(r[8] ?? '') : clean(r[1] ?? '')
    if (label === '施術合計') totals.施術合計 = num(r[amountCol])
    else if (label === '物品合計') totals.物品合計 = num(r[amountCol])
    else if (label === '総合計') {
      totals.総合計 = num(r[amountCol])
      totals.総数量 = num(r[qtyCol])
    }
  }

  const items: CategoryItem[] = []

  if (isFlat) {
    // 形式A: 1行1メニュー。カテゴリは「１階層」列。
    for (const r of body) {
      const name = clean(r[0])
      if (!name || name === '管理名称') continue
      const amount = num(r[amountCol])
      const qty = num(r[qtyCol])
      if (amount === 0 && qty === 0) continue
      items.push({
        name,
        category: clean(r[2]) || 'その他',
        amount,
        qty,
        avg: avgCol >= 0 ? num(r[avgCol]) : qty ? Math.round(amount / qty) : 0,
      })
    }
  } else {
    // 形式B: 字下げの深さで親子を判定する。
    // 「子を持たない行」＝メニュー（末端）だけを拾う。親も拾うと二重計上になる。
    const nodes = body
      .filter((r) => r[0] && r[0].trim() !== '' && clean(r[0]) !== '管理名称')
      .map((r) => ({
        indent: r[0].length - r[0].trimStart().length,
        name: clean(r[0]),
        amount: num(r[amountCol]),
        qty: num(r[qtyCol]),
        avg: avgCol >= 0 ? num(r[avgCol]) : 0,
      }))

    const CATEGORY_INDENT = Math.min(...nodes.map((n) => n.indent))

    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i]
      const next = nodes[i + 1]
      const hasChild = !!next && next.indent > n.indent
      if (hasChild) continue // 親カテゴリは飛ばす
      if (n.amount === 0 && n.qty === 0) continue

      // 直近の「カテゴリ（最も浅い字下げで、かつ金額を持つ行）」を遡って探す
      let category = n.name
      for (let k = i; k >= 0; k--) {
        if (nodes[k].indent === CATEGORY_INDENT && (nodes[k].amount || nodes[k].qty)) {
          category = nodes[k].name
          break
        }
      }
      items.push({
        name: n.name,
        category,
        amount: n.amount,
        qty: n.qty,
        avg: n.avg || (n.qty ? Math.round(n.amount / n.qty) : 0),
      })
    }
  }

  if (items.length === 0) return null
  return { months: monthsFrom(rows[0]), items, totals }
}

// カテゴリごとにまとめる
export function rollupByCategory(
  csv: CategorySalesCsv
): { category: string; amount: number; qty: number; 種類数: number }[] {
  const m = new Map<string, { category: string; amount: number; qty: number; 種類数: number }>()
  for (const it of csv.items) {
    const cur = m.get(it.category) ?? { category: it.category, amount: 0, qty: 0, 種類数: 0 }
    cur.amount += it.amount
    cur.qty += it.qty
    cur.種類数++
    m.set(it.category, cur)
  }
  return [...m.values()].sort((a, b) => b.amount - a.amount)
}
