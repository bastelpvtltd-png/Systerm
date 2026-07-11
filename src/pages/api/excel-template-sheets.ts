import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import ExcelJS from 'exceljs'
import { requireAuth } from '@/lib/serverAuth'
import { downloadDriveFile } from '@/lib/driveDownload'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Lists a saved Excel template's worksheet names, so the Cell Mapping UI can
// offer a per-field sheet picker instead of always assuming the first sheet.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end()
  const authed = await requireAuth(req)
  if (!authed.ok) return res.status(authed.status).json({ error: authed.error })
  try {
    const templateId = String(req.query.template_id || '')
    if (!templateId) return res.status(400).json({ error: 'template_id required' })

    const { data: template } = await supabaseAdmin.from('document_templates').select('drive_url').eq('id', templateId).maybeSingle()
    if (!template?.drive_url) return res.status(404).json({ error: 'Template not found' })

    const buffer = await downloadDriveFile(template.drive_url)
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(buffer as any)
    const sheets = workbook.worksheets.map(s => s.name)

    res.json({ sheets })
  } catch (err: any) {
    console.error('[excel-template-sheets] error:', err)
    res.status(500).json({ error: err.message })
  }
}
