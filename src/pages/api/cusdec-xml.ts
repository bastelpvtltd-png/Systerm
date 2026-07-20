import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '@/lib/serverAuth'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Cusdec XML Generator only ever edits an existing CUSDEC row's xml_data
// column — it never inserts a new cusdec row itself (that only happens via
// the normal PDF/Excel upload flow). GET loads the saved xml_data (or {} if
// none yet); POST updates it on that same row.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const authed = await requireAuth(req)
  if (!authed.ok) return res.status(authed.status).json({ error: authed.error })
  try {
    if (req.method === 'GET') {
      const id = String(req.query.id || '')
      if (!id) return res.status(400).json({ error: 'id required' })
      const { data, error } = await supabaseAdmin.from('cusdec').select('id, xml_data').eq('id', id).single()
      if (error) throw error
      return res.json({ xml_data: data?.xml_data || {} })
    }
    if (req.method === 'POST') {
      const { id, xml_data } = req.body
      if (!id) return res.status(400).json({ error: 'id required' })
      const { error } = await supabaseAdmin.from('cusdec').update({ xml_data }).eq('id', id)
      if (error) throw error
      return res.json({ ok: true })
    }
    return res.status(405).end()
  } catch (err: any) {
    console.error('[cusdec-xml] error:', err)
    res.status(500).json({ error: err.message })
  }
}
