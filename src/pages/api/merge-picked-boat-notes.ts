import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { PDFDocument } from 'pdf-lib'
import { downloadDriveFile } from '@/lib/driveDownload'
import { deleteDriveFileByUrl } from '@/lib/driveFolders'
import { requireAuth } from '@/lib/serverAuth'
import { uploadBufferToDrive } from './upload-to-drive'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// My Picked Tasks > Mail / Download for "Boat Note Passed" B... documents.
//
// Starting only from the picked B... PDFs, this finds each one's CUSDEC in
// the database (cusdec_id when the row has it, otherwise the number in the
// file name — B55296.pdf -> the CUSDEC whose number is "E 55296"), then
// builds up to THREE merged files for the whole selection, however many B
// documents were picked:
//   • CUSDEC set    — CUSDEC 1 + its Party's Copy, CUSDEC 2 + its Party's Copy…
//   • Boat Note set — every picked B... PDF, in one file
//   • CDN set       — every CDN PDF that belongs to those CUSDECs, in one file
// The merged files are uploaded to Drive as TEMPORARY files, the same way
// Automation > Merge PDF does it (docType 'merged_pdf'), and returned as
// links. The dashboard removes them afterwards through the existing
// /api/delete-temp-merge-file endpoint. Nothing is written to any table.
//
// Strict on purpose: if a Party's Copy (or the CUSDEC PDF) is missing, the
// whole request fails with a clear message and nothing is created.

const digitsOf = (s?: string | null) => (s || '').replace(/\D/g, '')
const numberFromFileName = (name: string) => (name || '').replace(/\.pdf$/i, '').match(/\d+/)?.[0] || ''

