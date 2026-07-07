import type { NextApiRequest, NextApiResponse } from 'next'
import { deleteRowAndDriveFile } from '@/lib/docTables'

// Deletes a single row from a doc-type table (or uploaded_documents) and,
// if it has a stored Drive link, deletes that Drive file too. Used by the
// Upload Docs duplicate/CAP-conflict modals to free up a slot or replace an
// existing row without leaving an orphaned PDF in Drive.
const ALLOWED_TABLES: Record<string, string> = {
  cusdec: 'pdf_url', cdn: 'pdf_url', barcode: 'pdf_url', boat_notes: 'pdf_url',
  uploaded_documents: 'drive_url',
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  try {
    const { table, id } = req.body
    if (!table || !id) return res.status(400).json({ error: 'table and id required' })
    const urlColumn = ALLOWED_TABLES[table]
    if (!urlColumn) return res.status(400).json({ error: 'Unknown or disallowed table' })

    await deleteRowAndDriveFile(table, id, urlColumn)
    res.json({ ok: true })
  } catch (err: any) {
    console.error('[delete-row] error:', err)
    res.status(500).json({ error: err.message })
  }
}
