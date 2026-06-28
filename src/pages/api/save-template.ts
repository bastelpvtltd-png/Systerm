import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  try {
    const { doc_type, grid_config, field_map } = req.body
    if (!doc_type || !grid_config || !field_map)
      return res.status(400).json({ error: 'doc_type, grid_config, field_map required' })

    const { data, error } = await supabaseAdmin
      .from('pdf_templates')
      .insert({ doc_type, grid_config, field_map })
      .select()
      .single()

    if (error) return res.status(400).json({ error: error.message })
    res.json({ id: data.id, doc_type: data.doc_type })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
}