async function mergeUrls(urls: string[], label: string, strict: boolean, warnings: string[]): Promise<Buffer | null> {
  const merged = await PDFDocument.create()
  for (const url of urls) {
    if (!url) continue
    try {
      const bytes = await downloadDriveFile(url)
      const doc = await PDFDocument.load(bytes)
      const pages = await merged.copyPages(doc, doc.getPageIndices())
      pages.forEach(p => merged.addPage(p))
    } catch (e: any) {
      if (strict) throw new Error(`Could not read a ${label} PDF from Drive: ${e.message}`)
      warnings.push(`Skipped an unreadable ${label} PDF`)
      console.error(`[merge-picked-boat-notes] skipping a ${label} source:`, e.message)
    }
  }
  if (merged.getPageCount() === 0) return null
  return Buffer.from(await merged.save())
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  const authed = await requireAuth(req)
  if (!authed.ok) return res.status(authed.status).json({ error: authed.error })

  const uploaded: string[] = []
  try {
    const { document_ids } = req.body as { document_ids?: string[] }
    if (!Array.isArray(document_ids) || !document_ids.length) return res.status(400).json({ error: 'document_ids required' })

    // Only this user's own active picks can be merged.
    const { data: tasks } = await supabaseAdmin.from('user_tasks').select('document_id')
      .eq('user_id', authed.userId).eq('status', 'active').in('document_id', document_ids)
    const owned = new Set((tasks || []).map((t: any) => t.document_id))
    if (document_ids.some(id => !owned.has(id))) return res.status(403).json({ error: 'One of these documents is not in your picked tasks' })

    const { data: docRows, error: docErr } = await supabaseAdmin.from('document_uploads')
      .select('id, file_name, drive_url, cusdec_id').in('id', document_ids)
    if (docErr) throw docErr
    const docsById = new Map((docRows || []).map((d: any) => [d.id, d]))
    const docs = document_ids.map(id => docsById.get(id)).filter(Boolean) as any[]
    if (docs.length !== document_ids.length) return res.status(404).json({ error: 'A picked document no longer exists' })
    const noFile = docs.find(d => !d.drive_url)
    if (noFile) return res.status(400).json({ error: `${noFile.file_name} has no file to merge` })

    // ── B document -> CUSDEC ────────────────────────────────────────────
    const CUSDEC_COLS = 'id, code, number, pdf_url, party_copy_url, created_at'
    const directIds = docs.map(d => d.cusdec_id).filter(Boolean) as string[]
    const byId = new Map<string, any>()
    if (directIds.length) {
      const { data } = await supabaseAdmin.from('cusdec').select(CUSDEC_COLS).in('id', directIds)
      for (const c of data || []) byId.set(c.id, c)
    }

    const warnings: string[] = []
    const cusdecs: any[] = []
    const seen = new Set<string>()
    for (const d of docs) {
      let c = d.cusdec_id ? byId.get(d.cusdec_id) : null
      if (!c) {
        const num = numberFromFileName(d.file_name)
        if (!num) return res.status(400).json({ error: `Could not find a CUSDEC number in "${d.file_name}"` })
        const { data } = await supabaseAdmin.from('cusdec').select(CUSDEC_COLS).ilike('number', `%${num}%`)
        const matches = (data || []).filter((r: any) => digitsOf(r.number) === num)
          .sort((a: any, b: any) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
        if (!matches.length) return res.status(404).json({ error: `No CUSDEC found in the database for ${d.file_name} (number ${num})` })
        if (matches.length > 1) warnings.push(`More than one CUSDEC has number ${num} — used the newest (${matches[0].code} ${matches[0].number})`)
        c = matches[0]
      }
      if (!seen.has(c.id)) { seen.add(c.id); cusdecs.push(c) }
    }

    // Required pieces — error out instead of silently mailing an incomplete set.
    const noCusdecPdf = cusdecs.find(c => !c.pdf_url)
    if (noCusdecPdf) return res.status(400).json({ error: `CUSDEC ${noCusdecPdf.number} has no saved CUSDEC PDF` })
    const noParty = cusdecs.find(c => !c.party_copy_url)
    if (noParty) return res.status(400).json({ error: `Party's Copy is not ready for CUSDEC ${noParty.number} — create/save it first` })

    // ── CDNs of those CUSDECs ──────────────────────────────────────────
    const { data: cdnRows } = await supabaseAdmin.from('cdn').select('code, cusdec_number, pdf_url')
      .in('cusdec_number', cusdecs.map(c => c.number))
    const keys = new Set(cusdecs.map(c => `${c.code}|||${c.number}`))
    const cdnUrls = (cdnRows || []).filter((r: any) => keys.has(`${r.code}|||${r.cusdec_number}`)).map((r: any) => r.pdf_url).filter(Boolean) as string[]

    // ── Merge ──────────────────────────────────────────────────────────
    const cusdecUrls: string[] = []
    for (const c of cusdecs) cusdecUrls.push(c.pdf_url, c.party_copy_url)
    const cusdecBytes = await mergeUrls(cusdecUrls, 'CUSDEC / Party\'s Copy', true, warnings)
    const boatBytes = await mergeUrls(docs.map(d => d.drive_url), 'Boat Note', true, warnings)
    const cdnBytes = cdnUrls.length ? await mergeUrls(cdnUrls, 'CDN', false, warnings) : null
    if (!cdnBytes) warnings.push('No CDN PDFs were found for these CUSDECs — CDN set skipped')

    // ── Temporary Drive upload ────────────────────────────────────────
    const dateStr = new Date().toISOString().slice(0, 10)
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const files: { fileName: string; driveLink: string; driveId: string; docType: string }[] = []
    const toUpload: { fileName: string; bytes: Buffer | null; docType: string }[] = [
      { fileName: `CUSDEC Set ${dateStr} ${stamp}.pdf`, bytes: cusdecBytes, docType: 'merged_pdf' },
      { fileName: `Boat Note Set ${dateStr} ${stamp}.pdf`, bytes: boatBytes, docType: 'merged_pdf' },
      { fileName: `CDN Set ${dateStr} ${stamp}.pdf`, bytes: cdnBytes, docType: 'merged_pdf' },
    ]
    for (const f of toUpload) {
      if (!f.bytes) continue
      const { driveId, driveLink } = await uploadBufferToDrive(f.bytes.toString('base64'), f.fileName, 'application/pdf', f.docType)
      uploaded.push(driveLink)
      files.push({ fileName: f.fileName, driveLink, driveId, docType: f.docType })
    }
    if (!files.length) return res.status(400).json({ error: 'Nothing could be merged for the selected documents' })

    res.json({ ok: true, files, cusdecs: cusdecs.map(c => c.number), warnings })
  } catch (err: any) {
    // Don't leave half-made temporary files behind.
    for (const url of uploaded) await deleteDriveFileByUrl(url).catch(() => {})
    console.error('[merge-picked-boat-notes] error:', err)
    res.status(500).json({ error: err.message })
  }
}