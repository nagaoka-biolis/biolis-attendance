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
    const u = new SpeechSynthesisUtterance(' ')
    u.volume = 0
    u.lang = 'ja-JP'
    window.speechSynthesis.speak(u)
    primed = true
  } catch {
    // 使えない環境では諦める（読み上げボタンから手動で鳴らせる）
  }
}

export function speak(text: string, onEnd?: () => void): void {
  if (!speechOutputAvailable()) { onEnd?.(); return }
  window.speechSynthesis.cancel()
  const body = stripForSpeech(text)
  if (!body) { onEnd?.(); return }

  const u = new SpeechSynthesisUtterance(body)
  u.lang = 'ja-JP'
  const v = japaneseVoice()
  if (v) u.voice = v
  u.rate = 1.05
  u.onend = () => onEnd?.()
  u.onerror = () => onEnd?.()
  window.speechSynthesis.speak(u)
}

export function stopSpeaking(): void {
  if (speechOutputAvailable()) window.speechSynthesis.cancel()
}
