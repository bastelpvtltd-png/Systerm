import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Persists per-field correction boxes (arbitrary %-rectangles, not a uniform
// grid) as the "fixed format" for a doc_type — reuses the pdf_templates table
// that Grid Mapper writes to, but grid_config here holds { boxes: {...} }
// instead of { vLines, hLines }, which extract-pdf.ts tells apart at read time.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  try {
    const { doc_type, boxes, labels } = req.body
    if (!doc_type || !boxes || !labels)
      return res.status(400).json({ error: 'doc_type, boxes, labels required' })

    const { data: existing } = await supabaseAdmin
      .from('pdf_templates')
      .select('id')
      .eq('doc_type', doc_type)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    const payload = { doc_type, grid_config: { boxes }, field_map: labels }

    if (existing) {
      const { error } = await supabaseAdmin.from('pdf_templates').update(payload).eq('id', existing.id)
      if (error) return res.status(400).json({ error: error.message })
      return res.json({ id: existing.id, updated: true })
    }

    const { data, error } = await supabaseAdmin.from('pdf_templates').insert(payload).select().single()
    if (error) return res.status(400).json({ error: error.message })
    res.json({ id: data.id, updated: false })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
}
