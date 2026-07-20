import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { findExistingMatches, checkCdnCap } from '@/lib/docTables'
import { requireAuth } from '@/lib/serverAuth'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Called right before a Save in Upload Docs — tells the frontend every
// existing row that looks like a duplicate of this document (by the doc
// type's natural key), and for CDN, whether adding it would exceed the
// CUSDEC's CAP. The popup uses this to show each match so it can be edited
// in place, deleted-and-replaced, or the new one added alongside them anyway.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  const authed = await requireAuth(req)
  if (!authed.ok) return res.status(authed.status).json({ error: authed.error })
  try {
    const { doc_type, data } = req.body
    if (!doc_type || !data) return res.status(400).json({ error: 'doc_type and data required' })

    const matches = await findExistingMatches(doc_type, data)

    let capInfo = null
    let cusdecMissing = false
    let cdnMissing = false

    if (doc_type === 'cdn' && data.cusdec_number) {
      // Block CDN save if no parent CUSDEC exists for this cusdec_number
      const { data: cusdecRows } = await supabaseAdmin
        .from('cusdec').select('id').eq('number', data.cusdec_number).limit(1)
      if (!cusdecRows?.length) {
        cusdecMissing = true
      } else if (data.code) {
        capInfo = await checkCdnCap(data.code, data.cusdec_number)
      }
    }

    if (doc_type === 'barcode' && data.container_no) {
      // Block barcode save if no CDN exists for this container_no
      const { data: cdnRows } = await supabaseAdmin
        .from('cdn').select('id').eq('container_no', data.container_no).limit(1)
      if (!cdnRows?.length) cdnMissing = true
    }

    res.json({ matches, capInfo, cusdecMissing, cdnMissing })
  } catch (err: any) {
    console.error('[check-document-match] error:', err)
    res.status(500).json({ error: err.message })
  }
}
