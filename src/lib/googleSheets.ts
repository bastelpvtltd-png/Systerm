import { google, sheets_v4 } from 'googleapis'

// Returns an authenticated Google Sheets client using the same OAuth2
// credentials used by the Drive client — same account, same tokens.
function getSheetsAuth() {
  const clientId = process.env.GOOGLE_CLIENT_ID || ''
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || ''
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN || ''
  if (!clientId || !clientSecret || !refreshToken) throw new Error('Google OAuth credentials not configured')
  const auth = new google.auth.OAuth2(clientId, clientSecret)
  auth.setCredentials({ refresh_token: refreshToken })
  return auth
}

export function getSheetsClient(): sheets_v4.Sheets {
  return google.sheets({ version: 'v4', auth: getSheetsAuth() })
}

// Extracts the spreadsheet ID from any Google Sheets URL.
export function spreadsheetIdFromUrl(url: string): string | null {
  const m = String(url).match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/)
  return m ? m[1] : null
}

// Returns all worksheets in a spreadsheet — { title, sheetId (gid) }.
export async function getSheetsList(spreadsheetId: string): Promise<Array<{ title: string; sheetId: number }>> {
  const sheets = getSheetsClient()
  const res = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties(title,sheetId)' })
  return (res.data.sheets || []).map(s => ({
    title: s.properties?.title || '',
    sheetId: s.properties?.sheetId ?? 0,
  }))
}

// Writes multiple cell values to a spreadsheet in a single batch request.
// Each update: { range: 'SheetName!B5', value: 'hello' }
export async function batchWriteValues(
  spreadsheetId: string,
  updates: Array<{ range: string; value: string | number | null }>
): Promise<void> {
  if (!updates.length) return
  const sheets = getSheetsClient()
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: 'USER_ENTERED',
      data: updates.map(u => ({
        range: u.range,
        values: [[u.value ?? '']],
      })),
    },
  })
}

export interface PdfExportOptions {
  sheetGid?: number      // which sheet (gid number); omit = first sheet
  range?: string | null  // e.g. "A1:F50"; omit = whole sheet
  landscape?: boolean    // default: landscape (true)
  paperSize?: string     // 'A4' (default) | 'Letter' | etc.
  scale?: 1 | 2 | 3 | 4 // 1=normal, 2=fit width, 3=fit height, 4=fit to page
  topMargin?: number     // inches, default 0.25
  bottomMargin?: number
  leftMargin?: number
  rightMargin?: number
  showGridlines?: boolean
}

// Exports a Google Sheet (or a specific sheet/range within it) as a PDF.
// Uses the spreadsheet's native PDF export endpoint with an OAuth bearer token
// — this preserves all formatting, merged cells, fonts, colours and borders
// exactly as they appear in the sheet, which jsPDF cannot replicate.
export async function exportSheetAsPdf(spreadsheetId: string, options: PdfExportOptions = {}): Promise<Buffer> {
  const {
    sheetGid,
    range,
    landscape = true,
    paperSize = 'A4',
    scale = 4,
    topMargin = 0.25,
    bottomMargin = 0.25,
    leftMargin = 0.25,
    rightMargin = 0.25,
    showGridlines = false,
  } = options

  const auth = getSheetsAuth()
  const { token } = await auth.getAccessToken()
  if (!token) throw new Error('Could not obtain Google OAuth access token')

  const url = new URL(`https://docs.google.com/spreadsheets/d/${spreadsheetId}/export`)
  url.searchParams.set('format', 'pdf')
  url.searchParams.set('size', paperSize)
  url.searchParams.set('portrait', landscape ? 'false' : 'true')
  url.searchParams.set('scale', String(scale))
  url.searchParams.set('top_margin', String(topMargin))
  url.searchParams.set('bottom_margin', String(bottomMargin))
  url.searchParams.set('left_margin', String(leftMargin))
  url.searchParams.set('right_margin', String(rightMargin))
  url.searchParams.set('gridlines', showGridlines ? 'true' : 'false')
  url.searchParams.set('printtitle', 'false')
  url.searchParams.set('sheetnames', 'false')
  url.searchParams.set('fzr', 'false')
  if (sheetGid !== undefined) url.searchParams.set('gid', String(sheetGid))
  if (range) url.searchParams.set('range', range)

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => String(res.status))
    throw new Error(`Google Sheets PDF export failed: ${res.status} ${text.slice(0, 200)}`)
  }
  return Buffer.from(await res.arrayBuffer())
}
