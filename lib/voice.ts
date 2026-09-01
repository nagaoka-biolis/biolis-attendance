// ブラウザ内蔵の音声機能。追加の契約も費用も不要。
//   話す → 文字起こし: Web Speech Recognition（Chrome系）
//   回答を読み上げ:     Web Speech Synthesis（ほぼ全ブラウザ）
//
// ⚠️ iPhone/iPad の Safari は音声認識に非対応。読み上げは動く。
//    iOSではキーボードのマイク（標準の音声入力）で文字にできるので、
//    マイクボタンが出ない場合はそちらを使う。

type SpeechRecognitionLike = {
  lang: string
  continuous: boolean
  interimResults: boolean
  start(): void
  stop(): void
  abort(): void
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null
  onerror: ((e: { error?: string }) => void) | null
  onend: (() => void) | null
}

type WindowWithSpeech = Window & {
  SpeechRecognition?: new () => SpeechRecognitionLike
  webkitSpeechRecognition?: new () => SpeechRecognitionLike
}

// 音声認識が使えるか（Chrome系ならtrue、iOS Safariはfalse）
export function speechInputAvailable(): boolean {
  if (typeof window === 'undefined') return false
  const w = window as WindowWithSpeech
  return Boolean(w.SpeechRecognition ?? w.webkitSpeechRecognition)
}

export function createRecognition(): SpeechRecognitionLike | null {
  if (typeof window === 'undefined') return null
  const w = window as WindowWithSpeech
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition
  if (!Ctor) return null
  const r = new Ctor()
  r.lang = 'ja-JP'
  r.continuous = false
  r.interimResults = true
  return r
}

// 読み上げ用にマークダウンを外す。
// 表の記号や ** を読み上げると聞き苦しいので、意味のある部分だけ残す。
export function stripForSpeech(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      // 表の区切り行（|---|---|）は読まない
      if (/^\s*\|[\s:|-]+\|\s*$/.test(line)) return ''
      // 表の行は「セル、セル、セル」と読む
      if (/^\s*\|.*\|\s*$/.test(line)) {
        return line.trim().slice(1, -1).split('|').map((c) => c.trim()).filter(Boolean).join('、')
      }
      return line
    })
    .join('\n')
    .replace(/\*\*/g, '')
    .replace(/^#{1,4}\s*/gm, '')
    .replace(/^\s*[-*]\s+/gm, '')
    .replace(/\n{2,}/g, '\n')
    .trim()
}

