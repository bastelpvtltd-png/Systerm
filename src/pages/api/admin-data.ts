import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Whitelisted so this endpoint can't be pointed at arbitrary/system tables.
const ALLOWED_TABLES = ['cusdec', 'cdn', 'barcode', 'boat_notes', 'uploaded_documents', 'pdf_templates']

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const table = String(req.query.table || '')
  if (!ALLOWED_TABLES.includes(table)) return res.status(400).json({ error: 'Unknown or disallowed table' })

  try {
    if (req.method === 'GET') {
      const { data, error } = await supabaseAdmin
        .from(table).select('*').order('created_at', { ascending: false }).limit(300)
      if (error) return res.status(400).json({ error: error.message })
      return res.json({ rows: data })
    }

    if (req.method === 'PATCH') {
      const { id, updates } = req.body
      if (!id || !updates) return res.status(400).json({ error: 'id and updates required' })
      const { error } = await supabaseAdmin.from(table).update(updates).eq('id', id)
      if (error) return res.status(400).json({ error: error.message })
      return res.json({ ok: true })
    }

    if (req.method === 'DELETE') {
      const { id, all } = req.query
      if (all === 'true') {
        // Supabase requires a filter on delete — this matches every row without needing a known id.
        const { error } = await supabaseAdmin.from(table).delete().gte('created_at', '1970-01-01')
        if (error) return res.status(400).json({ error: error.message })
        return res.json({ ok: true })
      }
      if (!id) return res.status(400).json({ error: 'id required' })
      const { error } = await supabaseAdmin.from(table).delete().eq('id', id)
      if (error) return res.status(400).json({ error: error.message })
      return res.json({ ok: true })
    }

    res.status(405).end()
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
}
