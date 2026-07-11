import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { requireSection } from '@/lib/serverAuth'

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
  const authed = await requireSection(req, 'section:documents-upload.admin-edit')
  if (!authed.ok) return res.status(authed.status).json({ error: authed.error })
  try {
    const { doc_type, boxes, labels, excludeWords, formulas, variant } = req.body
    if (!doc_type || !boxes || !labels)
      return res.status(400).json({ error: 'doc_type, boxes, labels required' })
    const v = variant === 'scanned' ? 'scanned' : 'native'

    const { data: existing } = await supabaseAdmin
      .from('pdf_templates')
      .select('id, grid_config')
      .eq('doc_type', doc_type)
      .eq('variant', v)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    // This client only sends exclude-words/formulas for fields that currently
    // have a box drawn — a field without one yet (e.g. "code", set via the
    // per-field auto-save in save-field-rules.ts) was getting silently wiped
    // every time "Save Format" ran for any OTHER field, because this used to
    // replace the whole map instead of merging into what's already saved.
    const payload = {
      doc_type,
      variant: v,
      grid_config: {
        boxes,
        excludeWords: { ...(existing?.grid_config?.excludeWords || {}), ...(excludeWords || {}) },
        formulas: { ...(existing?.grid_config?.formulas || {}), ...(formulas || {}) },
        specs: existing?.grid_config?.specs || {},
      },
      field_map: labels,
    }

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
