import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { PDFDocument } from 'pdf-lib'
import { requireAuth } from '@/lib/serverAuth'
import { generateDocumentPdf } from '@/lib/docGenerate'
import { downloadDriveFile } from '@/lib/driveDownload'

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

// "Generate Pro" — the real Party's Copy is the original CUSDEC document
// followed by the filled-in template page(s), as one PDF: CUSDEC pages
// first, generated template pages after.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  const authed = await requireAuth(req)
  if (!authed.ok) return res.status(authed.status).json({ error: authed.error })

  try {
    const { document_type, cusdec_id, fill_sheet_gid, print_sheet_gid } = req.body as {
      document_type?: string; cusdec_id?: string; fill_sheet_gid?: string; print_sheet_gid?: string
    }
    if (!document_type || !cusdec_id) return res.status(400).json({ error: 'document_type and cusdec_id required' })

    const { data: cusdec } = await sb.from('cusdec').select('number, pdf_url').eq('id', cusdec_id).maybeSingle()
    if (!cusdec) return res.status(404).json({ error: 'CUSDEC not found' })
    if (!cusdec.pdf_url) return res.status(400).json({ error: 'No CUSDEC PDF on file for this record — upload one on Upload Docs first' })

    const [cusdecBytes, tplResult] = await Promise.all([
      downloadDriveFile(cusdec.pdf_url),
      generateDocumentPdf({ document_type, cusdec_id, fill_sheet_gid, print_sheet_gid }),
    ])

    const merged = await PDFDocument.create()
    const cusdecPdf = await PDFDocument.load(cusdecBytes)
    const cusdecPages = await merged.copyPages(cusdecPdf, cusdecPdf.getPageIndices())
    cusdecPages.forEach(p => merged.addPage(p))

    const tplPdf = await PDFDocument.load(Buffer.from(tplResult.base64, 'base64'))
    const tplPages = await merged.copyPages(tplPdf, tplPdf.getPageIndices())
    tplPages.forEach(p => merged.addPage(p))

    const out = await merged.save()
    const digits = (cusdec.number || '').replace(/\D/g, '') || cusdec.number
    res.json({ fileName: `P${digits}.pdf`, base64: Buffer.from(out).toString('base64') })
  } catch (e: any) {
    if (e.code === 'SHEET_SELECTION_REQUIRED') {
      return res.status(409).json({ error: e.message, needsSheetSelection: true, sheets: e.sheets || [] })
    }
    console.error('[generate-parties-copy-pro]', e)
    res.status(500).json({ error: e.message })
  }
}
