import crypto from 'crypto'
import { adminClient } from './server-admin'

// LINE WORKS Bot にテキストメッセージを送るためのヘルパー群。
// JWT(service account) → access token → messages API の順で叩く。

const TOKEN_URL = 'https://auth.worksmobile.com/oauth2/v2.0/token'
const API_BASE = 'https://www.worksapis.com/v1.0'

function b64url(input: string | Buffer): string {
  return Buffer.from(input).toString('base64url')
}

// service account の秘密鍵で RS256 の JWT を生成
function buildAssertion(): string {
  const clientId = process.env.LINEWORKS_CLIENT_ID!
  const serviceAccount = process.env.LINEWORKS_SERVICE_ACCOUNT!
  // Vercel env に貼った改行が \n にエスケープされていても実改行でも動くように正規化
  const privateKey = (process.env.LINEWORKS_PRIVATE_KEY || '').replace(/\\n/g, '\n')

  const now = Math.floor(Date.now() / 1000)
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const payload = b64url(
    JSON.stringify({ iss: clientId, sub: serviceAccount, iat: now, exp: now + 60 * 60 })
  )
  const signingInput = `${header}.${payload}`
  const signature = crypto
    .sign('RSA-SHA256', Buffer.from(signingInput), privateKey)
    .toString('base64url')
  return `${signingInput}.${signature}`
}

// access token を取得（既定 scope=bot。添付DLは bot.read が必要なため scope指定可）
async function getAccessToken(scope = 'bot'): Promise<string> {
  const body = new URLSearchParams({
    assertion: buildAssertion(),
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    client_id: process.env.LINEWORKS_CLIENT_ID!,
    client_secret: process.env.LINEWORKS_CLIENT_SECRET!,
    scope,
  })
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok || !json.access_token) {
    throw new Error(`token取得失敗: ${res.status} ${JSON.stringify(json)}`)
  }
  return json.access_token as string
}

// Botが受け取った添付ファイルをダウンロード（ファイル名＋本文テキストを返す）
export async function downloadBotAttachment(
  botId: string,
  fileId: string
): Promise<{ filename: string; content: string }> {
  // 添付DLは bot.read スコープが必要（アプリのOAuth Scopeに bot.read の付与も必須）
  const token = await getAccessToken('bot.read')
  // リダイレクトは手動処理（リダイレクト先にBearerを付けると弾かれるため）
  const res = await fetch(`${API_BASE}/bots/${botId}/attachments/${fileId}`, {
    headers: { Authorization: `Bearer ${token}` },
    redirect: 'manual',
  })

  const parseName = (cd: string): string => {
    const star = cd.match(/filename\*=(?:UTF-8'')?([^;]+)/i)
    const plain = cd.match(/filename="?([^";]+)"?/i)
    if (star) { try { return decodeURIComponent(star[1].replace(/"/g, '')).trim() } catch { return star[1].trim() } }
    if (plain) return plain[1].trim()
    return ''
  }

  const loc = res.headers.get('location')
  const cd0 = res.headers.get('content-disposition') || ''

  // 302 → リダイレクト先(ストレージ)にも同じ認証を付けて取得
  if (res.status >= 300 && res.status < 400 && loc) {
    const res2 = await fetch(loc, { headers: { Authorization: `Bearer ${token}` } })
    if (!res2.ok) {
      const t = await res2.text().catch(() => '')
      throw new Error(`添付DL(redirect)失敗: ${res2.status} ${t.slice(0, 150)}`)
    }
    const filename = parseName(res2.headers.get('content-disposition') || cd0)
    return { filename, content: await res2.text() }
  }

  // 200直接
  if (res.status === 200) {
    return { filename: parseName(cd0), content: await res.text() }
  }

  const body = await res.text().catch(() => '')
  throw new Error(`添付DL失敗: status=${res.status} loc=${loc ? 'yes' : 'no'} ${body.slice(0, 150)}`)
}

// app_settings から任意キーの値を取り出す
export async function getSetting(key: string): Promise<string | null> {
  const admin = adminClient()
  const { data } = await admin
    .from('app_settings')
    .select('value')
    .eq('key', key)
    .maybeSingle()
  return (data as { value?: string } | null)?.value ?? null
}

// 保存済み channelId（勤怠）を app_settings から取り出す
async function getChannelId(): Promise<string | null> {
  return getSetting('lineworks_channel_id')
}

// 指定channelにテキスト送信。botId未指定なら勤怠Bot(env)。
// 同一テナントのアプリトークンは任意のBotとして送信できるため、
// botIdを渡せば別Bot（例:小口現金）として送れる。
export async function sendChannelMessage(channelId: string, text: string, botId?: string): Promise<void> {
  const token = await getAccessToken()
  const bid = botId || process.env.LINEWORKS_BOT_ID!
  const res = await fetch(`${API_BASE}/bots/${bid}/channels/${channelId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ content: { type: 'text', text } }),
  })
  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`メッセージ送信失敗: ${res.status} ${errText}`)
  }
}

// 勤怠管理グループ（保存済みchannelId）へ通知。channelId未保存なら false を返す。
export async function notifyKintai(text: string): Promise<boolean> {
  const channelId = await getChannelId()
  if (!channelId) return false
  await sendChannelMessage(channelId, text)
  return true
}

export type ClockType = 'clock_in' | 'clock_out' | 'break_start' | 'break_end'

// 打刻内容を整形して勤怠管理グループへ通知
export async function notifyClock(
  name: string,
  type: ClockType,
  isValid: boolean
): Promise<boolean> {
  const label = {
    clock_in: '🟢 出勤',
    clock_out: '🔴 退勤',
    break_start: '☕ 休憩開始',
    break_end: '🔚 休憩終了',
  }[type]
  const at = new Date().toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
  let text = `${label}  ${name}\n🕐 ${at}`
  if (!isValid) text += '\n⚠️ クリニック外からの打刻（要確認）'
  return notifyKintai(text)
}
