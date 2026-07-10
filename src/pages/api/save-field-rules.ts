import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Persists one field's exclude-words/OCR-fix rules to the doc type's template
// immediately (on blur/Enter) — doesn't require the field to have a box yet,
// or the user to click "Save Format", so the rule survives a reload right away.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  try {
    const { doc_type, key, label, excludeWords, formula, specNote, variant } = req.body
    if (!doc_type || !key) return res.status(400).json({ error: 'doc_type and key required' })
    const v = variant === 'scanned' ? 'scanned' : 'native'

    const { data: existing } = await supabaseAdmin
      .from('pdf_templates')
      .select('id, grid_config, field_map')
      .eq('doc_type', doc_type)
      .eq('variant', v)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    const gridConfig = existing?.grid_config || { boxes: {} }
    const fieldMap = { ...(existing?.field_map || {}) }
    const excludeWordsMap = { ...(gridConfig.excludeWords || {}) }
    const formulasMap = { ...(gridConfig.formulas || {}) }
    const specsMap = { ...(gridConfig.specs || {}) }

    if (label) fieldMap[key] = label
    if (excludeWords?.trim()) excludeWordsMap[key] = excludeWords; else delete excludeWordsMap[key]
    if (formula?.trim()) formulasMap[key] = formula; else delete formulasMap[key]
    if (specNote?.trim()) specsMap[key] = specNote; else delete specsMap[key]

    const payload = {
      doc_type,
      variant: v,
      grid_config: { ...gridConfig, excludeWords: excludeWordsMap, formulas: formulasMap, specs: specsMap },
      field_map: fieldMap,
    }

    if (existing) {
      const { error } = await supabaseAdmin.from('pdf_templates').update(payload).eq('id', existing.id)
      if (error) return res.status(400).json({ error: error.message })
    } else {
      const { error } = await supabaseAdmin.from('pdf_templates').insert(payload)
      if (error) return res.status(400).json({ error: error.message })
    }

    res.json({ ok: true })
  } catch (err: any) {
    console.error('[save-field-rules] error:', err)
    res.status(500).json({ error: err.message })
  }
}
