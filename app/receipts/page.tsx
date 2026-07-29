'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

type Person = { id: string; name: string; role: string }
type Item = { month: string; name: string; url: string; created_at: string | null }

export default function ReceiptsPage() {
  const router = useRouter()
  const [ready, setReady] = useState(false)
  const [allowed, setAllowed] = useState(false)
  const [people, setPeople] = useState<Person[]>([])
  const [targetId, setTargetId] = useState('')
  const [items, setItems] = useState<Item[]>([])
  const [loadingList, setLoadingList] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [msg, setMsg] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const token = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession()
    return session?.access_token ?? ''
  }, [])

  // 初期化：ログイン確認 → 権限確認（people取得が403なら弾く）
  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.replace('/'); return }
      const res = await fetch('/api/receipts/manual', { headers: { Authorization: `Bearer ${await token()}` } })
      if (res.status === 401) { router.replace('/'); return }
      if (res.status === 403) { setAllowed(false); setReady(true); return }
      const j = await res.json().catch(() => null)
      setPeople((j?.people ?? []) as Person[])
      setAllowed(true)
      setReady(true)
    }
    init()
  }, [router, token])

  const fetchItems = useCallback(async (uid: string) => {
    if (!uid) { setItems([]); return }
    setLoadingList(true)
    const res = await fetch(`/api/receipts/manual?userId=${uid}`, { headers: { Authorization: `Bearer ${await token()}` } })
    const j = await res.json().catch(() => null)
    setItems((j?.items ?? []) as Item[])
    setLoadingList(false)
  }, [token])

  const selectTarget = (uid: string) => { setTargetId(uid); fetchItems(uid) }

  const uploadFiles = async (files: FileList | File[]) => {
    if (!targetId) { setMsg({ text: '先に対象の先生を選んでください', type: 'error' }); return }
    const list = Array.from(files).filter(f => f.type.startsWith('image/'))
    if (list.length === 0) { setMsg({ text: '画像ファイルを選んでください', type: 'error' }); return }
    setUploading(true); setMsg({ text: `${list.length}件をアップロード中…`, type: 'info' })
    let ok = 0, ng = 0
    const t = await token()
    for (const f of list) {
      const fd = new FormData()
      fd.append('userId', targetId)
      fd.append('file', f)
      const res = await fetch('/api/receipts/manual', { method: 'POST', headers: { Authorization: `Bearer ${t}` }, body: fd })
      const j = await res.json().catch(() => null)
      if (j?.ok) ok++; else ng++
    }
    setUploading(false)
    setMsg({ text: `保管しました（成功 ${ok}件${ng ? ` / 失敗 ${ng}件` : ''}）`, type: ng ? 'error' : 'success' })
    await fetchItems(targetId)
  }

  const targetName = people.find(p => p.id === targetId)?.name ?? ''
  const months = Array.from(new Set(items.map(i => i.month))).sort().reverse()

  if (!ready) {
    return <div className="min-h-screen flex items-center justify-center" style={{ color: 'var(--gray)' }}>読み込み中…</div>
  }
  if (!allowed) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 px-6 text-center">
        <p style={{ color: 'var(--navy)', fontWeight: 700 }}>このページは経理権限が必要です</p>
        <p className="text-sm" style={{ color: 'var(--gray)' }}>権限が必要な場合は管理者にご連絡ください。</p>
        <button onClick={() => router.replace('/dashboard')} className="text-sm px-4 py-2 rounded-full border" style={{ borderColor: 'var(--gray-light)', color: 'var(--navy)' }}>戻る</button>
      </div>
    )
  }

  return (
    <div className="min-h-screen" style={{ background: 'var(--cream, #faf9f6)' }}>
      <div className="max-w-3xl mx-auto px-5 py-6">
        <div className="flex items-center justify-between mb-1">
          <h1 className="text-xl font-bold" style={{ color: 'var(--navy)' }}>領収書 手動保管</h1>
          <button onClick={() => router.replace('/dashboard')} className="text-xs px-3 py-1 rounded-full border" style={{ borderColor: 'var(--gray-light)', color: 'var(--gray)' }}>戻る</button>
        </div>
        <p className="text-xs mb-4" style={{ color: 'var(--gray)' }}>
          アプリを使わない先生の領収書を、経理担当が代わりに保管します。名前・日付は自動で付きます。
        </p>

        {/* 対象の先生を選ぶ */}
        <div className="mb-4">
          <label className="text-xs font-semibold block mb-1" style={{ color: 'var(--navy)' }}>対象の先生・スタッフ</label>
          <select
            value={targetId}
            onChange={e => selectTarget(e.target.value)}
            className="w-full text-sm px-3 py-2 rounded-lg border bg-white"
            style={{ borderColor: 'var(--gray-light)', color: 'var(--navy)' }}
          >
            <option value="">— 選択してください —</option>
            {people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>

        {msg && (
          <div className="text-sm mb-3 px-3 py-2 rounded-lg" style={{
            background: msg.type === 'error' ? '#fbeaea' : msg.type === 'success' ? '#eaf6ec' : '#f2f2f2',
            color: msg.type === 'error' ? '#b23b3b' : msg.type === 'success' ? '#2e7d43' : 'var(--gray)',
          }}>{msg.text}</div>
        )}

        {/* 投げ込み */}
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => { e.preventDefault(); setDragOver(false); uploadFiles(e.dataTransfer.files) }}
          onClick={() => fileRef.current?.click()}
          className="rounded-xl border-2 border-dashed text-center py-10 px-4 cursor-pointer transition mb-6"
          style={{
            borderColor: dragOver ? 'var(--gold, #c2a15c)' : 'var(--gray-light, #ddd)',
            background: dragOver ? '#fbf6ea' : '#fff',
            opacity: targetId ? 1 : 0.6,
          }}
        >
          <input
            ref={fileRef} type="file" accept="image/*" multiple className="hidden"
            onChange={e => { if (e.target.files) uploadFiles(e.target.files); e.target.value = '' }}
          />
          <p className="text-sm font-semibold" style={{ color: 'var(--navy)' }}>
            {uploading ? 'アップロード中…' : 'ここに写真をドラッグ、またはクリックして選択'}
          </p>
          <p className="text-xs mt-1" style={{ color: 'var(--gray)' }}>
            {targetName ? `保管先：${targetName} さん` : '先に対象の先生を選んでください'}・画像8MBまで・複数まとめてOK
          </p>
        </div>

        {/* 一覧（年-月ごと） */}
        <h2 className="text-sm font-bold mb-2" style={{ color: 'var(--navy)' }}>
          保管済み {targetName && `（${targetName} さん）`}
        </h2>
        {loadingList ? (
          <p className="text-sm" style={{ color: 'var(--gray)' }}>読み込み中…</p>
        ) : !targetId ? (
          <p className="text-sm" style={{ color: 'var(--gray)' }}>先生を選ぶと、保管済みの領収書が表示されます。</p>
        ) : items.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--gray)' }}>まだ保管された領収書はありません。</p>
        ) : (
          months.map(mo => (
            <div key={mo} className="mb-5">
              <div className="text-xs font-semibold mb-2" style={{ color: 'var(--gold, #9a7b33)' }}>{mo}</div>
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {items.filter(i => i.month === mo).map(i => (
                  <a key={i.name} href={i.url} target="_blank" rel="noopener noreferrer"
                     className="block rounded-lg overflow-hidden border bg-white" style={{ borderColor: 'var(--gray-light)' }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={i.url} alt={i.name} className="w-full h-24 object-cover" />
                  </a>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
