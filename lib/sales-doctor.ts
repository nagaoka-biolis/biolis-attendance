// ACUSIS「スタッフ別売上(Dr)」CSVの解析と、シフトとの突き合わせ。
//
// このCSVは2段ヘッダで、医師ごとに4列(金額/件数/人数/個数)が横に繰り返す形をしている。
//   1行目: 日付, 日次合計, 日次合計, 日次合計, (空), 佐々木Dr, 佐々木Dr, 佐々木Dr, 佐々木Dr, 今井Dr, ...
//   2行目: 日付, 金額, 件数, 人数, 個数, 金額, 件数, 人数, 個数, 金額, ...
//   3行目以降: 2026/07/01, "66,000", 3, 1, 0, ...
//   最終行: 総計
// つまり列1以降は4列ずつのブロックで、ブロック名は1行目の先頭セルから取れる。
//
// ファイル名の日付はエクスポートした日であって対象月ではない（7月分を8/1に出すと
// スタッフ別売上(Dr)_20260801.csv になる）。そのため対象月は必ず中身の日付から判定する。

export type DoctorCell = {
  amount: number // 金額(税込)
  cases: number // 件数
  patients: number // 人数
  items: number // 個数
}

export type DoctorSalesDay = {
  date: string // YYYY-MM-DD
  total: number // その日の日次合計(金額)
  byDoctor: Record<string, DoctorCell> // ACUSISのラベル(例 "今井Dr") → 実績
}

export type DoctorSalesCsv = {
  month: string // YYYY-MM（中身の日付から判定）
  doctors: string[] // ACUSISのラベル一覧（日次合計を除く）
  days: DoctorSalesDay[] // 実績のあった日のみ
  totals: Record<string, DoctorCell> // 「総計」行
}

// クオート対応CSVパーサ（sales-notify と同じ方針。BOM・カンマ入り数値に対応）
// keepIndent=true のときは1列目の先頭スペースを残す。科目別売上CSVは
// 字下げの深さで階層を表しているため、そこでは削ってはいけない。
export function parseCSV(text: string, keepIndent = false): string[][] {
  return text.split(/\r?\n/).map((line) => {
    const out: string[] = []
    let cur = ''
    let q = false
    for (let i = 0; i < line.length; i++) {
      const c = line[i]
      if (c === '"') {
        if (q && line[i + 1] === '"') {
          cur += '"'
          i++
        } else q = !q
      } else if (c === ',' && !q) {
        out.push(cur)
        cur = ''
      } else cur += c
    }
    out.push(cur)
    return out.map((s, i) => {
      const noBom = s.replace(/^﻿/, '')
      return keepIndent && i === 0 ? noBom.replace(/\s+$/, '') : noBom.trim()
    })
  })
}

