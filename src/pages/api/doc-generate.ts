import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '@/lib/serverAuth'
import { google } from 'googleapis'
import { spreadsheetIdFromUrl, batchWriteValues, exportSheetAsPdf, getSheetsList } from '@/lib/googleSheets'

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

function getDriveClient() {
  const auth = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET)
  auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN })
  return google.drive({ version: 'v3', auth })
}

// Copy the template spreadsheet, fill it, export PDF, then delete the copy
// so the original template always stays clean.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  const authed = await requireAuth(req)
  if (!authed.ok) return res.status(authed.status).json({ error: authed.error })

  let copyId: string | null = null
  try {
    const { document_type, cusdec_id, manual_values, cdn_ids } = req.body as {
      document_type: string
      cusdec_id?: string
      manual_values?: Record<string, string>
      cdn_ids?: string[]
    }
    if (!document_type) return res.status(400).json({ error: 'document_type required' })

    // Load template + mappings
    const { data: tpl } = await sb.from('doc_templates').select('*, template_mappings(*)').eq('document_type', document_type).maybeSingle()
    if (!tpl) return res.status(404).json({ error: 'No template configured for this document type' })

    // Load CUSDEC + CDN data
    let cusdecRow: Record<string, any> | null = null
    let cdnRows: Record<string, any>[] = []
    if (cusdec_id) {
      const { data: cusdec } = await sb.from('cusdec').select('*').eq('id', cusdec_id).maybeSingle()
      cusdecRow = cusdec || null
      if (cusdec) {
        let q = sb.from('cdn').select('*').eq('code', cusdec.code).eq('cusdec_number', cusdec.number)
        if (cdn_ids?.length) q = q.in('id', cdn_ids) as typeof q
        const { data: cdns } = await q
        cdnRows = cdns || []
      }
    }

    // XML / Text templates — no spreadsheet at all: resolve each mapping's
    // value the same way as the Sheets path below, then substitute
    // {{field_label}} tags directly into the typed template body.
    if (tpl.template_format && tpl.template_format !== 'google_sheet') {
      const mappings: Array<{ field_label: string; data_source: string; column_name: string; is_repeating: boolean }> = tpl.template_mappings || []
      let content: string = tpl.template_content || ''
      for (const m of mappings) {
        let value = ''
        if (m.data_source === 'manual') value = (manual_values || {})[m.field_label] ?? ''
        else if (m.data_source === 'cusdec') {
          value = cusdecRow ? (cusdecRow[m.column_name] ?? '') : ((manual_values || {})[m.field_label] ?? '')
        } else if (m.data_source === 'cdn') {
          if (m.is_repeating && cdnRows.length) value = cdnRows.map(r => r[m.column_name] ?? '').join('\n')
          else value = cdnRows[0] ? (cdnRows[0][m.column_name] ?? '') : ((manual_values || {})[m.field_label] ?? '')
        }
        const escaped = m.field_label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        content = content.replace(new RegExp(`\\{\\{\\s*${escaped}\\s*\\}\\}`, 'g'), String(value))
      }
      const ext = tpl.template_format === 'xml' ? 'xml' : 'txt'
      const fileName = `${document_type}_${new Date().toISOString().slice(0, 10)}.${ext}`
      return res.json({
        fileName,
        base64: Buffer.from(content, 'utf-8').toString('base64'),
        mimeType: tpl.template_format === 'xml' ? 'application/xml' : 'text/plain',
        content,
      })
    }

    const spreadsheetId = spreadsheetIdFromUrl(tpl.template_url)
    if (!spreadsheetId) return res.status(400).json({ error: 'Invalid Google Sheets URL in template' })

    // Copy the template so the original stays clean
    const drive = getDriveClient()
    const copyResp = await drive.files.copy({
      fileId: spreadsheetId,
      requestBody: { name: `_tmp_${document_type}_${Date.now()}` },
    })
    copyId = copyResp.data.id!

    // Get sheets list from the COPY
    const sheetsList = await getSheetsList(copyId)
    const firstSheetTitle = sheetsList[0]?.title || 'Sheet1'

    // Build cell updates from mappings — each mapping can target a specific sheet
    const mappings: Array<{ field_label: string; data_source: string; column_name: string; is_repeating: boolean; target_cell_or_range: string; sheet_name?: string }> = tpl.template_mappings || []
    const updates: Array<{ range: string; value: string | number | null }> = []

    for (const m of mappings) {
      const sheetForField = m.sheet_name || firstSheetTitle
      const sheetPrefix = `${sheetForField}!`

      if (m.is_repeating && m.target_cell_or_range.includes(':')) {
        const rangeMatch = m.target_cell_or_range.replace(/\s/g, '').match(/^([A-Za-z]+)(\d+):([A-Za-z]+)(\d+)$/)
        if (rangeMatch) {
          const col = rangeMatch[1].toUpperCase()
          const startRow = parseInt(rangeMatch[2])
          const endRow = parseInt(rangeMatch[4])
          const sourceRows = m.data_source === 'manual' ? [] : m.data_source === 'cdn' ? cdnRows : cusdecRow ? [cusdecRow] : []
          if (sourceRows.length) {
            sourceRows.slice(0, endRow - startRow + 1).forEach((row, i) => {
              updates.push({ range: `${sheetPrefix}${col}${startRow + i}`, value: row[m.column_name] ?? '' })
            })
          } else if ((manual_values || {})[m.field_label]) {
            // No CUSDEC/CDN row to source from (pure manual entry) — fall back
            // to the newline-joined rows typed into the Manual Entry tab.
            const manualRows = manual_values![m.field_label].split('\n').filter(Boolean)
            manualRows.slice(0, endRow - startRow + 1).forEach((val, i) => {
              updates.push({ range: `${sheetPrefix}${col}${startRow + i}`, value: val })
            })
          }
        }
        continue
      }

      let value: string | number | null = ''
      if (m.data_source === 'manual') value = (manual_values || {})[m.field_label] ?? ''
      else if (m.data_source === 'cusdec') value = cusdecRow ? (cusdecRow[m.column_name] ?? '') : ((manual_values || {})[m.field_label] ?? '')
      else if (m.data_source === 'cdn') value = cdnRows[0] ? (cdnRows[0][m.column_name] ?? '') : ((manual_values || {})[m.field_label] ?? '')
      updates.push({ range: `${sheetPrefix}${m.target_cell_or_range.toUpperCase()}`, value })
    }

    if (updates.length) await batchWriteValues(copyId, updates)

    // Export PDF — fit_to_page shrinks content to fit the page
    const printSheetName = tpl.print_sheet_name || firstSheetTitle
    const matchedSheet = sheetsList.find(s => s.title === printSheetName) || sheetsList[0]
    const pdfBuffer = await exportSheetAsPdf(copyId, {
      sheetGid: matchedSheet?.sheetId ?? 0,
      range: tpl.print_range || undefined,
      landscape: (tpl.orientation || 'Portrait').toLowerCase() === 'landscape',
      paperSize: tpl.paper_size || 'A4',
      scale: tpl.fit_to_page !== false ? 4 : 2,
    })

    // Delete the copy
    await drive.files.delete({ fileId: copyId })
    copyId = null

    const fileName = `${document_type}_${new Date().toISOString().slice(0, 10)}.pdf`
    return res.json({ fileName, base64: pdfBuffer.toString('base64') })
  } catch (e: any) {
    // Clean up copy if something failed mid-way
    if (copyId) {
      try { const drive = getDriveClient(); await drive.files.delete({ fileId: copyId }) } catch {}
    }
    console.error('[doc-generate]', e)
    res.status(500).json({ error: e.message })
  }
}
