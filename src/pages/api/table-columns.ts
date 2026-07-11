import type { NextApiRequest, NextApiResponse } from 'next'
import { getTableColumns } from '@/lib/docTables'
import { requireAuth } from '@/lib/serverAuth'

// getTableColumns() (docTables.ts) already talks to the Supabase Management
// API with a service token the browser can't hold — this just exposes it
// read-only, so the Templates page can populate a real "pick a column"
// dropdown (including columns added dynamically via ensureColumns) instead
// of a free-text field name the user has to type exactly right.
const ALLOWED_TABLES = ['cusdec', 'cdn', 'barcode', 'boat_notes']

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end()
  const authed = await requireAuth(req)
  if (!authed.ok) return res.status(authed.status).json({ error: authed.error })
  try {
    const table = String(req.query.table || '')
    if (!ALLOWED_TABLES.includes(table)) return res.status(400).json({ error: 'Unknown or disallowed table' })
    const columns = await getTableColumns(table)
    res.json({ columns })
  } catch (err: any) {
    console.error('[table-columns] error:', err)
    res.status(500).json({ error: err.message })
  }
}
