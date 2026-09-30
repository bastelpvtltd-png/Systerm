import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { PDFDocument } from 'pdf-lib'
import { downloadDriveFile } from '@/lib/driveDownload'
import { requireAuth } from '@/lib/serverAuth'

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// ── සිංහලෙන් ──────────────────────────────────────────────────────────────
// My Picked Tasks > Print: Drive එකේ "view" page එකට යනවා වෙනුවට, PDF එක
// (හෝ එකකට වඩා තියෙනවා නම් ඒවා එකට merge කරලා) browser එකේම PDF viewer
// එකේ කෙළින්ම open වෙන link එකක් හදලා දෙනවා — Print button එක ඒකේම තියෙනවා.
// ──────────────────────────────────────────────────────────────────────────
// Print needs the PDF itself to open straight in the browser's own PDF
// viewer (its toolbar has Print) rather than Drive's preview page. Drive
// links can't do that, so the server pulls the file(s) from Drive, merges
// them when there is more than one (one tab, one print job, in the order
// given), parks the result in the same temp-pdfs bucket the other PDF tools
// already use, and returns a short-lived signed URL. The signed URL is served
// by Supabase Storage directly (inline PDF), so there is no response-size
// limit on this function. Old temp files are swept on each call.
const BUCKET = 'temp-pdfs'
const TTL_SECONDS = 60 * 60
const STALE_MS = 24 * 60 * 60 * 1000

async function sweepOld() {
  try {
    const { data } = await sb.storage.from(BUCKET).list('', { limit: 200 })
    const stale = (data || []).filter(f => /^print-/.test(f.name) && f.created_at && Date.now() - new Date(f.created_at).getTime() > STALE_MS).map(f => f.name)
    if (stale.length) await sb.storage.from(BUCKET).remove(stale)
  } catch { /* housekeeping only */ }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  const authed = await requireAuth(req)
  if (!authed.ok) return res.status(authed.status).json({ error: authed.error })
  try {
    const { drive_urls } = req.body as { drive_urls?: string[] }
    const urls = (drive_urls || []).filter(u => typeof u === 'string' && u)
    if (!urls.length) return res.status(400).json({ error: 'drive_urls required' })

    let bytes: Buffer
    if (urls.length === 1) {
      bytes = await downloadDriveFile(urls[0])
    } else {
      const merged = await PDFDocument.create()
      for (const url of urls) {
        const src = await PDFDocument.load(await downloadDriveFile(url))
        const pages = await merged.copyPages(src, src.getPageIndices())
        pages.forEach(p => merged.addPage(p))
      }
      bytes = Buffer.from(await merged.save())
    }

    const name = `print-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.pdf`
    const { error: upErr } = await sb.storage.from(BUCKET).upload(name, bytes, { contentType: 'application/pdf', upsert: false })
    if (upErr) throw upErr
    const { data: signed, error: signErr } = await sb.storage.from(BUCKET).createSignedUrl(name, TTL_SECONDS)
    if (signErr || !signed?.signedUrl) throw signErr || new Error('Could not create a link for the PDF')

    void sweepOld()
    res.json({ ok: true, url: signed.signedUrl })
  } catch (err: any) {
    console.error('[print-pdf-link] error:', err)
    res.status(500).json({ error: err.message || 'Could not prepare the PDF for printing' })
  }
}
