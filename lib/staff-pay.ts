// 時給スタッフの基本給計算（純粋関数・DB非依存）。
// ルールの出所: vault/人事給与/給与ルール_全社まとめ.md（2026-09-17）
//
// - 基本給 ＝ 時給 × 実労働時間（休憩控除後）。日数ではなく時間数。
// - 打刻時刻は「分単位に切り捨て」て算定する。→ 各打刻を分に丸め落として計算する。
// - 割増：法定時間外（＝1日8時間=480分 超）25% ／ 深夜（22時〜翌5時）25%。
//   所定時間外0%だが所定=法定8hなので実質「8h超が25%」。
// - 金額の丸めは「月次で分を積み上げてから1回だけ」行う（日ごとに丸めると誤差が出るため）。

const MIN_PER_DAY = 1440

// ISO文字列を JST の「エポックからの分」に直す（秒は切り捨て＝分単位切り捨て）。
function jstEpochMin(iso: string): number {
  return Math.floor((new Date(iso).getTime() + 9 * 60 * 60 * 1000) / 60000)
}

// 勤務区間 [inISO, outISO] が深夜帯（22:00〜翌5:00）と重なる分数。
// 出勤日の 00:00(JST) を基準に、当夜 [22:00,29:00] と前夜 [-2:00,5:00] の両方で重なりを取る。
// ※夜間の休憩は稀なため、深夜分から休憩は差し引かない（過大側に僅少・要留意）。
export function nightOverlapMin(inISO: string, outISO: string): number {
  const inMin = jstEpochMin(inISO)
  const outMin = jstEpochMin(outISO)
  if (outMin <= inMin) return 0
  const midnight = Math.floor(inMin / MIN_PER_DAY) * MIN_PER_DAY // 出勤日の 00:00(JST)
  const a = inMin - midnight
  const b = outMin - midnight
  const windows: [number, number][] = [
    [22 * 60, 29 * 60],   // 当夜 22:00 〜 翌 5:00
    [-2 * 60, 5 * 60],    // 前夜 22:00 〜 当日 5:00
  ]
  let night = 0
  for (const [ws, we] of windows) {
    const lo = Math.max(a, ws)
    const hi = Math.min(b, we)
    if (hi > lo) night += hi - lo
  }
  return night
}

export type DayMinutes = { workedMin: number; overtimeMin: number; nightMin: number }

// 1日ぶんの 実働／残業／深夜 の分数。出退勤が揃っていない日は null（＝打刻不備）。
export function dayMinutes(
  clockInISO: string | null,
  clockOutISO: string | null,
  breakMin: number,
  standardMin: number,
): DayMinutes | null {
  if (!clockInISO || !clockOutISO) return null
  const inMin = jstEpochMin(clockInISO)
  const outMin = jstEpochMin(clockOutISO)
  const gross = outMin - inMin
  if (gross <= 0) return null
  const worked = Math.max(0, gross - Math.max(0, Math.floor(breakMin)))
  const overtime = Math.max(0, worked - standardMin)
  const night = nightOverlapMin(clockInISO, clockOutISO)
  return { workedMin: worked, overtimeMin: overtime, nightMin: Math.min(night, worked) }
}

export type PayBreakdown = {
  base: number          // 基本給（実働全体 × 時給）
  overtimePay: number   // 時間外手当（8h超分 × 時給 × 0.25）
  nightPay: number      // 深夜手当（深夜分 × 時給 × 0.25）
}

// 月次で積み上げた分数から金額を出す（時給制）。
export function hourlyAmounts(m: DayMinutes, hourlyRate: number): PayBreakdown {
  const base = Math.round((m.workedMin / 60) * hourlyRate)
  const overtimePay = Math.round((m.overtimeMin / 60) * hourlyRate * 0.25)
  const nightPay = Math.round((m.nightMin / 60) * hourlyRate * 0.25)
  return { base, overtimePay, nightPay }
}

// 通勤手当 ＝ 往復額/日 × 出勤日数（実費・上限月20,000円・非課税）。
export const COMMUTE_CAP = 20000
export function commuteAmount(roundTripPerDay: number | null, workDays: number): number {
  if (!roundTripPerDay || workDays <= 0) return 0
  return Math.min(roundTripPerDay * workDays, COMMUTE_CAP)
}

// 発効日つき単価から、対象日に有効な行を選ぶ（date <= effective_from の最新）。
export type WageRow = {
  user_id: string
  effective_from: string
  pay_type: string
  hourly_rate: number | null
  monthly_salary: number | null
  fixed_overtime: number
  commute_round_trip: number | null
  note: string | null
}
export function wageForDate(rows: WageRow[], date: string): WageRow | null {
  const applicable = rows
    .filter(r => r.effective_from <= date)
    .sort((a, b) => (a.effective_from < b.effective_from ? 1 : -1))
  return applicable[0] ?? null
}

// 分 → "H:MM"
export function fmtHM(min: number): string {
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  return `${h}:${String(m).padStart(2, '0')}`
}
