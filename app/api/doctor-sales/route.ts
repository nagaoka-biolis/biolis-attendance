import { NextRequest, NextResponse } from 'next/server'
import { requireAiUser } from '@/lib/server-admin'
import {
  parseDoctorSalesCSV,
  summarizeByDoctor,
  summarizeByPerson,
  summarizeByDay,
  type DoctorSalesCsv,
  type ShiftRow,
} from '@/lib/sales-doctor'

export const runtime = 'nodejs'

// 医師別売上（ACUSIS「スタッフ別売上(Dr)」）とシフトを突き合わせて集計を返す。
// AIチャットが読む材料であると同時に、人間が数字を検算するための窓口でもある。
//   GET /api/doctor-sales?month=2026-07
// 利用者は ai_users 名簿に載っている人のみ（admin でも名簿になければ 403）。

// 保存済みCSVを探す。ファイル名の日付はエクスポート日であって対象月ではないため、
// 候補を全部読んで「中身の日付が指定月と一致するもの」を採用する。
async function loadCsvForMonth(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  month: string
): Promise<{ csv: DoctorSalesCsv; key: string } | null> {
  const { data } = await admin
    .from('app_settings')
    .select('key,value')
    .like('key', 'sales_csv:スタッフ別売上%')

  const rows = (data ?? []) as { key: string; value: string }[]
  const parsed = rows
    .map((r) => ({ key: r.key, csv: parseDoctorSalesCSV(r.value) }))
    .filter((r): r is { key: string; csv: DoctorSalesCsv } => r.csv !== null)

  // 同じ月のものが複数あれば、キー名が新しい（＝後にエクスポートした）ものを採る
  const hit = parsed.filter((r) => r.csv.month === month).sort((a, b) => b.key.localeCompare(a.key))[0]
  return hit ? { csv: hit.csv, key: hit.key } : null
}

export async function GET(req: NextRequest) {
  const auth = await requireAiUser(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  if (auth.scope !== 'exec') {
    return NextResponse.json({ error: '売上を参照する権限がありません' }, { status: 403 })
  }
  const admin = auth.admin

  const sp = req.nextUrl.searchParams
  const month = sp.get('month') ?? new Date().toISOString().slice(0, 7)
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: 'month は YYYY-MM 形式で指定してください' }, { status: 400 })
  }

  const found = await loadCsvForMonth(admin, month)
  if (!found) {
    const { data } = await admin
      .from('app_settings')
      .select('key')
      .like('key', 'sales_csv:スタッフ別売上%')
    return NextResponse.json(
      {
        error: `${month} の医師別売上CSVが見つかりません`,
        hint: 'ACUSISの「スタッフ別売上(Dr)」をLINE WORKSの売上CSV投入グループに送ってください',
        stored: ((data ?? []) as { key: string }[]).map((r) => r.key),
      },
      { status: 404 }
    )
  }
  const { csv, key } = found

  // 対象月のシフト（医師の突き合わせ用）
  const start = `${month}-01`
  const end = `${month}-31`
  const { data: shiftData } = await admin
    .from('shifts')
    .select('date, user_id, display_name, category, start_time, end_time')
    .gte('date', start)
    .lte('date', end)
    .eq('kind', 'work')
  const shifts = (shiftData ?? []) as ShiftRow[]

  // シフト表の display_name は姓のみのことがあるため、正式氏名も引く
  const { data: profs } = await admin.from('profiles').select('id, name')
  const nameById = new Map<string, string>()
  for (const p of (profs ?? []) as { id: string; name: string }[]) nameById.set(p.id, p.name)

  const doctors = summarizeByDoctor(csv, shifts, nameById)
  const byDay = summarizeByDay(csv, shifts)
  const total = doctors.reduce((a, d) => a + d.amount, 0)
  const unassigned = doctors.find((d) => d.unassigned)

  return NextResponse.json({
    ok: true,
    month,
    source: key,
    総売上: total,
    担当未割当: unassigned ? { 金額: unassigned.amount, 件数: unassigned.cases } : null,
    営業日数: csv.days.length,
    // 昼枠と夜枠を1人にまとめたもの。出勤日あたりの効率を見るときはこちらを使う。
    医師別_昼夜まとめ: summarizeByPerson(doctors).map((d) => ({
      医師: d.label,
      勤怠側の氏名: d.staffName,
      売上: d.amount,
      人数: d.patients,
      シフト上の出勤日数: d.workDays,
      出勤1日あたり売上: d.perWorkDay,
      患者1人あたり単価: d.perPatient,
    })),
    医師別: doctors.map((d) => ({
      ラベル: d.label,
      勤怠側の氏名: d.staffName,
      売上: d.amount,
      件数: d.cases,
      人数: d.patients,
      売上のあった日数: d.salesDays,
      シフト上の出勤日数: d.workDays,
      出勤1日あたり売上: d.perWorkDay,
      患者1人あたり単価: d.perPatient,
    })),
    日別: byDay,
  })
}
