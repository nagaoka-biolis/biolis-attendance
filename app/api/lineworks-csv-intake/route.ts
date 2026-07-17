import { NextRequest, NextResponse } from 'next/server'
import { adminClient } from '@/lib/server-admin'
import { downloadBotAttachment } from '@/lib/lineworks'

export const runtime = 'nodejs'

// 売上CSV投入用Botのコールバック受け口。
// スタッフが投入グループ/DMにCSVを送ると Message Event(file) がここに届く。
// → 添付をDL → app_settings に保存（日次=ファイル名ごとに蓄積 / 月次=年月キーで上書き）。
export async function POST(req: NextRequest) {
  let body: unknown = null
  try { body = await req.json() } catch { /* noop */ }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b = body as any
  const content = b?.content
  const fileId = content?.fileId

  if (content?.type === 'file' && fileId) {
    try {
      const botId = process.env.LINEWORKS_CSV_BOT_ID!
      const { filename, content: csv } = await downloadBotAttachment(botId, fileId)
      const admin = adminClient()

      // CSVだけ受け付ける
      if (!/\.csv$/i.test(filename)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (admin.from('app_settings') as any).upsert({ key: 'sales_csv_last', value: `SKIP(非CSV): ${filename}` })
        return NextResponse.json({ ok: true })
      }

      // キー正規化: 拡張子と " (1)" のような重複サフィックスを除去
      const base = filename.replace(/\.[^.]+$/, '').replace(/\s*\(\d+\)\s*$/, '').trim()
      // 例: 日次売上_20260716（日付入り=蓄積） / 月次売上_202607（年月=上書き）
      const key = `sales_csv:${base}`

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (admin.from('app_settings') as any).upsert({ key, value: csv })
      // 受信ログ（デバッグ用・本文は含めない）
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (admin.from('app_settings') as any).upsert({ key: 'sales_csv_last', value: `OK: ${filename} (${csv.length}B)` })
    } catch (e) {
      const admin = adminClient()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (admin.from('app_settings') as any).upsert({ key: 'sales_csv_last', value: `ERR: ${String(e).slice(0, 300)}` }).catch(() => {})
    }
  }
  return NextResponse.json({ ok: true })
}

export async function GET() {
  return NextResponse.json({ ok: true })
}
