import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { downloadDriveFile } from '@/lib/driveDownload'
import { fillExcelTemplateWorkbook, type TemplateMappingEntry } from '@/lib/excelTemplateFill'
import { workbookSheetToPdf } from '@/lib/excelToPdf'
import { requireAuth } from '@/lib/serverAuth'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Fills a saved Excel template with a CUSDEC's data (single-value fields,
// pulled once) and its CDN rows (array fields, filled down the field's cell
// range in order — this is the "Complex CDN Data Handling" the spec calls
// for) plus whatever the user typed into the Manual Input fields. Returns
// either the filled .xlsx as-is, or (format:'pdf') a best-effort PDF render
// of the first sheet via excelToPdf.ts — there's no headless office renderer
// available here, so multi-sheet templates only render their first sheet to
// PDF (the .xlsx download still has everything); pick format:'xlsx' for the
// full, exact workbook.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  const authed = await requireAuth(req)
  if (!authed.ok) return res.status(authed.status).json({ error: authed.error })
  try {
    const { template_id, cusdec_id, manual_values, format } = req.body as {
      template_id: string; cusdec_id?: string; manual_values?: Record<string, string>; format?: 'xlsx' | 'pdf'
    }
    if (!template_id) return res.status(400).json({ error: 'template_id required' })

    const { data: template } = await supabaseAdmin.from('document_templates').select('*').eq('id', template_id).maybeSingle()
    if (!template) return res.status(404).json({ error: 'Template not found' })
    const mapping: TemplateMappingEntry[] = template.mapping || []

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

    const templateBuffer = await downloadDriveFile(template.drive_url)
    const workbook = await fillExcelTemplateWorkbook(templateBuffer, mapping, cusdecRow, cdnRows, manual_values || {})
    const dateStamp = new Date().toISOString().slice(0, 10)

    if (format === 'pdf') {
      let pdfSheet = workbook.worksheets[0]
      let pdfRange: string | null = template.print_range || null
      if (pdfRange && pdfRange.includes('!')) {
        const [sheetName, rangeOnly] = pdfRange.split('!', 2)
        const found = workbook.getWorksheet(sheetName)
        if (found) pdfSheet = found
        pdfRange = rangeOnly || null
      }
      const pdfBuffer = workbookSheetToPdf(pdfSheet, template.name, pdfRange)
      return res.json({ fileName: `${template.name}_${dateStamp}.pdf`, base64: pdfBuffer.toString('base64') })
    }

    const out = await workbook.xlsx.writeBuffer()
    res.json({ fileName: `${template.name}_${dateStamp}.xlsx`, base64: Buffer.from(out).toString('base64') })
  } catch (err: any) {
    console.error('[generate-from-template] error:', err)
    res.status(500).json({ error: err.message })
  }
}
