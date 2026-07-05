import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Native and scanned copies of the same doc_type usually share the same field
// layout, just shifted/scaled — copying one variant's box template into the
// other gives the user a starting point to drag into place instead of
// redrawing every box from scratch.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  try {
    const { doc_type, fromVariant, toVariant } = req.body
    if (!doc_type || !fromVariant || !toVariant)
      return res.status(400).json({ error: 'doc_type, fromVariant, toVariant required' })
    if (fromVariant === toVariant)
      return res.status(400).json({ error: 'fromVariant and toVariant must differ' })

    const { data: source } = await supabaseAdmin
      .from('pdf_templates')
      .select('grid_config, field_map')
      .eq('doc_type', doc_type)
      .eq('variant', fromVariant)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!source?.grid_config?.boxes || !Object.keys(source.grid_config.boxes).length)
      return res.status(404).json({ error: `No saved boxes found for the ${fromVariant} variant of "${doc_type}"` })

    const { data: existing } = await supabaseAdmin
      .from('pdf_templates')
      .select('id')
      .eq('doc_type', doc_type)
      .eq('variant', toVariant)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    const payload = {
      doc_type,
      variant: toVariant,
      grid_config: source.grid_config,
      field_map: source.field_map || {},
    }

    if (existing) {
      const { error } = await supabaseAdmin.from('pdf_templates').update(payload).eq('id', existing.id)
      if (error) return res.status(400).json({ error: error.message })
    } else {
      const { error } = await supabaseAdmin.from('pdf_templates').insert(payload)
      if (error) return res.status(400).json({ error: error.message })
    }

    res.json({
      ok: true,
      boxes: source.grid_config.boxes,
      labels: source.field_map || {},
      excludeWords: source.grid_config.excludeWords || {},
      formulas: source.grid_config.formulas || {},
    })
  } catch (err: any) {
    console.error('[copy-field-boxes] error:', err)
    res.status(500).json({ error: err.message })
  }
}
