import type { NextApiRequest, NextApiResponse } from 'next'
import { PDFDocument } from 'pdf-lib'
import { downloadDriveFile } from '@/lib/driveDownload'
import { requireAuth } from '@/lib/serverAuth'

export const config = { api: { bodyParser: { sizeLimit: '20mb' } } }

// General-purpose merge for the Automation > Merge PDF tab — each source is
// either a Drive link (pulled live, same OAuth path as everywhere else) or
// a base64 file the caller already has in hand (a local upload). Output is
// only ever returned as base64, never written to Drive itself — the caller
// decides whether to save/download/mail it, same as merge-boat-notes.ts.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  const authed = await requireAuth(req)
  if (!authed.ok) return res.status(authed.status).json({ error: authed.error })
  try {
    const { sources, outputName } = req.body as {
      sources?: ({ driveUrl: string } | { base64: string; fileName: string })[]
      outputName?: string
    }
    if (!Array.isArray(sources) || sources.length < 2) return res.status(400).json({ error: 'At least 2 sources required' })

    const merged = await PDFDocument.create()
    for (const src of sources) {
      try {
        const bytes = 'driveUrl' in src && src.driveUrl
          ? await downloadDriveFile(src.driveUrl)
          : 'base64' in src && src.base64
            ? Buffer.from(src.base64, 'base64')
            : null
        if (!bytes) continue
        const doc = await PDFDocument.load(bytes)
        const pages = await merged.copyPages(doc, doc.getPageIndices())
        pages.forEach(p => merged.addPage(p))
      } catch (e: any) {
        console.error('[merge-pdfs] skipping a source:', e.message)
      }
    }
    if (merged.getPageCount() === 0) return res.status(400).json({ error: 'None of the sources could be read as a PDF' })

    const out = await merged.save()
    const fileName = `${(outputName || 'Merged').replace(/[\\/:*?"<>|]/g, '_')}.pdf`
    res.json({ base64: Buffer.from(out).toString('base64'), fileName })
  } catch (err: any) {
    console.error('[merge-pdfs] error:', err)
    res.status(500).json({ error: err.message })
  }
}
