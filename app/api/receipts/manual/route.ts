import { NextRequest, NextResponse } from 'next/server'
import { requireReceiptManager } from '@/lib/server-admin'

export const runtime = 'nodejs'

// 領収書の手動保管（経理 or 管理者のみ）。
//  - GET （?userId 無し）: 対象にできる先生/スタッフの一覧（picker用）
//  - GET ?userId=... : その人の手動保管済み領収書を年-月ごとに返す
//  - POST（multipart: userId, file）: その人の代理として1枚保管
//
// 保存先: expense-receipts/_manual/{対象userId}/{YYYY-MM}/YYYY-MM-DD_時分秒_ランダム.拡張子（JST）
const BUCKET = 'expense-receipts'
const ROOT = '_manual'

export async function GET(req: NextRequest) {
  const auth = await requireReceiptManager(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const admin = auth.admin

  const userId = req.nextUrl.searchParams.get('userId')

  // picker用の一覧
  if (!userId) {
    const { data } = await admin.from('profiles').select('id, name, role').order('name', { ascending: true })
    return NextResponse.json({ people: data ?? [] })
  }

  // その人の保管済みファイルを年-月ごとに
  const base = `${ROOT}/${userId}`
  const { data: months } = await admin.storage.from(BUCKET).list(base, {
    limit: 1000, sortBy: { column: 'name', order: 'desc' },
  })
  const items: { month: string; name: string; url: string; created_at: string | null }[] = []
  for (const m of months ?? []) {
    if (m.id !== null) continue // フォルダ(=年-月)のみ
    const monthPath = `${base}/${m.name}`
    const { data: files } = await admin.storage.from(BUCKET).list(monthPath, {
      limit: 1000, sortBy: { column: 'name', order: 'desc' },
    })
    for (const f of files ?? []) {
      if (f.id === null) continue // ファイルのみ
      const { data: pub } = admin.storage.from(BUCKET).getPublicUrl(`${monthPath}/${f.name}`)
      items.push({ month: m.name, name: f.name, url: pub.publicUrl, created_at: f.created_at ?? null })
    }
  }
  return NextResponse.json({ items })
}

export async function POST(req: NextRequest) {
  const auth = await requireReceiptManager(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const admin = auth.admin

  const form = await req.formData().catch(() => null)
  const userId = String(form?.get('userId') ?? '')
  const file = form?.get('file')
  if (!userId) return NextResponse.json({ error: '対象者が指定されていません' }, { status: 400 })
  if (!(file instanceof File)) return NextResponse.json({ error: 'ファイルがありません' }, { status: 400 })
  if (file.size > 8 * 1024 * 1024) return NextResponse.json({ error: '画像は8MBまでです' }, { status: 400 })

  // 対象者が実在するプロフィールか検証（任意パスへの書き込み防止）
  const { data: target } = await admin.from('profiles').select('id').eq('id', userId).maybeSingle()
  if (!target) return NextResponse.json({ error: '対象者が見つかりません' }, { status: 400 })

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

  const path = `${ROOT}/${userId}/${y}-${mo}/${y}-${mo}-${d}_${h}${mi}${s}_${rand}.${ext}`

  const buf = Buffer.from(await file.arrayBuffer())
  const { error } = await admin.storage.from(BUCKET).upload(path, buf, {
    contentType: file.type || 'image/jpeg',
    upsert: false,
  })
  if (error) {
    return NextResponse.json({ error: '保管に失敗しました: ' + error.message }, { status: 500 })
  }
  const { data } = admin.storage.from(BUCKET).getPublicUrl(path)
  return NextResponse.json({ ok: true, url: data.publicUrl })
}
