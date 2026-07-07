import type { NextApiRequest, NextApiResponse } from 'next'
import { findExistingMatch, checkCdnCap } from '@/lib/docTables'

// Called right before a Save in Upload Docs — tells the frontend whether this
// document looks like a duplicate of something already saved (by the doc
// type's natural key), and for CDN, whether adding it would exceed the
// CUSDEC's CAP. The popup uses this to ask "delete existing & save this" vs
// "add as new row" before anything actually gets written.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  try {
    const { doc_type, data } = req.body
    if (!doc_type || !data) return res.status(400).json({ error: 'doc_type and data required' })

    const match = await findExistingMatch(doc_type, data)

    let capInfo = null
    if (doc_type === 'cdn' && data.code && data.cusdec_number) {
      capInfo = await checkCdnCap(data.code, data.cusdec_number)
    }

    res.json({ match, capInfo })
  } catch (err: any) {
    console.error('[check-document-match] error:', err)
    res.status(500).json({ error: err.message })
  }
}
