import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import PizZip from 'pizzip'
import Docxtemplater from 'docxtemplater'
import { requireAuth } from '@/lib/serverAuth'
import { downloadDriveFile } from '@/lib/driveDownload'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Word templates were previously only ever re-typeset into a plain-text PDF
// (jsPDF), losing the original .docx's fonts/layout/tables entirely. This
// fills the ORIGINAL uploaded .docx's {{tag}} placeholders in place (via
// docxtemplater, which edits the docx XML directly — no headless Office
// needed) and returns a real .docx, so Word templates can now actually be
// generated "as Word" and not just as a reflowed PDF.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  const authed = await requireAuth(req)
  if (!authed.ok) return res.status(authed.status).json({ error: authed.error })
  try {
    const { template_id, values } = req.body as { template_id: string; values?: Record<string, string> }
    if (!template_id) return res.status(400).json({ error: 'template_id required' })

    const { data: template } = await supabaseAdmin.from('doc_templates').select('*').eq('id', template_id).maybeSingle()
    if (!template) return res.status(404).json({ error: 'Template not found' })
    if (!template.drive_url) return res.status(400).json({ error: 'This template has no original .docx file on file (uploaded before Drive storage was wired up) — re-upload it to enable Word/PDF generation.' })

    const buffer = await downloadDriveFile(template.drive_url)
    const zip = new PizZip(buffer)
    const doc = new Docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks: true,
      delimiters: { start: '{{', end: '}}' },
    })
    doc.render(values || {})

    const out = doc.getZip().generate({ type: 'nodebuffer' })
    res.json({ fileName: `${(template.name || 'document').replace(/[^\w.-]+/g, '_')}.docx`, base64: out.toString('base64') })
  } catch (err: any) {
    console.error('[generate-template-docx] error:', err)
    res.status(500).json({ error: err.message })
  }
}