export function speechOutputAvailable(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

// 日本語の声を選ぶ。読み込みが非同期なブラウザがあるので、無ければ既定の声に任せる。
function japaneseVoice(): SpeechSynthesisVoice | null {
  if (!speechOutputAvailable()) return null
  const voices = window.speechSynthesis.getVoices()
  return voices.find((v) => v.lang === 'ja-JP') ?? voices.find((v) => v.lang?.startsWith('ja')) ?? null
}

// iOS（Chromeを含む。中身はすべてSafari）は「ユーザーが触った直後」でないと
// 音声を出せない。回答が返るのは操作から数秒後なので、そのままだと無音になる。
// 対策として、送信ボタンやマイクを押したその瞬間に空の発話を1回流し、
// 音声を使える状態にしておく（一度通せば、以降はあとから喋らせても鳴る）。
let primed = false
export function primeSpeech(): void {
  if (primed || !speechOutputAvailable()) return
  try {
    // 無音(volume 0)では解錠されない端末があるため、極小音量の短い発話を使う
    const u = new SpeechSynthesisUtterance('。')
    u.volume = 0.01
    u.rate = 2
    u.lang = 'ja-JP'
    window.speechSynthesis.speak(u)
    primed = true
  } catch {
    // 使えない環境では諦める（読み上げボタンから手動で鳴らせる）
  }
}

export function isSpeaking(): boolean {
  return speechOutputAvailable() && window.speechSynthesis.speaking
}

// 読み上げ用に「耳で分かる言い方」へ直す。
// 画面用の文章をそのまま読ませると、4,442,375円が「よんてんよんよんに…」、
// 8/21が「はちスラッシュにじゅういち」になって聞き取れない。
function forEar(text: string): string {
  return (
    text
      // 8/21 → 8月21日
      .replace(/(\d{1,2})\/(\d{1,2})/g, '$1月$2日')
      // 4,442,375円 → 約444万円（3桁区切りの大きい数字は概数で読む）
      .replace(/(\d{1,3}(?:,\d{3})+)\s*円/g, (_m, n: string) => {
        const v = Number(n.replace(/,/g, ''))
        if (v >= 100000000) return `約${Math.round(v / 10000000) / 10}億円`
        if (v >= 10000) return `約${Math.round(v / 10000)}万円`
        return `${v}円`
      })
      .replace(/Dr\b/g, '先生')
      .replace(/[（(]夜[)）]/g, 'の夜の枠')
      .replace(/→/g, 'から')
      .replace(/[＋+]/g, 'プラス')
      .replace(/%/g, 'パーセント')
      .replace(/～/g, 'から')
  )
}

// 読み上げ用のテキストを作る。
// 表は読まない（セル名が延々続き意味が取れない）。表の前後の文章は全部読む。
export function speechText(text: string): string {
  const parts: string[] = []
  let tableNoted = false
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    if (/^\|/.test(line)) {
      if (!tableNoted) {
        parts.push('詳しい表は画面をご覧ください')
        tableNoted = true
      }
      continue
    }
    tableNoted = false
    parts.push(
      line
        .replace(/^#{1,4}\s*/, '')
        .replace(/^[-*]\s+/, '')
        .replace(/\*\*/g, '')
        .replace(/[。．]$/, '')
    )
  }
  return forEar(parts.join('。'))
}

// 句点・読点で区切る。文の途中や数字の途中では切らない。
// 機械的に文字数で切ると不自然な間が入って聞き取りにくくなる。
function chunk(text: string, max = 90): string[] {
  // まず句点で分け、長すぎるものだけ読点でさらに分ける
  const sentences = text.split(/(?<=[。！？])/).flatMap((sen) =>
    sen.length <= max ? [sen] : sen.split(/(?<=、)/)
  )
  const out: string[] = []
  let cur = ''
  for (const sen of sentences) {
    if (cur && (cur + sen).length > max) {
      out.push(cur)
      cur = sen
    } else cur += sen
  }
  if (cur.trim()) out.push(cur)
  return out
}

// onBlocked: 呼んだのに音が始まらなかったとき（iOSで操作から離れている場合など）。
// 呼び出し側は「タップして聞く」ボタンを出して、確実に鳴らせる逃げ道を用意する。
export function speak(text: string, onEnd?: () => void, onBlocked?: () => void): void {
  if (!speechOutputAvailable()) { onEnd?.(); return }
  // iOSでは直前の cancel() が原因で無音になることがあるため、鳴っている時だけ止める
  if (window.speechSynthesis.speaking || window.speechSynthesis.pending) {
    window.speechSynthesis.cancel()
  }
  const body = speechText(text)
  if (!body) { onEnd?.(); return }

  const v = japaneseVoice()
  const pieces = chunk(body)
  pieces.forEach((piece, i) => {
    const u = new SpeechSynthesisUtterance(piece)
    u.lang = 'ja-JP'
    if (v) u.voice = v
    u.rate = 1.05
    if (i === pieces.length - 1) {
      u.onend = () => onEnd?.()
      u.onerror = () => onEnd?.()
    }
    window.speechSynthesis.speak(u)
  })

  // 実際に鳴り始めたか確かめる。始まっていなければ端末に止められている。
  if (onBlocked) {
    setTimeout(() => {
      if (!window.speechSynthesis.speaking && !window.speechSynthesis.pending) {
        onEnd?.()
        onBlocked()
      }
    }, 600)
  }
}

// 追加で読み上げる（今鳴っているものを止めない）。
// 回答が届いた端から喋るために使う。止めてしまうと文が途切れる。
export function speakChunk(text: string, onEnd?: () => void): void {
  if (!speechOutputAvailable()) { onEnd?.(); return }
  const body = forEar(text).trim()
  if (!body) { onEnd?.(); return }
  const v = japaneseVoice()
  for (const piece of chunk(body)) {
    const u = new SpeechSynthesisUtterance(piece)
    u.lang = 'ja-JP'
    if (v) u.voice = v
    u.rate = 1.05
    u.onend = () => onEnd?.()
    u.onerror = () => onEnd?.()
    window.speechSynthesis.speak(u)
  }
}

export function stopSpeaking(): void {
  if (speechOutputAvailable()) window.speechSynthesis.cancel()
}
