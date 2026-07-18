import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { PDFDocument } from 'pdf-lib'
import { downloadDriveFile } from '@/lib/driveDownload'
import { requireAuth } from '@/lib/serverAuth'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Dashboard "Boat Note Pending" > Pick — merges the selected CUSDECs' Boat
// Notes into one PDF, their Party's Copies into another, and their CDNs'
// own uploaded PDFs into a third, one merged file per ticked category.
// Output is base64 only (never written to Drive here) — the caller uploads
// it, then sends it through the normal notify/pick flow itself.
async function mergeUrls(urls: string[]): Promise<Buffer | null> {
  const merged = await PDFDocument.create()
  for (const url of urls) {
    if (!url) continue
    try {
      const bytes = await downloadDriveFile(url)
      const doc = await PDFDocument.load(bytes)
      const pages = await merged.copyPages(doc, doc.getPageIndices())
      pages.forEach(p => merged.addPage(p))
    } catch (e: any) {
      console.error('[merge-pending-docs] skipping a source:', e.message)
    }
  }
  if (merged.getPageCount() === 0) return null
  return Buffer.from(await merged.save())
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  const authed = await requireAuth(req)
  if (!authed.ok) return res.status(authed.status).json({ error: authed.error })
  try {
    const { cusdec_ids, includeBoat, includeParty, includeCdn } = req.body as {
      cusdec_ids?: string[]; includeBoat?: boolean; includeParty?: boolean; includeCdn?: boolean
    }
    if (!Array.isArray(cusdec_ids) || !cusdec_ids.length) return res.status(400).json({ error: 'cusdec_ids required' })
    if (!includeBoat && !includeParty && !includeCdn) return res.status(400).json({ error: 'Pick at least one of Boat Note / Party\'s Copy / CDN' })

    const { data: cusdecs } = await supabaseAdmin.from('cusdec')
      .select('id, code, number, boat_note_url, party_copy_url').in('id', cusdec_ids)
    if (!cusdecs?.length) return res.status(404).json({ error: 'No matching CUSDECs found' })

    const dateStr = new Date().toISOString().slice(0, 10)
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const files: { fileName: string; base64: string; docType: string }[] = []

    if (includeBoat) {
      const bytes = await mergeUrls(cusdecs.map(c => c.boat_note_url).filter(Boolean) as string[])
      if (bytes) files.push({ fileName: `Boat Note ${dateStr} ${stamp}.pdf`, base64: bytes.toString('base64'), docType: 'boat_note' })
    }
    if (includeParty) {
      const bytes = await mergeUrls(cusdecs.map(c => c.party_copy_url).filter(Boolean) as string[])
      if (bytes) files.push({ fileName: `Parties Copy ${dateStr} ${stamp}.pdf`, base64: bytes.toString('base64'), docType: 'party_copy' })
    }
    if (includeCdn) {
      const { data: cdns } = await supabaseAdmin.from('cdn').select('code, cusdec_number, pdf_url')
      const keys = new Set(cusdecs.map(c => `${c.code}|||${c.number}`))
      const urls = (cdns || []).filter(d => keys.has(`${d.code}|||${d.cusdec_number}`)).map(d => d.pdf_url).filter(Boolean) as string[]
      const bytes = await mergeUrls(urls)
      if (bytes) files.push({ fileName: `CDN ${dateStr} ${stamp}.pdf`, base64: bytes.toString('base64'), docType: 'cdn' })
    }

    if (!files.length) return res.status(400).json({ error: 'None of the selected CUSDECs have a saved PDF for the ticked categories' })
    res.json({ ok: true, files })
  } catch (err: any) {
    console.error('[merge-pending-docs] error:', err)
    res.status(500).json({ error: err.message })
  }
}
