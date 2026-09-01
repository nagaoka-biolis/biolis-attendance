'use client'

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { supabase } from '@/lib/supabase'
import { MODEL_CHOICES } from '@/lib/ai-models'
import {
  createRecognition,
  speechInputAvailable,
  speechOutputAvailable,
  speak,
  stopSpeaking,
  primeSpeech,
} from '@/lib/voice'

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

// 状態表示の球。待機／聞き取り中／考え中／読み上げ中で色と動きが変わる。
function Orb({ state }: { state: 'idle' | 'listening' | 'thinking' | 'speaking' }) {
  const look = {
    idle: { color: '#C9A84C', label: '待機中' },
    listening: { color: '#E05B54', label: '聞いています' },
    thinking: { color: '#5B8FE0', label: '考えています' },
    speaking: { color: '#E8C97A', label: '話しています' },
  }[state]
  const active = state !== 'idle'
  return (
    <div className="flex flex-col items-center justify-center py-5 select-none">
      <div className="relative" style={{ width: 96, height: 96, color: look.color }}>
        {active && <span className="ai-orb-ring" />}
        <div
          className={`ai-orb w-full h-full${active ? ' is-active' : ''}`}
          style={{
            background: `radial-gradient(circle at 50% 45%, #fff 0%, ${look.color} 38%, ${look.color}22 72%, transparent 78%)`,
            boxShadow: `0 0 44px ${look.color}66`,
          }}
        />
      </div>
      <p className="text-[11px] mt-3 tracking-widest" style={{ color: look.color }}>
        {look.label}
      </p>
    </div>
  )
}

