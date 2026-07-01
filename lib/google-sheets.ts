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

async function getSheetGid(tab: string, t: string): Promise<number> {
  const meta = await (await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId()}?fields=sheets.properties`, { headers: { Authorization: 'Bearer ' + t } })).json()
  const s = (meta.sheets ?? []).find((x: { properties: { title: string } }) => x.properties.title === tab)
  return s?.properties.sheetId
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

// 希望タブ：値の書き込み＋土日色分け・見出し固定（他タブ風）
// values: row0=タイトル / row1=名前+日番号 / row2=空+曜日 / row3..=スタッフ行
export async function writeShiftGrid(tab: string, values: (string | number)[][], year: number, month: number) {
  const t = await token(false)
  await ensureTab(tab, t)
  const gid = await getSheetGid(tab, t)
  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId()}/values/${encodeURIComponent(tab + '!A1:ZZ200')}:clear`, {
    method: 'POST', headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }, body: '{}',
  })
  const wr = await (await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId()}/values/${encodeURIComponent(tab + '!A1')}?valueInputOption=RAW`, {
    method: 'PUT', headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }, body: JSON.stringify({ values }),
  })).json()
  if (wr.error) throw new Error(wr.error.message)

  const days = new Date(year, month, 0).getDate()
  const totalRows = values.length
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const requests: any[] = [
    { updateSheetProperties: { properties: { sheetId: gid, gridProperties: { frozenRowCount: 3, frozenColumnCount: 1 } }, fields: 'gridProperties.frozenRowCount,gridProperties.frozenColumnCount' } },
    { repeatCell: { range: { sheetId: gid, startRowIndex: 1, endRowIndex: 3 }, cell: { userEnteredFormat: { textFormat: { bold: true }, horizontalAlignment: 'CENTER' } }, fields: 'userEnteredFormat.textFormat.bold,userEnteredFormat.horizontalAlignment' } },
  ]
  for (let d = 1; d <= days; d++) {
    const wd = new Date(year, month - 1, d).getDay()
    if (wd !== 0 && wd !== 6) continue
    const col = d // A=0(名前), B=1=1日 → d日は列d
    requests.push({ repeatCell: { range: { sheetId: gid, startColumnIndex: col, endColumnIndex: col + 1, startRowIndex: 1, endRowIndex: totalRows }, cell: { userEnteredFormat: { backgroundColor: wd === 0 ? { red: 0.99, green: 0.91, blue: 0.91 } : { red: 0.91, green: 0.94, blue: 0.99 } } }, fields: 'userEnteredFormat.backgroundColor' } })
  }
  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId()}:batchUpdate`, {
    method: 'POST', headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }, body: JSON.stringify({ requests }),
  })
}
