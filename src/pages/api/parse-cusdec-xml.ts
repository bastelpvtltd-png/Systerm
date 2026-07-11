import type { NextApiRequest, NextApiResponse } from 'next'
import { requireAdmin } from '@/lib/serverAuth'
import { parseCusdecXml } from '@/lib/parseCusdecXml'

export const config = { api: { bodyParser: { sizeLimit: '10mb' } } }

// Boat Note Processing (Temporary Module) — the spec calls for this to be
// admin-only and fully ephemeral: nothing here ever touches Supabase or
// Drive, so there's no temp row/file to purge afterward — not persisting in
// the first place is the safest way to satisfy "ephemeral." This route only
// parses the uploaded CUSDEC XML into fields; the client merges those with
// whatever container-level details it's given and builds the boat note PDF
// itself (same drawing code the existing CUSDEC-record boat note flow
// already uses) — nothing is stored, and the response holds only the
// parsed field values, never the raw file.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  const authed = await requireAdmin(req)
  if (!authed.ok) return res.status(authed.status).json({ error: authed.error })
  try {
    const { xmlBase64 } = req.body as { xmlBase64?: string }
    if (!xmlBase64) return res.status(400).json({ error: 'xmlBase64 required' })
    const xml = Buffer.from(xmlBase64, 'base64').toString('utf-8')
    const parsed = parseCusdecXml(xml)
    res.json({ parsed })
  } catch (err: any) {
    console.error('[parse-cusdec-xml] error:', err)
    res.status(400).json({ error: err.message || 'Could not parse this XML' })
  }
}
