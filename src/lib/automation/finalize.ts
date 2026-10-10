import { createClient } from '@supabase/supabase-js'
import { uploadBufferToDrive } from '@/pages/api/upload-to-drive'
import { insertExtractedData } from '@/lib/docTables'
import { notifyToActivityLog } from '@/lib/automationNotify'
import { findExistingDocumentUpload } from '@/lib/notifyHistory'
import { deleteDriveFileByUrl } from '@/lib/driveFolders'
import { FieldError } from './errors'

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

// Saves the printed SLPA barcode slip exactly as if it had been uploaded on Upload Docs as a
// "barcode" with Save + Notify + Reason "Container Moved":
//   1. PDF -> Drive ("Barcode" folder)
//   2. barcode-type extraction (the same /api/extract-pdf the Upload Docs page uses, incl. saved
//      PDF templates) -> row in the `barcode` table
//   3. generic uploaded_documents log row
//   4. Activity Log entry (document_uploads + dashboard_notifications), reason "Container Moved",
//      uploaded by "Automation (Barcode Enter)"
// If extraction or the table save fails the Drive file is deleted again and a FieldError
// (step "finalize") is thrown, so nothing half-saved is left behind.
export async function finalizeBarcode(p: { cdn: Record<string, any>; pdf: Buffer; fileName: string; origin: string }): Promise<{ driveLink: string; notifyError: string | null }> {
  const container = String(p.cdn.container_no || '').replace(/\s+/g, '').toUpperCase()
  if (!container) throw new FieldError('finalize', 'Container No', 'CDN has no container number')

  const { data: existing } = await sb.from('barcode').select('id').eq('container_no', container).limit(1)
  if (existing?.length) throw new FieldError('finalize', 'Barcode row', `A barcode row for ${container} already exists — not creating a second one`)

  const safe = (p.fileName || `${container}.pdf`).replace(/[\\/:*?"<>|]/g, '_')
  const name = /\.pdf$/i.test(safe) ? safe : `${safe}.pdf`
  const pdfBase64 = p.pdf.toString('base64')
  const { driveLink } = await uploadBufferToDrive(pdfBase64, name, 'application/pdf', 'barcode')

  let tableData: Record<string, string> = {}
  try {
    const er = await fetch(`${p.origin}/api/extract-pdf`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.WORKER_SECRET}` },
      body: JSON.stringify({ base64: pdfBase64, docType: 'barcode' }),
    })
    const ej: any = await er.json().catch(() => ({}))
    if (!er.ok) throw new FieldError('finalize', 'Barcode extraction', `Barcode extraction failed: ${ej.error || er.status}${er.status === 401 ? ' (is WORKER_SECRET set on Vercel?)' : ''}`)
    tableData = Object.fromEntries((ej.fields || []).map((f: any) => [f.key, f.value]))

    // The slip must be for THIS container — never save a barcode against the wrong CDN. On a
    // mismatch the Drive file below gets deleted, so without this the actual extracted
    // fields/text are lost and a wrong read can only ever be guessed at, not diagnosed.
    const extracted = String(tableData.container_no || '').replace(/\s+/g, '').toUpperCase()
    if (extracted && extracted !== container) {
      const err = new FieldError('finalize', 'Container No', `The printed slip is for ${extracted}, not ${container}`)
      err.debug = `extracted fields: ${JSON.stringify(tableData).slice(0, 3000)}`
      throw err
    }
    tableData.container_no = container

    const saved = await insertExtractedData('barcode', tableData, driveLink, { uploadedBy: 'Automation (Barcode Enter)' })
    if (!saved.ok) throw new FieldError('finalize', 'Barcode table', 'Barcode table save was refused')
  } catch (e) {
    await deleteDriveFileByUrl(driveLink)   // don't leave an orphaned PDF in Drive
    throw e
  }

  try {
    await sb.from('uploaded_documents').insert({
      doc_type: 'barcode', file_name: name, file_url: '', drive_url: driveLink, uploaded_by: null, updated_at: new Date().toISOString(),
      extracted_data: Object.fromEntries(Object.entries(tableData).map(([k, v]) => [`grid_${k}`, v])),
    })
  } catch { /* supplemental log — non-fatal */ }

  let notifyError: string | null = null
  const already = await findExistingDocumentUpload(sb, { file_name: name, doc_type: 'barcode' })
  if (!already) {
    const n = await notifyToActivityLog({
      fileName: name, driveLink, docType: 'barcode', reason: 'Container Moved',
      extractedData: tableData, byName: 'Automation (Barcode Enter)',
    })
    notifyError = n.error
  }
  return { driveLink, notifyError }
}
