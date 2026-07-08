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

// access token を取得（scope=bot）
async function getAccessToken(): Promise<string> {
  const body = new URLSearchParams({
    assertion: buildAssertion(),
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    client_id: process.env.LINEWORKS_CLIENT_ID!,
    client_secret: process.env.LINEWORKS_CLIENT_SECRET!,
    scope: 'bot',
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

// 保存済み channelId を app_settings から取り出す
async function getChannelId(): Promise<string | null> {
  const admin = adminClient()
  const { data } = await admin
    .from('app_settings')
    .select('value')
    .eq('key', 'lineworks_channel_id')
    .maybeSingle()
  return (data as { value?: string } | null)?.value ?? null
}

// 指定channelにテキスト送信
export async function sendChannelMessage(channelId: string, text: string): Promise<void> {
  const token = await getAccessToken()
  const botId = process.env.LINEWORKS_BOT_ID!
  const res = await fetch(`${API_BASE}/bots/${botId}/channels/${channelId}/messages`, {
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
