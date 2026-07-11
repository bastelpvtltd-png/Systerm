import type { NextApiRequest, NextApiResponse } from 'next'
import { DOC_TYPE_TABLE, ensureColumns } from '@/lib/docTables'
import { requireSection } from '@/lib/serverAuth'

// Creates the column for a newly added field immediately (not lazily at save
// time) — the field list is schema-driven, so the column must exist right
// away for the field to keep showing up on the next PDF of the same type.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  const authed = await requireSection(req, 'section:documents-upload.admin-edit')
  if (!authed.ok) return res.status(authed.status).json({ error: authed.error })
  try {
    const { doc_type, key } = req.body
    if (!doc_type || !key) return res.status(400).json({ error: 'doc_type and key required' })

    const table = DOC_TYPE_TABLE[doc_type]
    if (!table || table === 'boat_notes') return res.json({ skipped: true })

    await ensureColumns(table, [key])
    res.json({ ok: true })
  } catch (err: any) {
    console.error('[ensure-column] error:', err)
    res.status(500).json({ error: err.message })
  }
}
