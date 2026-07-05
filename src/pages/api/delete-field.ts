import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { DOC_TYPE_TABLE, dropColumn } from '@/lib/docTables'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Deleting a field in the Documents popup removes it from the saved box
// template AND drops the matching column from the doc type's real table —
// "one delete" instead of cleaning up the template and the schema separately.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  try {
    const { doc_type, key } = req.body
    if (!doc_type || !key) return res.status(400).json({ error: 'doc_type and key required' })

    const { data: template } = await supabaseAdmin
      .from('pdf_templates')
      .select('id, grid_config, field_map')
      .eq('doc_type', doc_type)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (template?.grid_config?.boxes?.[key]) {
      const boxes = { ...template.grid_config.boxes }
      delete boxes[key]
      const fieldMap = { ...(template.field_map || {}) }
      delete fieldMap[key]
      const excludeWords = { ...(template.grid_config.excludeWords || {}) }
      delete excludeWords[key]
      const replacements = { ...(template.grid_config.replacements || {}) }
      delete replacements[key]
      await supabaseAdmin.from('pdf_templates')
        .update({ grid_config: { boxes, excludeWords, replacements }, field_map: fieldMap })
        .eq('id', template.id)
    }

    const table = DOC_TYPE_TABLE[doc_type]
    if (table && table !== 'boat_notes') await dropColumn(table, key)

    res.json({ ok: true })
  } catch (err: any) {
    console.error('[delete-field] error:', err)
    res.status(500).json({ error: err.message })
  }
}
