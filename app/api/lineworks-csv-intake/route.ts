import { NextRequest, NextResponse } from 'next/server'
import { adminClient } from '@/lib/server-admin'
import { downloadBotAttachment } from '@/lib/lineworks'

export const runtime = 'nodejs'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function dbg(admin: any, msg: string) {
  try { await admin.from('app_settings').upsert({ key: 'csv_intake_debug', value: `${new Date().toISOString()} ${msg}`.slice(0, 500) }) } catch { /* noop */ }
}

// 売上CSV投入用Botのコールバック受け口。
export async function POST(req: NextRequest) {
  let body: unknown = null
  try { body = await req.json() } catch { /* noop */ }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b = body as any
  const admin = adminClient()

  const content = b?.content
  const fileId = content?.fileId
  await dbg(admin, `recv type=${b?.type} ctype=${content?.type} fileId=${JSON.stringify(fileId)?.slice(0, 60)}`)

  if (content?.type === 'file' && fileId) {
    // 後から手元で検証できるよう fileId を保存（エラーでも残す）
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin.from('app_settings') as any).upsert({ key: 'csv_last_fileId', value: `${String(fileId)} @ ${new Date().toISOString()}` }).catch(() => {})
    try {
      const botId = process.env.LINEWORKS_CSV_BOT_ID!
      await dbg(admin, `downloading botId=${botId} fileId=${String(fileId).slice(0, 40)}`)
      const { filename, content: csv } = await downloadBotAttachment(botId, String(fileId))
      await dbg(admin, `downloaded name="${filename}" len=${csv.length}`)

      if (!/\.csv$/i.test(filename)) {
        await dbg(admin, `skip 非CSV: ${filename}`)
        return NextResponse.json({ ok: true })
      }
      const base = filename.replace(/\.[^.]+$/, '').replace(/\s*\(\d+\)\s*$/, '').trim()
      const key = `sales_csv:${base}`
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (admin.from('app_settings') as any).upsert({ key, value: csv })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (admin.from('app_settings') as any).upsert({ key: 'sales_csv_last', value: `OK: ${filename} (${csv.length}B)` })
      await dbg(admin, `saved key=${key}`)
    } catch (e) {
      await dbg(admin, `ERROR ${String(e).slice(0, 300)}`)
    }
  }
  return NextResponse.json({ ok: true })
}

export async function GET() {
  return NextResponse.json({ ok: true })
}
