import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

// 売上CSV投入用Botのコールバック受け口（スタブ）。
// スタッフが投入グループ/DMにCSVを送ると、Message Event(file)としてここに届く。
// 実処理（ファイルDL→Supabase保存、日次=蓄積/月次=上書き）は次段で実装する。
export async function POST(req: NextRequest) {
  let body: unknown = null
  try { body = await req.json() } catch { /* noop */ }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b = body as any
  // 受信ログ（本実装まではエコーのみ。個人情報は本文に含めない）
  console.log('[csv-intake] type=', b?.type, 'contentType=', b?.content?.type)
  return NextResponse.json({ ok: true })
}

// 登録時の疎通確認（GET）用
export async function GET() {
  return NextResponse.json({ ok: true })
}
