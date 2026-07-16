import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '@/lib/serverAuth'
import {
  spreadsheetIdFromUrl, getSheetsList,
  batchWriteValues, exportSheetAsPdf, PdfExportOptions,
} from '@/lib/googleSheets'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Fills a Google Sheets template with CUSDEC / CDN / manual data, then
// exports the specified sheet+range as a PDF via Google's own renderer —
// which preserves every border, merge, font and colour that jsPDF couldn't.
//
// Request body:
//   template_id   — required
//   cusdec_id     — optional; populates cusdec + cdn fields
//   manual_values — optional; map of key → value for manual fields
//   print_sheet   — which sheet name to export (overrides template saved config)
//   print_range   — cell range to export, e.g. "A1:F50" (overrides saved)
//   print_config  — { landscape, scale, paperSize } overrides
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  const authed = await requireAuth(req)
  if (!authed.ok) return res.status(authed.status).json({ error: authed.error })
  try {
    const {
      template_id,
      cusdec_id,
      manual_values,
      print_sheet,   // sheet name to print (may come from ask-at-generate modal)
      print_range: overrideRange,
      print_config: overridePrintConfig,
    } = req.body as {
      template_id: string
      cusdec_id?: string
      manual_values?: Record<string, string>
      print_sheet?: string
      print_range?: string
      print_config?: Partial<PdfExportOptions>
    }
    if (!template_id) return res.status(400).json({ error: 'template_id required' })

    const { data: template } = await supabaseAdmin
      .from('document_templates')
      .select('*')
      .eq('id', template_id)
      .maybeSingle()
    if (!template) return res.status(404).json({ error: 'Template not found' })

    const sheetUrl: string = template.sheet_url || template.drive_url || ''
    const spreadsheetId = spreadsheetIdFromUrl(sheetUrl)
    if (!spreadsheetId) return res.status(400).json({ error: 'Template has no valid Google Sheets URL' })

    // ── Fetch data ────────────────────────────────────────────────────────────
    let cusdecRow: Record<string, any> | null = null
    let cdnRows: Record<string, any>[] = []
    if (cusdec_id) {
      const { data: cusdec } = await supabaseAdmin.from('cusdec').select('*').eq('id', cusdec_id).maybeSingle()
      cusdecRow = cusdec || null
      if (cusdec) {
        const { data: cdns } = await supabaseAdmin.from('cdn').select('*').eq('code', cusdec.code).eq('cusdec_number', cusdec.number)
        cdnRows = cdns || []
      }
    }

    // ── Build cell updates from mapping ──────────────────────────────────────
    const mapping: Array<{
      key: string; source: 'cusdec' | 'cdn' | 'manual'; dbColumn?: string
      isArray: boolean; cellRef?: string; cellRange?: string; sheetName?: string
    }> = template.mapping || []

    const updates: Array<{ range: string; value: string | number | null }> = []

    // Get sheet list so we can resolve gid for the print sheet later
    const sheetsList = await getSheetsList(spreadsheetId)
    const firstSheetTitle = sheetsList[0]?.title || 'Sheet1'

    for (const field of mapping) {
      const sheetName = field.sheetName || firstSheetTitle

      if (field.source === 'cdn' && field.isArray && field.cellRange) {
        // Parse e.g. "C10:C25" → fill C10, C11, … one per CDN row
        const m = field.cellRange.replace(/\s/g, '').match(/^([A-Za-z]+)(\d+):[A-Za-z]+(\d+)$/)
        if (m) {
          const col = m[1].toUpperCase()
          const startRow = parseInt(m[2])
          const endRow = parseInt(m[3])
          const maxRows = endRow - startRow + 1
          cdnRows.slice(0, maxRows).forEach((row, i) => {
            updates.push({
              range: `${sheetName}!${col}${startRow + i}`,
              value: field.dbColumn ? (row[field.dbColumn] ?? '') : '',
            })
          })
        }
        continue
      }

      if (!field.cellRef) continue
      const cellAddress = `${sheetName}!${field.cellRef.toUpperCase()}`
      let value: string | number | null = ''
      if (field.source === 'manual') value = (manual_values || {})[field.key] ?? ''
      else if (field.source === 'cusdec') value = cusdecRow ? (cusdecRow[field.dbColumn || ''] ?? '') : ''
      else if (field.source === 'cdn') value = cdnRows[0] ? (cdnRows[0][field.dbColumn || ''] ?? '') : ''
      updates.push({ range: cellAddress, value })
    }

    // Write all values to the sheet in one batch
    if (updates.length) {
      await batchWriteValues(spreadsheetId, updates)
    }

    // ── Determine which sheet + range to export ───────────────────────────────
    const savedConfig = template.print_config || {}

    // Resolved sheet name: request overrides saved config overrides first sheet
    const resolvedSheetName: string = print_sheet || savedConfig.sheetName || firstSheetTitle
    const resolvedRange: string | null = overrideRange ?? savedConfig.range ?? null

    // Find the gid (numeric sheet id) for the resolved sheet name
    const matchedSheet = sheetsList.find(s => s.title === resolvedSheetName) || sheetsList[0]
    const sheetGid = matchedSheet?.sheetId ?? 0

    // PDF export options
    const pdfOptions: PdfExportOptions = {
      sheetGid,
      range: resolvedRange || undefined,
      landscape: overridePrintConfig?.landscape ?? savedConfig.landscape ?? true,
      paperSize: overridePrintConfig?.paperSize ?? savedConfig.paperSize ?? 'A4',
      scale: overridePrintConfig?.scale ?? savedConfig.scale ?? 4,
      topMargin: savedConfig.topMargin ?? 0.25,
      bottomMargin: savedConfig.bottomMargin ?? 0.25,
      leftMargin: savedConfig.leftMargin ?? 0.25,
      rightMargin: savedConfig.rightMargin ?? 0.25,
    }

    const pdfBuffer = await exportSheetAsPdf(spreadsheetId, pdfOptions)
    const dateStamp = new Date().toISOString().slice(0, 10)
    const fileName = `${template.name}_${resolvedSheetName}_${dateStamp}.pdf`

    return res.json({ fileName, base64: pdfBuffer.toString('base64') })
  } catch (err: any) {
    console.error('[generate-from-template] error:', err)
    res.status(500).json({ error: err.message })
  }
}
