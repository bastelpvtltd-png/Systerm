import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Template Type dropdown (invoice, packing_list, co, pytho, boat_note,
// partys by default) + "Add new template type". is_auto_capable marks
// boat_note/partys as eligible for the CAP-complete-CUSDEC "Auto" button.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method === 'GET') {
      const { data, error } = await supabaseAdmin.from('document_template_types').select('*').order('label')
      if (error) throw error
      return res.json({ types: data || [] })
    }
    if (req.method === 'POST') {
      const { key, label } = req.body
      if (!key || !label) return res.status(400).json({ error: 'key and label required' })
      const cleanKey = String(key).toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '')
      if (!cleanKey) return res.status(400).json({ error: 'Invalid key' })
      const { data, error } = await supabaseAdmin.from('document_template_types')
        .upsert({ key: cleanKey, label }, { onConflict: 'key' }).select().single()
      if (error) throw error
      return res.json({ type: data })
    }
    res.status(405).end()
  } catch (err: any) {
    console.error('[template-types] error:', err)
    res.status(500).json({ error: err.message })
  }
}
