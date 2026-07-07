import type { NextApiRequest, NextApiResponse } from 'next'
import { findExistingMatches, checkCdnCap } from '@/lib/docTables'

// Called right before a Save in Upload Docs — tells the frontend every
// existing row that looks like a duplicate of this document (by the doc
// type's natural key), and for CDN, whether adding it would exceed the
// CUSDEC's CAP. The popup uses this to show each match so it can be edited
// in place, deleted-and-replaced, or the new one added alongside them anyway.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  try {
    const { doc_type, data } = req.body
    if (!doc_type || !data) return res.status(400).json({ error: 'doc_type and data required' })

    const matches = await findExistingMatches(doc_type, data)

    let capInfo = null
    if (doc_type === 'cdn' && data.code && data.cusdec_number) {
      capInfo = await checkCdnCap(data.code, data.cusdec_number)
    }

    res.json({ matches, capInfo })
  } catch (err: any) {
    console.error('[check-document-match] error:', err)
    res.status(500).json({ error: err.message })
  }
}
