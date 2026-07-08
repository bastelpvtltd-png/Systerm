import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    const { data, error } = await supabaseAdmin.from('doc_templates').select('*').order('created_at', { ascending: false })
    if (error) return res.status(400).json({ error: error.message })
    return res.json({ templates: data || [] })
  }
  if (req.method === 'DELETE') {
    const id = String(req.query.id || '')
    if (!id) return res.status(400).json({ error: 'id required' })
    const { error } = await supabaseAdmin.from('doc_templates').delete().eq('id', id)
    if (error) return res.status(400).json({ error: error.message })
    return res.json({ ok: true })
  }
  res.status(405).end()
}
