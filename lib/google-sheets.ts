import { JWT } from 'google-auth-library'

// サービスアカウントで対象スプレッドシートのタブを読み取る
export async function readSheetValues(tab: string, range = 'A1:AG80'): Promise<string[][]> {
  const key = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON!)
  const sheetId = process.env.SHIFT_SHEET_ID!
  const client = new JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  })
  const { token } = await client.getAccessToken()
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(tab + '!' + range)}?valueRenderOption=FORMATTED_VALUE`
  const res = await fetch(url, { headers: { Authorization: 'Bearer ' + token } })
  const j = await res.json()
  if (j.error) throw new Error(j.error.message)
  return (j.values ?? []) as string[][]
}
