import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '@/lib/serverAuth'
import { getSheetsList, spreadsheetIdFromUrl } from '@/lib/googleSheets'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Lists worksheets inside a Google Sheets template so the cell mapping UI
// can offer a per-field sheet picker. Accepts either ?template_id= (looks up
// the sheet_url / drive_url from the DB) or ?sheet_url= directly.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end()
  const authed = await requireAuth(req)
  if (!authed.ok) return res.status(authed.status).json({ error: authed.error })
  try {
    let sheetUrl: string | null = String(req.query.sheet_url || '')

    if (!sheetUrl && req.query.template_id) {
      const { data } = await supabaseAdmin
        .from('document_templates')
        .select('sheet_url, drive_url')
        .eq('id', String(req.query.template_id))
        .maybeSingle()
      sheetUrl = data?.sheet_url || data?.drive_url || null
    }

    if (!sheetUrl) return res.status(400).json({ error: 'sheet_url or template_id required' })

    const spreadsheetId = spreadsheetIdFromUrl(sheetUrl)
    if (!spreadsheetId) return res.status(400).json({ error: 'Could not extract spreadsheet ID from URL' })

    const sheets = await getSheetsList(spreadsheetId)
    res.json({ sheets, spreadsheetId })
  } catch (err: any) {
    console.error('[excel-template-sheets] error:', err)
    res.status(500).json({ error: err.message })
  }
}
