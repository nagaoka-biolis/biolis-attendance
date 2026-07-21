import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/server-admin'

export const runtime = 'nodejs'

// 領収書画像を Supabase Storage(expense-receipts) にアップロードして公開URLを返す。
// フォルダは「申請者別」: {user_id}/{YYYY-MM}/YYYY-MM-DD_時分秒_ランダム.拡張子（すべてJST）。
export async function POST(req: NextRequest) {
  const auth = await requireUser(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'ファイルがありません' }, { status: 400 })
  }
  if (file.size > 8 * 1024 * 1024) {
    return NextResponse.json({ error: '画像は8MBまでです' }, { status: 400 })
  }

  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'

  // JSTの壁時計（VercelはUTC実行のため +9h してから getUTC* を使う）
  const jst = new Date(Date.now() + 9 * 60 * 60 * 1000)
  const y = jst.getUTCFullYear()
  const mo = String(jst.getUTCMonth() + 1).padStart(2, '0')
  const d = String(jst.getUTCDate()).padStart(2, '0')
  const h = String(jst.getUTCHours()).padStart(2, '0')
  const mi = String(jst.getUTCMinutes()).padStart(2, '0')
  const s = String(jst.getUTCSeconds()).padStart(2, '0')
  const rand = Math.random().toString(36).slice(2, 8)

  // 申請者別フォルダ: {user_id}/{年-月}/...
  const path = `${auth.userId}/${y}-${mo}/${y}-${mo}-${d}_${h}${mi}${s}_${rand}.${ext}`

  const buf = Buffer.from(await file.arrayBuffer())
  const { error } = await auth.admin.storage.from('expense-receipts').upload(path, buf, {
    contentType: file.type || 'image/jpeg',
    upsert: false,
  })
  if (error) {
    return NextResponse.json(
      { error: 'アップロードに失敗しました（expense-receiptsバケット未作成の可能性）: ' + error.message },
      { status: 500 }
    )
  }
  const { data } = auth.admin.storage.from('expense-receipts').getPublicUrl(path)
  return NextResponse.json({ ok: true, url: data.publicUrl })
}