// 音声対応の有無は変化しないので、購読は何もしない
const noSubscribe = () => () => {}

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
  const [denyReason, setDenyReason] = useState<string | null>(null)
  const endRef = useRef<HTMLDivElement>(null)

  // 音声まわり
  // 回答を読み上げるか。全画面(/ai)は声で使う画面なので既定ON、
  // 管理画面に埋め込んだ小窓は他の作業中に喋り出さないよう既定OFF。
  const [voiceOn, setVoiceOn] = useState(variant === 'full')
  const [listening, setListening] = useState(false) // マイクで聞き取り中か
  const [speaking, setSpeaking] = useState(false) // 読み上げ中か
  // 音声が使えるかはブラウザ次第で、途中で変わらない。
  // サーバ側描画では false を返して、画面が食い違わないようにする。
  const canListen = useSyncExternalStore(noSubscribe, speechInputAvailable, () => false)
  const canSpeak = useSyncExternalStore(noSubscribe, speechOutputAvailable, () => false)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recogRef = useRef<any>(null)
  const sendRef = useRef<(t: string) => void>(() => {})

  // CSVのまとめ取り込み（管理画面の小窓にだけ出す）
  const [uploading, setUploading] = useState(false)
  const [uploadMsg, setUploadMsg] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const uploadCsv = async (list: FileList) => {
    const fd = new FormData()
    Array.from(list).forEach((f) => fd.append('files', f))
    setUploading(true)
    setUploadMsg(`${list.length}件を取り込み中…`)
    try {
      const res = await fetch('/api/sales-upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${await token()}` },
        body: fd,
      })
      const j = await res.json().catch(() => null)
      if (!res.ok) setUploadMsg(j?.error ?? '取り込みに失敗しました')
      else {
        const ng = (j?.見送り ?? []) as string[]
        setUploadMsg(`${j.取り込んだ件数}件を取り込みました${ng.length ? `／${ng.length}件は見送り` : ''}`)
      }
    } catch {
      setUploadMsg('取り込みに失敗しました')
    } finally {
      setUploading(false)
    }
  }

  const token = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession()
    return session?.access_token ?? ''
  }, [])

  // 起動時に権限と材料の状況を確認（AIは呼ばないので費用はかからない）。
  // ログイン情報の復元が間に合わないことがあるので、認証の変化も拾って読み直す。
  // 「権限なし」と「通信失敗」を混同しないよう、理由を分けて持つ。
  useEffect(() => {
    let done = false
    const load = async (t: string) => {
      if (done) return
      try {
        const res = await fetch('/api/ai-chat', { headers: { Authorization: `Bearer ${t}` } })
        if (res.ok) {
          const j = await res.json().catch(() => null)
          setAllowed(true)
          setInfo(j)
          setModel(String(j?.既定のモデル ?? ''))
          setDenyReason(null)
        } else if (res.status === 403) {
          setDenyReason('権限がありません')
        } else if (res.status === 401) {
          setDenyReason('ログインの確認ができませんでした。画面を更新してください')
        } else {
          const j = await res.json().catch(() => null)
          setDenyReason(`読み込みに失敗しました（${res.status}）${j?.error ? `：${j.error}` : ''}`)
        }
        done = true
      } catch {
        setDenyReason('接続できませんでした。通信環境を確認して画面を更新してください')
      } finally {
        setReady(true)
      }
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.access_token) load(session.access_token)
    })
    // 直後はセッションが復元されていないことがあるため、変化も拾う
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (session?.access_token) load(session.access_token)
    })
    // 認証イベントが来ないまま止まらないよう、数秒で打ち切る
    const timer = setTimeout(() => setReady(true), 6000)
    return () => {
      done = true
      clearTimeout(timer)
      sub.subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [turns, busy])

  // 画面を離れるときは読み上げを止める
  useEffect(() => () => stopSpeaking(), [])

  // マイクの開始／停止。話し終わるとそのまま質問として送る。
  const toggleMic = () => {
    primeSpeech()
    if (listening) {
      recogRef.current?.stop()
      return
    }
    stopSpeaking()
    setSpeaking(false)
    const r = createRecognition()
    if (!r) return
    recogRef.current = r
    let finalText = ''
    r.onresult = (e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => {
      let interim = ''
      for (let i = 0; i < e.results.length; i++) {
        const res = e.results[i]
        const t = res[0]?.transcript ?? ''
        if (res.isFinal) finalText += t
        else interim += t
      }
      setInput(finalText + interim)
    }
    r.onerror = () => setListening(false)
    r.onend = () => {
      setListening(false)
      const said = finalText.trim()
      if (said) sendRef.current(said)
    }
    setInput('')
    setListening(true)
    r.start()
  }

  const send = async (text: string, spokenInput = false) => {
    const q = text.trim()
    if (!q || busy) return
    // iOSは操作した瞬間しか喋れないため、ここで音声を使える状態にしておく
    primeSpeech()
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
        const answer = String(j.answer ?? '')
        setTurns((p) => [...p, { role: 'assistant', content: answer }])
        if ((voiceOn || spokenInput) && answer) {
          setSpeaking(true)
          speak(answer, () => setSpeaking(false))
        }
      }
    } catch {
      setError('通信に失敗しました')
    } finally {
      setBusy(false)
    }
  }

  // マイクの終了時から send を呼べるようにしておく
  useEffect(() => {
    sendRef.current = (t: string) => { void send(t, true) }
  })

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
          {denyReason === '権限がありません'
            ? 'BiOLiS AI の利用権限がありません'
            : 'BiOLiS AI を開けませんでした'}
        </p>
        <p className="text-xs" style={{ color: 'var(--gray)' }}>
          {denyReason === '権限がありません'
            ? '経営数字を扱うため、利用者を限定しています。必要な場合は管理者にご連絡ください。'
            : (denyReason ?? '読み込めませんでした。画面を更新してください')}
        </p>
        <button
          onClick={() => window.location.reload()}
          className="text-xs px-4 py-2 rounded-full border mt-1"
          style={{ borderColor: dark ? 'rgba(255,255,255,0.25)' : 'var(--gray-light)', color: dark ? '#fff' : 'var(--navy)' }}
        >
          画面を更新
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full" style={{ background: bg, color: fg }}>
      {dark && (
        <div className="shrink-0 border-b" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
          <Orb state={listening ? 'listening' : busy ? 'thinking' : speaking ? 'speaking' : 'idle'} />
        </div>
      )}

      {/* 会話 */}
      <div className={`flex-1 overflow-y-auto px-4 ${dark ? 'py-4' : 'py-2'}`}>
        {/* CSVのまとめ取り込み（管理画面の小窓にだけ。会長の全画面には出さない） */}
        {!dark && (
          <div
            className="mb-3 px-3 py-2 rounded-lg border text-xs flex items-center justify-between gap-2"
            style={{ borderColor: 'var(--gray-light)', background: '#fff' }}
          >
            <span style={{ color: 'var(--gray)' }}>
              {uploadMsg ?? 'ACUSISのCSVをまとめて取り込めます（患者名は保存前に消えます）'}
            </span>
            <input
              ref={fileRef}
              type="file"
              accept=".csv"
              multiple
              className="hidden"
              onChange={(e) => { if (e.target.files?.length) uploadCsv(e.target.files); e.target.value = '' }}
            />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="shrink-0 px-3 py-1 rounded-full border disabled:opacity-40"
              style={{ borderColor: 'var(--gold)', color: 'var(--gold)' }}
            >
              {uploading ? '取り込み中…' : 'CSVを取り込む'}
            </button>
          </div>
        )}

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
                {canSpeak && (
                  <button
                    onClick={() => {
                      stopSpeaking()
                      setSpeaking(true)
                      speak(t.content, () => setSpeaking(false))
                    }}
                    className="text-[11px] mt-2 px-2 py-0.5 rounded-full border"
                    style={{
                      borderColor: dark ? 'rgba(255,255,255,0.25)' : 'var(--gray-light)',
                      color: 'var(--gray)',
                    }}
                  >
                    🔊 読み上げる
                  </button>
                )}
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
          {canListen && (
            <button
              onClick={toggleMic}
              disabled={busy}
              title={listening ? '停止' : '話す'}
              aria-label={listening ? '停止' : '話す'}
              className="shrink-0 w-11 h-11 rounded-full border flex items-center justify-center transition disabled:opacity-40"
              style={{
                borderColor: listening ? '#d9534f' : dark ? 'rgba(255,255,255,0.25)' : 'var(--gray-light)',
                background: listening ? '#d9534f' : 'transparent',
                color: listening ? '#fff' : dark ? '#fff' : 'var(--navy)',
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <rect x="9" y="2" width="6" height="12" rx="3" />
                <path d="M5 11a7 7 0 0 0 14 0" />
                <path d="M12 18v4" />
              </svg>
            </button>
          )}
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
          <div className="flex items-center gap-2">
            {canSpeak && (
              <button
                onClick={() => {
                  if (voiceOn) { stopSpeaking(); setSpeaking(false) }
                  setVoiceOn(!voiceOn)
                }}
                className="text-[11px] px-2 py-0.5 rounded-full border transition"
                style={{
                  borderColor: voiceOn ? 'var(--gold)' : dark ? 'rgba(255,255,255,0.2)' : 'var(--gray-light)',
                  color: voiceOn ? 'var(--gold)' : 'var(--gray)',
                  fontWeight: voiceOn ? 600 : 400,
                }}
              >
                {voiceOn ? '読み上げ ON' : '読み上げ OFF'}
              </button>
            )}
            <span className="text-[11px]" style={{ color: 'var(--gray)' }}>
              {info?.APIキー設定済み === false
                ? 'APIキー未設定'
                : listening
                  ? '聞いています…'
                  : speaking
                    ? '読み上げ中'
                    : '⌘+Enterで送信'}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
