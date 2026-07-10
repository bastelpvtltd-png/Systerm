import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { downloadDriveFile } from '@/lib/driveDownload'
import { fillExcelTemplate, type TemplateMappingEntry } from '@/lib/excelTemplateFill'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Fills a saved Excel template with a CUSDEC's data (single-value fields,
// pulled once) and its CDN rows (array fields, filled down the field's cell
// range in order — this is the "Complex CDN Data Handling" the spec calls
// for) plus whatever the user typed into the Manual Input fields. Returns
// the filled workbook as base64 — same original .xlsx format, not a PDF
// conversion (which would need a headless office renderer this app doesn't
// have), matching the spec's "or the uploaded template's own format" option.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  try {
    const { template_id, cusdec_id, manual_values } = req.body as {
      template_id: string; cusdec_id?: string; manual_values?: Record<string, string>
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
    const filled = await fillExcelTemplate(templateBuffer, mapping, cusdecRow, cdnRows, manual_values || {})

    res.json({ fileName: `${template.name}_${new Date().toISOString().slice(0, 10)}.xlsx`, base64: filled.toString('base64') })
  } catch (err: any) {
    console.error('[generate-from-template] error:', err)
    res.status(500).json({ error: err.message })
  }
}
