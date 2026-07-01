import { JWT } from 'google-auth-library'

function sheetId() { return process.env.SHIFT_SHEET_ID! }
async function token(readonly = false) {
  const key = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON!)
  const client = new JWT({
    email: key.client_email, key: key.private_key,
    scopes: [readonly ? 'https://www.googleapis.com/auth/spreadsheets.readonly' : 'https://www.googleapis.com/auth/spreadsheets'],
  })
  return (await client.getAccessToken()).token ?? ''
}

// 対象スプレッドシートのタブを読み取る
export async function readSheetValues(tab: string, range = 'A1:AG80'): Promise<string[][]> {
  const t = await token(true)
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId()}/values/${encodeURIComponent(tab + '!' + range)}?valueRenderOption=FORMATTED_VALUE`
  const res = await fetch(url, { headers: { Authorization: 'Bearer ' + t } })
  const j = await res.json()
  if (j.error) throw new Error(j.error.message)
  return (j.values ?? []) as string[][]
}

// タブが無ければ作成
async function ensureTab(tab: string, t: string) {
  const meta = await (await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId()}?fields=sheets.properties.title`, { headers: { Authorization: 'Bearer ' + t } })).json()
  const exists = (meta.sheets ?? []).some((s: { properties: { title: string } }) => s.properties.title === tab)
  if (!exists) {
    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId()}:batchUpdate`, {
      method: 'POST', headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests: [{ addSheet: { properties: { title: tab } } }] }),
    })
  }
}

// タブを全消し→values を書き込む（テキストのまま）
export async function writeSheet(tab: string, values: (string | number)[][]) {
  const t = await token(false)
  await ensureTab(tab, t)
  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId()}/values/${encodeURIComponent(tab + '!A1:ZZ200')}:clear`, {
    method: 'POST', headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }, body: '{}',
  })
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId()}/values/${encodeURIComponent(tab + '!A1')}?valueInputOption=RAW`, {
    method: 'PUT', headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values }),
  })
  const j = await res.json()
  if (j.error) throw new Error(j.error.message)
}
