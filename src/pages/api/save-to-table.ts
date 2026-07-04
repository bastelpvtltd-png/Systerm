import type { NextApiRequest, NextApiResponse } from 'next'
import { insertExtractedData, DOC_TYPE_TABLE } from '@/lib/docTables'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  try {
    const { doc_type, data, drive_url } = req.body
    if (!doc_type || !data) return res.status(400).json({ error: 'doc_type and data required' })
    if (!DOC_TYPE_TABLE[doc_type]) return res.json({ skipped: true }) // no structured table for this doc type

    await insertExtractedData(doc_type, data, drive_url || '')
    res.json({ ok: true })
  } catch (err: any) {
    console.error('[save-to-table] error:', err)
    res.status(500).json({ error: err.message })
  }
}
