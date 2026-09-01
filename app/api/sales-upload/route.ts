import { NextRequest, NextResponse } from 'next/server'
import { requireAiUser } from '@/lib/server-admin'
import { maskDailySalesCSV } from '@/lib/sales-daily'

export const runtime = 'nodejs'
export const maxDuration = 60

// ACUSISのCSVをまとめて取り込む口。
// LINE WORKS経由だと1ファイルずつ送ることになり、日次売上のように
// 1ヶ月で60本を超える帳票は現実的でないため、画面からまとめて投げられるようにする。
// 保存先・キーの付け方は LINE WORKS 経由（/api/lineworks-csv-intake）と同じなので、
// どちらから入れても後段の処理は変わらない。

const MAX_FILES = 100
const MAX_BYTES = 512 * 1024 // 1ファイルあたり。ACUSISのCSVは数KB〜数十KB

export async function POST(req: NextRequest) {
  const auth = await requireAiUser(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  if (auth.scope !== 'exec') {
    return NextResponse.json({ error: '売上データを取り込む権限がありません' }, { status: 403 })
  }
  const admin = auth.admin

  const form = await req.formData().catch(() => null)
  if (!form) return NextResponse.json({ error: 'ファイルを受け取れませんでした' }, { status: 400 })

  const files = form.getAll('files').filter((f): f is File => f instanceof File)
  if (files.length === 0) return NextResponse.json({ error: 'ファイルがありません' }, { status: 400 })
  if (files.length > MAX_FILES) {
    return NextResponse.json({ error: `一度に取り込めるのは${MAX_FILES}件までです` }, { status: 400 })
  }

  const saved: string[] = []
  const skipped: string[] = []

  for (const f of files) {
    if (!/\.csv$/i.test(f.name)) { skipped.push(`${f.name}（CSVではない）`); continue }
    if (f.size > MAX_BYTES) { skipped.push(`${f.name}（大きすぎる）`); continue }

    // キーの付け方は LINE WORKS 経由と同じ。拡張子と " (1)" のような重複サフィックスを除去。
    const base = f.name.replace(/\.[^.]+$/, '').replace(/\s*\(\d+\)\s*$/, '').trim()
    const text = await f.text()
    // 日次売上には患者名とカルテ番号が含まれる。保存する前に消す。
    const value = base.startsWith('日次売上') ? maskDailySalesCSV(text) : text

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (admin.from('app_settings') as any).upsert({ key: `sales_csv:${base}`, value })
    if (error) skipped.push(`${f.name}（保存に失敗）`)
    else saved.push(base)
  }

  return NextResponse.json({
    ok: true,
    取り込んだ件数: saved.length,
    取り込んだファイル: saved,
    見送り: skipped,
    注記: '日次売上は患者名とカルテ番号を消してから保存しています。',
  })
}
