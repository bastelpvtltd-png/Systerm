import type { NextApiRequest, NextApiResponse } from 'next'
import { insertExtractedData, matchAndMergeShipment, DOC_TYPE_TABLE } from '@/lib/docTables'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  try {
    const { doc_type, data, drive_url, mode, replace_id, uploaded_by } = req.body
    if (!doc_type || !data) return res.status(400).json({ error: 'doc_type and data required' })
    if (!DOC_TYPE_TABLE[doc_type]) return res.json({ skipped: true }) // no structured table for this doc type

    const result = await insertExtractedData(doc_type, data, drive_url || '', {
      mode: mode === 'replace' ? 'replace' : 'insert',
      replaceId: replace_id || undefined,
      uploadedBy: uploaded_by || undefined,
    })
    if (!result.ok) {
      return res.status(409).json({ error: 'CDN cap exceeded', reason: result.reason, capInfo: result.capInfo })
    }

    // Cusdec auto-match: fold in any pending Shipment entry with the same
    // Invoice Number (see matchAndMergeShipment for the priority rule), or
    // generate this CUSDEC its own reference if nothing matched.
    let shipmentMatch: { matched: boolean; shipmentId?: string } | undefined
    if (doc_type === 'cusdec' && result.row) {
      shipmentMatch = await matchAndMergeShipment(result.row)
    }

    res.json({ ok: true, shipmentMatch, cusdecId: doc_type === 'cusdec' ? result.row?.id : undefined })
  } catch (err: any) {
    console.error('[save-to-table] error:', err)
    res.status(500).json({ error: err.message })
  }
}
