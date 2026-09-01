import { NextRequest, NextResponse } from 'next/server'
import { requireAiUser } from '@/lib/server-admin'
import { estimateCostUsd, MODEL_CHOICES } from '@/lib/ai-models'

export const runtime = 'nodejs'

// BiOLiS AI の利用実績と概算費用。クリニックへ実費を請求するための根拠に使う。
//   GET /api/ai-cost            … 直近6ヶ月
//   GET /api/ai-cost?month=2026-09 … その月だけ
//
// ここで出る金額はトークン数からの**概算**。正式な金額は Anthropic Console の
// 請求書が正なので、請求書と併せて使うこと。

type Row = {
  created_at: string
  model: string | null
  input_tokens: number | null
  output_tokens: number | null
  user_id: string | null
}

export async function GET(req: NextRequest) {
  const auth = await requireAiUser(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const admin = auth.admin

  const month = req.nextUrl.searchParams.get('month')
  if (month && !/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: 'month は YYYY-MM 形式で指定してください' }, { status: 400 })
  }

  // 期間を絞る（未指定なら直近6ヶ月）
  let q = admin.from('ai_chat_logs').select('created_at, model, input_tokens, output_tokens, user_id')
  if (month) {
    const start = `${month}-01T00:00:00.000Z`
    const [y, m] = month.split('-').map(Number)
    const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
    q = q.gte('created_at', start).lt('created_at', `${next}-01T00:00:00.000Z`)
  } else {
    const since = new Date(Date.now() - 186 * 24 * 60 * 60 * 1000).toISOString()
    q = q.gte('created_at', since)
  }
  const { data } = await q
  const rows = (data ?? []) as Row[]

  const { data: profs } = await admin.from('profiles').select('id, name')
  const nameById = new Map<string, string>()
  for (const p of (profs ?? []) as { id: string; name: string }[]) nameById.set(p.id, p.name)

  type Acc = { 件数: number; 入力トークン: number; 出力トークン: number; 概算費用USD: number }
  const blank = (): Acc => ({ 件数: 0, 入力トークン: 0, 出力トークン: 0, 概算費用USD: 0 })
  const add = (a: Acc, r: Row) => {
    const i = r.input_tokens ?? 0
    const o = r.output_tokens ?? 0
    a.件数++
    a.入力トークン += i
    a.出力トークン += o
    a.概算費用USD += estimateCostUsd(r.model, i, o)
  }

  const byMonth = new Map<string, Acc>()
  const byUser = new Map<string, Acc>()
  const byModel = new Map<string, Acc>()
  const total = blank()

  for (const r of rows) {
    const ym = r.created_at.slice(0, 7)
    const who = (r.user_id && nameById.get(r.user_id)) ?? '(不明)'
    const mdl = r.model ?? '(記録なし)'
    for (const [map, key] of [[byMonth, ym], [byUser, who], [byModel, mdl]] as const) {
      const cur = map.get(key) ?? blank()
      add(cur, r)
      map.set(key, cur)
    }
    add(total, r)
  }

  const round = (a: Acc) => ({ ...a, 概算費用USD: Math.round(a.概算費用USD * 10000) / 10000 })
  const asObj = (m: Map<string, Acc>) =>
    Object.fromEntries([...m.entries()].sort().map(([k, v]) => [k, round(v)]))

  return NextResponse.json({
    ok: true,
    対象: month ?? '直近6ヶ月',
    注記: '金額はトークン数からの概算です。正式な金額は Anthropic Console の請求書をご確認ください。',
    単価: Object.fromEntries(
      MODEL_CHOICES.map((m) => [m.id, `入力 $${m.inUsd} / 出力 $${m.outUsd} (100万トークンあたり)`])
    ),
    合計: round(total),
    月別: asObj(byMonth),
    利用者別: asObj(byUser),
    モデル別: asObj(byModel),
  })
}
