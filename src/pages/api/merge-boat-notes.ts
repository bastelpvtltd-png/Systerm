import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { PDFDocument } from 'pdf-lib'
import { downloadDriveFile } from '@/lib/driveDownload'
import { requireAuth } from '@/lib/serverAuth'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Done Boat Note's bulk "Merge" action — pulls each selected archive row's
// saved PDF straight from Drive (same OAuth path templates/boat-note use
// elsewhere) and concatenates their pages into one PDF. The merged file is
// only ever returned to the caller as base64, never written back to
// Supabase/Drive — the spec is explicit that merged output is temporary, to
// avoid storage bloat from re-saving what's already saved individually.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  const authed = await requireAuth(req)
  if (!authed.ok) return res.status(authed.status).json({ error: authed.error })
  try {
    const { ids } = req.body as { ids?: string[] }
    if (!Array.isArray(ids) || ids.length < 2) return res.status(400).json({ error: 'Select at least 2 Boat Notes to merge' })

    const { data: rows, error } = await supabaseAdmin.from('generated_boat_notes').select('*').in('id', ids)
    if (error) throw error
    if (!rows?.length) return res.status(404).json({ error: 'No matching Boat Notes found' })

    const merged = await PDFDocument.create()
    for (const row of rows) {
      if (!row.drive_url) continue
      try {
        const bytes = await downloadDriveFile(row.drive_url)
        const src = await PDFDocument.load(bytes)
        const pages = await merged.copyPages(src, src.getPageIndices())
        pages.forEach(p => merged.addPage(p))
      } catch (e: any) {
        console.error(`[merge-boat-notes] skipping ${row.file_name}:`, e.message)
      }
    }
    if (merged.getPageCount() === 0) return res.status(400).json({ error: 'None of the selected Boat Notes could be read from Drive' })

    const out = await merged.save()
    res.json({ base64: Buffer.from(out).toString('base64'), fileName: `MERGED_BOAT_NOTES_${new Date().toISOString().slice(0, 10)}.pdf` })
  } catch (err: any) {
    console.error('[merge-boat-notes] error:', err)
    res.status(500).json({ error: err.message })
  }
}
