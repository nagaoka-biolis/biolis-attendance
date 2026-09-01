// ACUSIS「月次売上」CSVの解析。
// 日ごとの患者数（初診・再診）と売上が1行ずつ並ぶ。医師別売上には初診/再診の
// 区別が無いので、新患の動きを見るにはこの帳票が要る。
//
//   1行目: 日,患者数,患者数,患者数,合計,合計,合計,10%,…
//   2行目: 日,初診,再診,合計,税抜金額,消費税,税込金額,…
//   3行目〜: 1,1,0,1,"8,910",890,"9,800",…
//   最終行: 計,…
//
// 対象月はファイル内に書かれていないため、キー名（月次売上_202608）から受け取る。

import { parseCSV } from './sales-doctor'

export type MonthlyDay = {
  day: number
  初診: number
  再診: number
  患者数: number
  売上: number // 税込
}

export type MonthlySalesCsv = {
  month: string | null // 'YYYY-MM'（キー名から判定できた場合）
  days: MonthlyDay[] // 患者か売上があった日のみ
  合計: { 初診: number; 再診: number; 患者数: number; 売上: number }
}

const num = (s: string | undefined) => Number(String(s ?? '').replace(/[",]/g, '')) || 0

export function parseMonthlySalesCSV(text: string, key?: string): MonthlySalesCsv | null {
  const rows = parseCSV(text)
  if (rows.length < 3) return null
  // 2行目が「日,初診,再診,合計,税抜金額,…」であることを確かめる
  const head = rows[1] ?? []
  if (head[1] !== '初診' || head[2] !== '再診') return null

  const days: MonthlyDay[] = []
  const 合計 = { 初診: 0, 再診: 0, 患者数: 0, 売上: 0 }

  for (const r of rows.slice(2)) {
    const first = r[0]
    if (!first) continue
    const row = { 初診: num(r[1]), 再診: num(r[2]), 患者数: num(r[3]), 売上: num(r[6]) }
    if (first === '計') {
      Object.assign(合計, row)
      continue
    }
    const day = Number(first)
    if (!Number.isInteger(day) || day < 1 || day > 31) continue
    if (row.患者数 === 0 && row.売上 === 0) continue
    days.push({ day, ...row })
  }

  if (days.length === 0) return null

  const m = key?.match(/(\d{4})(\d{2})/)
  return { month: m ? `${m[1]}-${m[2]}` : null, days, 合計 }
}