const num = (s: string | undefined) => Number(String(s ?? '').replace(/[",]/g, '')) || 0

const TOTAL_LABEL = '日次合計'
const UNASSIGNED = '担当未割当'

// 「2026/07/01」→「2026-07-01」。日付行でなければ null。
function toIsoDate(s: string): string | null {
  const m = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/)
  if (!m) return null
  return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
}

export function parseDoctorSalesCSV(text: string): DoctorSalesCsv | null {
  const rows = parseCSV(text)
  if (rows.length < 3) return null

  // 1行目からブロック名を拾う。列1以降が4列1組。
  const header = rows[0]
  const blocks: { name: string; col: number }[] = []
  for (let col = 1; col < header.length; col += 4) {
    const name = header[col]
    if (!name) continue
    blocks.push({ name, col })
  }
  if (!blocks.some((b) => b.name === TOTAL_LABEL)) return null

  const doctors = blocks.filter((b) => b.name !== TOTAL_LABEL).map((b) => b.name)

  const cell = (row: string[], col: number): DoctorCell => ({
    amount: num(row[col]),
    cases: num(row[col + 1]),
    patients: num(row[col + 2]),
    items: num(row[col + 3]),
  })

  const days: DoctorSalesDay[] = []
  const totals: Record<string, DoctorCell> = {}

  for (const row of rows.slice(2)) {
    const head = row[0]
    if (!head) continue

    if (head === '総計') {
      for (const b of blocks) {
        if (b.name === TOTAL_LABEL) continue
        totals[b.name] = cell(row, b.col)
      }
      continue
    }

    const date = toIsoDate(head)
    if (!date) continue

    const byDoctor: Record<string, DoctorCell> = {}
    let total = 0
    for (const b of blocks) {
      const c = cell(row, b.col)
      if (b.name === TOTAL_LABEL) {
        total = c.amount
        continue
      }
      // 空欄だらけの行が多いので、実績のある医師だけ持つ
      if (c.amount || c.cases || c.patients || c.items) byDoctor[b.name] = c
    }
    // 売上ゼロの休診日は落とす
    if (total === 0 && Object.keys(byDoctor).length === 0) continue
    days.push({ date, total, byDoctor })
  }

  if (days.length === 0) return null
  const month = days[0].date.slice(0, 7)

  return { month, doctors, days, totals }
}

// --- シフトとの突き合わせ -------------------------------------------------

// ACUSISのラベルを、勤怠側の氏名と照合できる形に分解する。
//   "佐々木Dr"      → { surname: "佐々木", night: false }
//   "金Dr（夜）"    → { surname: "金",     night: true  }
//   "鑓水Dr(夜)"    → { surname: "鑓水",   night: true  }
//   "担当未割当"    → { unassigned: true }
export function normalizeDoctorLabel(label: string): {
  surname: string
  night: boolean
  unassigned: boolean
} {
  if (label === UNASSIGNED) return { surname: '', night: false, unassigned: true }
  const night = /[（(]\s*夜\s*[)）]/.test(label)
  const surname = label
    .replace(/[（(]\s*夜\s*[)）]/g, '')
    .replace(/\s*Dr\s*$/i, '')
    .replace(/医師\s*$/, '')
    .trim()
  return { surname, night, unassigned: false }
}

export type ShiftRow = {
  date: string
  user_id: string | null
  display_name: string | null
  category: string | null
  start_time: string | null
  end_time: string | null
}

export type DoctorSummary = {
  label: string // ACUSISのラベル
  surname: string // 姓
  night: boolean // 夜間枠か
  unassigned: boolean // 担当未割当か
  staffName: string | null // 勤怠側で一致した氏名（見つからなければ null）
  amount: number // 売上合計
  cases: number // 件数
  patients: number // 人数
  salesDays: number // 売上が立った日数
  workDays: number // シフト上の出勤日数
  perWorkDay: number // 出勤1日あたり売上（出勤日が0なら0）
  perPatient: number // 患者1人あたり単価
}

// 勤怠側の氏名から、その人に対応する姓を1つだけ決める。
//
// 単純な「氏名に姓が含まれるか」では破綻する。BiOLiSには「金先生」と「金子先生」が
// 両方いるため、"金子 太郎" は "金" も含んでしまい、金Dr の売上が金子先生の
// 出勤日に紐付いてしまう。そこで **候補の中で最も長く一致した姓だけを採用** する。
function bestSurname(name: string | null | undefined, surnames: string[]): string | null {
  if (!name) return null
  const flat = name.replace(/\s+/g, '')
  let best: string | null = null
  for (const s of surnames) {
    if (!s || !flat.includes(s)) continue
    if (!best || s.length > best.length) best = s
  }
  return best
}

export function summarizeByDoctor(
  csv: DoctorSalesCsv,
  shifts: ShiftRow[],
  nameById?: Map<string, string>
): DoctorSummary[] {
  // 医師のシフトだけを対象にする（category が Dr のもの）
  const drShifts = shifts.filter((s) => (s.category ?? '') === 'Dr')

  // CSVに出てくる姓の一覧（「金」と「金子」の取り違えを防ぐための候補集合）
  const surnames = csv.doctors
    .map((l) => normalizeDoctorLabel(l).surname)
    .filter((s) => s.length > 0)

  // シフト1行 → その行が誰の姓に当たるかを先に確定させる
  const shiftSurname = new Map<ShiftRow, string | null>()
  for (const s of drShifts) {
    const formal = s.user_id ? nameById?.get(s.user_id) : undefined
    shiftSurname.set(s, bestSurname(formal, surnames) ?? bestSurname(s.display_name, surnames))
  }

  return csv.doctors
    .map((label) => {
      const { surname, night, unassigned } = normalizeDoctorLabel(label)

      let amount = 0
      let cases = 0
      let patients = 0
      let salesDays = 0
      for (const d of csv.days) {
        const c = d.byDoctor[label]
        if (!c) continue
        amount += c.amount
        cases += c.cases
        patients += c.patients
        if (c.amount) salesDays++
      }

      // 出勤日数（同じ日に複数行あっても1日と数える）
      const workDates = new Set<string>()
      let staffName: string | null = null
      if (!unassigned) {
        for (const s of drShifts) {
          if (shiftSurname.get(s) !== surname) continue
          workDates.add(s.date)
          if (!staffName) {
            staffName = (s.user_id ? nameById?.get(s.user_id) : undefined) ?? s.display_name ?? null
          }
        }
      }
      const workDays = workDates.size

      return {
        label,
        surname,
        night,
        unassigned,
        staffName,
        amount,
        cases,
        patients,
        salesDays,
        workDays,
        perWorkDay: workDays ? Math.round(amount / workDays) : 0,
        perPatient: patients ? Math.round(amount / patients) : 0,
      }
    })
    .sort((a, b) => b.amount - a.amount)
}

// 昼枠と夜枠を1人にまとめた集計。
// 「鑓水Dr」と「鑓水Dr(夜)」は同じ先生なので、出勤日あたりの効率を見るときは
// 合算しないと分母（出勤日数）が重複して意味を持たない。
export function summarizeByPerson(rows: DoctorSummary[]): DoctorSummary[] {
  const merged = new Map<string, DoctorSummary>()
  for (const r of rows) {
    const key = r.unassigned ? '__unassigned__' : r.surname
    const cur = merged.get(key)
    if (!cur) {
      merged.set(key, { ...r, label: r.unassigned ? r.label : r.surname, night: false })
      continue
    }
    cur.amount += r.amount
    cur.cases += r.cases
    cur.patients += r.patients
    cur.salesDays = Math.max(cur.salesDays, r.salesDays)
    cur.workDays = Math.max(cur.workDays, r.workDays) // 同一人物なので出勤日は重複させない
    cur.staffName = cur.staffName ?? r.staffName
  }
  return [...merged.values()]
    .map((r) => ({
      ...r,
      perWorkDay: r.workDays ? Math.round(r.amount / r.workDays) : 0,
      perPatient: r.patients ? Math.round(r.amount / r.patients) : 0,
    }))
    .sort((a, b) => b.amount - a.amount)
}

// 日ごとの「出勤したDrの人数 × その日の売上」。
// 「Drが2人いた日と1人だった日で売上はどう違うか」に答えるための材料。
export function summarizeByDay(
  csv: DoctorSalesCsv,
  shifts: ShiftRow[]
): { date: string; total: number; drCount: number; doctors: string[] }[] {
  const drByDate = new Map<string, Set<string>>()
  for (const s of shifts) {
    if ((s.category ?? '') !== 'Dr') continue
    const set = drByDate.get(s.date) ?? new Set<string>()
    set.add(s.display_name ?? s.user_id ?? '')
    drByDate.set(s.date, set)
  }
  return csv.days.map((d) => ({
    date: d.date,
    total: d.total,
    drCount: drByDate.get(d.date)?.size ?? 0,
    doctors: Object.keys(d.byDoctor),
  }))
}
