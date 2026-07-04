import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { extractByGrid } from '@/lib/gridExtract'

export const config = { api: { bodyParser: { sizeLimit: '20mb' } } }

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  try {
    const { base64, doc_type } = req.body
    if (!base64 || !doc_type) return res.status(400).json({ error: 'base64 and doc_type required' })

    const { data: template, error } = await supabaseAdmin
      .from('pdf_templates')
      .select('id, grid_config, field_map')
      .eq('doc_type', doc_type)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) return res.status(400).json({ error: error.message })
    if (!template) return res.json({ hasTemplate: false, fields: [] })

    const buffer = Buffer.from(base64, 'base64')
    const fields = await extractByGrid(buffer, template.grid_config, template.field_map)

    res.json({ hasTemplate: true, templateId: template.id, fields })
  } catch (err: any) {
    console.error('[extract-grid] error:', err)
    res.status(500).json({ error: err.message })
  }
}
