'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { MODEL_CHOICES } from '@/lib/ai-models'

// BiOLiS AI のチャット画面。
// /ai（フルスクリーン）と管理画面の中の両方で使うので、見た目だけ variant で切り替える。

type Turn = { role: 'user' | 'assistant'; content: string }

const SUGGESTIONS = [
  '明日の出勤者は？',
  '今週Drが手薄な日は？',
  '先月の医師別の売上を教えて',
  '担当未割当はいくらある？',
]

// --- AIの回答（マークダウン）の描画 -----------------------------------------
// 表・見出し・箇条書き・太字だけを扱う小さな描画。HTMLは差し込まないので安全。

function Bold({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith('**') && p.endsWith('**') ? <strong key={i}>{p.slice(2, -2)}</strong> : p
      )}
    </>
  )
}

function Markdown({ text }: { text: string }) {
  const lines = text.split('\n')
  const out: React.ReactNode[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    // 表: | a | b | の連続（2行目の |---| は区切りなので飛ばす）
    if (/^\s*\|.*\|\s*$/.test(line)) {
      const rows: string[][] = []
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        const cells = lines[i].trim().slice(1, -1).split('|').map((c) => c.trim())
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells)
        i++
      }
      const [head, ...body] = rows
      out.push(
        <div key={`t${i}`} className="overflow-x-auto my-2">
          <table className="text-xs border-collapse w-full">
            <thead>
              <tr>
                {head?.map((h, k) => (
                  <th
                    key={k}
                    className="border px-2 py-1 text-left font-semibold whitespace-nowrap"
                    style={{ borderColor: 'var(--gray-light)', background: 'var(--gray-light)' }}
                  >
                    <Bold text={h} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {body.map((r, k) => (
                <tr key={k}>
                  {r.map((c, m) => (
                    <td
                      key={m}
                      className="border px-2 py-1 whitespace-nowrap"
                      style={{ borderColor: 'var(--gray-light)' }}
                    >
                      <Bold text={c} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
      continue
    }

    // 見出し
    const h = line.match(/^(#{1,4})\s+(.*)$/)
    if (h) {
      out.push(
        <p key={i} className="font-bold mt-3 mb-1 text-sm">
          <Bold text={h[2]} />
        </p>
      )
      i++
      continue
    }

    // 箇条書き
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ''))
        i++
      }
      out.push(
        <ul key={`l${i}`} className="list-disc pl-5 my-1 space-y-0.5">
          {items.map((it, k) => (
            <li key={k}>
              <Bold text={it} />
            </li>
          ))}
        </ul>
      )
      continue
    }

    if (line.trim() === '') {
      i++
      continue
    }

    out.push(
      <p key={i} className="my-1 leading-relaxed">
        <Bold text={line} />
      </p>
    )
    i++
  }

  return <div>{out}</div>
}

// --- 本体 -------------------------------------------------------------------

export default function AiChat({ variant = 'full' }: { variant?: 'full' | 'panel' }) {
  const [turns, setTurns] = useState<Turn[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [model, setModel] = useState<string>('')
  const [ready, setReady] = useState(false)
  const [allowed, setAllowed] = useState(false)
  const [info, setInfo] = useState<{ 売上の月?: string[]; APIキー設定済み?: boolean } | null>(null)
  const endRef = useRef<HTMLDivElement>(null)

  const token = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession()
    return session?.access_token ?? ''
  }, [])

  // 起動時に権限と材料の状況を確認（AIは呼ばないので費用はかからない）
  useEffect(() => {
    const init = async () => {
      const t = await token()
      if (!t) { setReady(true); return }
      const res = await fetch('/api/ai-chat', { headers: { Authorization: `Bearer ${t}` } })
      if (res.ok) {
        const j = await res.json().catch(() => null)
        setAllowed(true)
        setInfo(j)
        setModel(String(j?.既定のモデル ?? ''))
      }
      setReady(true)
    }
    init()
  }, [token])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [turns, busy])

  const send = async (text: string) => {
    const q = text.trim()
    if (!q || busy) return
    setError(null)
    setInput('')
    const history = turns.slice(-8)
    setTurns((p) => [...p, { role: 'user', content: q }])
    setBusy(true)
    try {
      const res = await fetch('/api/ai-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token()}` },
        body: JSON.stringify({ message: q, history, model: model || undefined }),
      })
      const j = await res.json().catch(() => null)
      if (!res.ok) {
        setError(j?.error ?? '応答を取得できませんでした')
      } else {
        setTurns((p) => [...p, { role: 'assistant', content: String(j.answer ?? '') }])
      }
    } catch {
      setError('通信に失敗しました')
    } finally {
      setBusy(false)
    }
  }

  const dark = variant === 'full'
  const bg = dark ? 'var(--navy)' : 'transparent'
  const fg = dark ? '#fff' : 'var(--navy)'

  if (!ready) {
    return (
      <div className="flex items-center justify-center py-16 text-sm" style={{ color: 'var(--gray)' }}>
        読み込み中…
      </div>
    )
  }

  if (!allowed) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-16 px-6 text-center">
        <p className="font-bold text-sm" style={{ color: dark ? '#fff' : 'var(--navy)' }}>
          BiOLiS AI の利用権限がありません
        </p>
        <p className="text-xs" style={{ color: 'var(--gray)' }}>
          経営数字を扱うため、利用者を限定しています。必要な場合は管理者にご連絡ください。
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full" style={{ background: bg, color: fg }}>
      {/* 会話 */}
      <div className={`flex-1 overflow-y-auto px-4 ${dark ? 'py-4' : 'py-2'}`}>
        {turns.length === 0 && (
          <div className="py-6">
            <p className="text-sm mb-1 font-semibold" style={{ color: dark ? 'var(--gold-light)' : 'var(--navy)' }}>
              シフトと売上について、そのまま日本語で聞いてください。
            </p>
            <p className="text-xs mb-4" style={{ color: 'var(--gray)' }}>
              {info?.売上の月?.length
                ? `売上データ: ${info.売上の月.join(' / ')}`
                : '売上データは未取り込みです（シフトのみ回答できます）'}
            </p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="text-xs px-3 py-1.5 rounded-full border transition"
                  style={{
                    borderColor: dark ? 'rgba(255,255,255,0.25)' : 'var(--gray-light)',
                    color: dark ? '#fff' : 'var(--navy)',
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {turns.map((t, i) =>
          t.role === 'user' ? (
            <div key={i} className="flex justify-end mb-3">
              <div
                className="max-w-[85%] text-sm px-3 py-2 rounded-2xl rounded-br-sm"
                style={{ background: 'var(--gold)', color: '#fff' }}
              >
                {t.content}
              </div>
            </div>
          ) : (
            <div key={i} className="flex justify-start mb-4">
              <div
                className="max-w-[95%] text-sm px-3 py-2 rounded-2xl rounded-bl-sm"
                style={{ background: dark ? 'rgba(255,255,255,0.06)' : '#fff', color: dark ? '#fff' : 'var(--navy)' }}
              >
                <Markdown text={t.content} />
              </div>
            </div>
          )
        )}

        {busy && (
          <div className="text-xs px-1 mb-3" style={{ color: 'var(--gray)' }}>
            考えています…
          </div>
        )}
        {error && (
          <div
            className="text-xs px-3 py-2 rounded-lg mb-3"
            style={{ background: '#fbeaea', color: '#b23b3b' }}
          >
            {error}
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* 入力 */}
      <div
        className="px-4 py-3 border-t"
        style={{ borderColor: dark ? 'rgba(255,255,255,0.12)' : 'var(--gray-light)' }}
      >
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send(input)
            }}
            rows={2}
            placeholder="例：今井先生が入った日の平均売上は？"
            className="flex-1 text-sm px-3 py-2 rounded-xl border resize-none"
            style={{
              borderColor: dark ? 'rgba(255,255,255,0.2)' : 'var(--gray-light)',
              background: dark ? 'rgba(255,255,255,0.06)' : '#fff',
              color: fg,
            }}
          />
          <button
            onClick={() => send(input)}
            disabled={busy || !input.trim()}
            className="btn-gold text-sm px-4 py-2 rounded-xl disabled:opacity-40"
          >
            送信
          </button>
        </div>
        <div className="flex items-center justify-between mt-2">
          <div className="flex items-center gap-1">
            {MODEL_CHOICES.map((m) => (
              <button
                key={m.id}
                onClick={() => setModel(m.id)}
                title={m.note}
                className="text-[11px] px-2 py-0.5 rounded-full border transition"
                style={{
                  borderColor: model === m.id ? 'var(--gold)' : dark ? 'rgba(255,255,255,0.2)' : 'var(--gray-light)',
                  color: model === m.id ? 'var(--gold)' : 'var(--gray)',
                  fontWeight: model === m.id ? 600 : 400,
                }}
              >
                {m.label}
              </button>
            ))}
          </div>
          <span className="text-[11px]" style={{ color: 'var(--gray)' }}>
            {info?.APIキー設定済み === false ? 'APIキー未設定' : '⌘+Enterで送信'}
          </span>
        </div>
      </div>
    </div>
  )
}
