import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '@/lib/serverAuth'

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

const DOC_TYPES = [
  { value: 'boat_note',     label: 'Boat Note' },
  { value: 'invoice',       label: 'Invoice' },
  { value: 'packing_list',  label: 'Packing List' },
  { value: 'co',            label: 'CO (Certificate of Origin)' },
  { value: 'pytho',         label: 'Phyto (Phytosanitary)' },
]

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const authed = await requireAuth(req)
  if (!authed.ok) return res.status(authed.status).json({ error: authed.error })

  try {
    if (req.method === 'GET') {
      if (req.query.types) return res.json({ types: DOC_TYPES })
      const { data, error } = await sb.from('doc_templates').select('*, template_mappings(*)').order('document_type')
      if (error) throw error
      return res.json({ templates: data || [] })
    }

    if (req.method === 'POST') {
      const { document_type, template_url, template_format, template_content, print_sheet_name, print_range, paper_size, orientation, mappings } = req.body
      const format = template_format || 'google_sheet'
      if (!document_type) return res.status(400).json({ error: 'document_type required' })
      if (format === 'google_sheet' && !template_url) return res.status(400).json({ error: 'template_url required for Google Sheet templates' })
      if (format !== 'google_sheet' && !template_content) return res.status(400).json({ error: 'template_content required for XML/Text templates' })

      const { fit_to_page } = req.body

      // Upsert template
      const { data: tpl, error: tplErr } = await sb.from('doc_templates')
        .upsert({
          document_type, template_url: template_url || null,
          template_format: format, template_content: template_content || null,
          print_sheet_name: print_sheet_name || null,
          print_range: print_range || null,
          paper_size: paper_size || 'A4',
          orientation: orientation || 'Portrait',
          fit_to_page: fit_to_page !== false,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'document_type' })
        .select().single()
      if (tplErr) throw tplErr

      // Replace mappings if provided
      if (Array.isArray(mappings)) {
        await sb.from('template_mappings').delete().eq('template_id', tpl.id)
        if (mappings.length > 0) {
          const rows = mappings.map((m: any) => ({
            template_id: tpl.id,
            field_label: m.field_label,
            data_source: m.data_source,
            column_name: m.column_name,
            is_repeating: m.is_repeating || false,
            target_cell_or_range: m.target_cell_or_range,
            sheet_name: m.sheet_name || null,
          }))
          const { error: mapErr } = await sb.from('template_mappings').insert(rows)
          if (mapErr) throw mapErr
        }
      }
      return res.json({ template: tpl })
    }

    if (req.method === 'DELETE') {
      const id = String(req.query.id || '')
      if (!id) return res.status(400).json({ error: 'id required' })
      await sb.from('doc_templates').delete().eq('id', id)
      return res.json({ ok: true })
    }

    res.status(405).end()
  } catch (e: any) {
    console.error('[doc-templates]', e)
    res.status(500).json({ error: e.message })
  }
}
