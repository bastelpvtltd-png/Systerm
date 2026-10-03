import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { requireWorker } from '@/lib/workerAuth'
import { uploadBufferToDrive } from '@/pages/api/upload-to-drive'
import { insertExtractedData } from '@/lib/docTables'
import { notifyToActivityLog } from '@/lib/automationNotify'
import { findExistingDocumentUpload } from '@/lib/notifyHistory'
import { deleteDriveFileByUrl } from '@/lib/driveFolders'

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
// Drive upload + barcode extraction (OCR) + DB writes in one request: allow up to 60 s.
export const config = { api: { bodyParser: { sizeLimit: '10mb' } }, maxDuration: 60 }

// Called by the worker once the SLPA slip is saved and printed. Handles the PDF exactly as if
// it had been uploaded on Upload Docs as a "barcode" with Save + Notify + Reason "Container Moved":
//   1. PDF -> Drive ("Barcode" folder)
//   2. barcode-type extraction (the same /api/extract-pdf the Upload Docs page uses, incl. saved
//      PDF templates) -> row in the `barcode` table
//   3. generic uploaded_documents log row
//   4. Activity Log entry (document_uploads + dashboard_notifications), reason "Container Moved",
//      uploaded by "Automation (Barcode Enter)"
//   5. job -> done
// If extraction or the table save fails, the Drive file is deleted again and the job is
// failed (step "finalize"), so nothing half-saved is left behind.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  const auth = requireWorker(req)
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error })
  try {
    const { jobId, pdfBase64, fileName } = req.body as { jobId?: string; pdfBase64?: string; fileName?: string }
    if (!jobId || !pdfBase64) return res.status(400).json({ error: 'jobId and pdfBase64 required' })

    const { data: job } = await sb.from('automation_jobs').select('*').eq('id', jobId).maybeSingle()
    if (!job || job.kind !== 'barcode_enter') return res.status(404).json({ error: 'Barcode job not found' })
    if (job.status === 'done') return res.json({ ok: true, alreadyDone: true })
    if (job.status !== 'running') return res.status(409).json({ error: `Job is ${job.status}, not running` })

    const { data: cdn } = await sb.from('cdn').select('*').eq('id', job.cdn_id).maybeSingle()
    if (!cdn?.container_no) throw new Error('CDN row or its container number is missing')
    const container = String(cdn.container_no).replace(/\s+/g, '').toUpperCase()

    const { data: existing } = await sb.from('barcode').select('id').eq('container_no', container).limit(1)
    if (existing?.length) throw new Error(`A barcode row for ${container} already exists — not creating a second one`)

    const safeName = (fileName || `${container}.pdf`).replace(/[\\/:*?"<>|]/g, '_')
    const name = /\.pdf$/i.test(safeName) ? safeName : `${safeName}.pdf`
    const { driveLink } = await uploadBufferToDrive(pdfBase64, name, 'application/pdf', 'barcode')

    let tableData: Record<string, string> = {}
    try {
      const host = String(req.headers.host || '')
      const proto = String(req.headers['x-forwarded-proto'] || (/^(localhost|127\.0\.0\.1)/.test(host) ? 'http' : 'https')).split(',')[0]
      const origin = `${proto}://${host}`   // call ourselves on the same host (works on localhost and on Vercel)
      const er = await fetch(`${origin}/api/extract-pdf`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.WORKER_SECRET}` },
        body: JSON.stringify({ base64: pdfBase64, docType: 'barcode' }),
      })
      const ej: any = await er.json().catch(() => ({}))
      if (!er.ok) throw new Error(`Barcode extraction failed: ${ej.error || er.status}`)
      tableData = Object.fromEntries((ej.fields || []).map((f: any) => [f.key, f.value]))

      // The slip must be for THIS container — never save a barcode against the wrong CDN.
      const extracted = String(tableData.container_no || '').replace(/\s+/g, '').toUpperCase()
      if (extracted && extracted !== container) throw new Error(`The printed slip is for ${extracted}, not ${container}`)
      tableData.container_no = container

      const saved = await insertExtractedData('barcode', tableData, driveLink, { uploadedBy: 'Automation (Barcode Enter)' })
      if (!saved.ok) throw new Error('Barcode table save was refused')
    } catch (e) {
      await deleteDriveFileByUrl(driveLink)   // don't leave an orphaned PDF in Drive
      throw e
    }

    const nowIso = new Date().toISOString()
    try {
      await sb.from('uploaded_documents').insert({
        doc_type: 'barcode', file_name: name, file_url: '', drive_url: driveLink, uploaded_by: null, updated_at: nowIso,
        extracted_data: Object.fromEntries(Object.entries(tableData).map(([k, v]) => [`grid_${k}`, v])),
      })
    } catch { /* supplemental log — non-fatal */ }

    // Notify with reason "Container Moved" (once per file — never twice).
    let notifyError: string | null = null
    const already = await findExistingDocumentUpload(sb, { file_name: name, doc_type: 'barcode' })
    if (!already) {
      const n = await notifyToActivityLog({
        fileName: name, driveLink, docType: 'barcode', reason: 'Container Moved',
        extractedData: tableData, byName: 'Automation (Barcode Enter)',
      })
      notifyError = n.error
    }

    await sb.from('automation_jobs').update({
      status: 'done', step: 'finalize', finished_at: new Date().toISOString(),
      error: notifyError, result: { ...(job.result || {}), driveLink },
    }).eq('id', jobId)
    res.json({ ok: true, driveLink, notifyError })
  } catch (err: any) {
    console.error('[worker/finalize-barcode] error:', err)
    res.status(500).json({ error: err.message })
  }
}
