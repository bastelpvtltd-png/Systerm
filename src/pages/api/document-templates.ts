import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '@/lib/serverAuth'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Template Naming Logic: no name typed -> defaults to the type's label
// ("Invoice"). If that name already exists for the same type, the caller
// must explicitly pass confirmUpdate:true to overwrite it instead of this
// silently creating a second template with a clashing name — the client
// shows the "Update instead?" prompt when this returns needsConfirm:true.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const authed = await requireAuth(req)
  if (!authed.ok) return res.status(authed.status).json({ error: authed.error })
  try {
    if (req.method === 'GET') {
      const { type_key } = req.query
      let query = supabaseAdmin.from('document_templates').select('*').order('name')
      if (type_key) query = query.eq('type_key', String(type_key))
      const { data, error } = await query
      if (error) throw error
      return res.json({ templates: data || [] })
    }

    if (req.method === 'POST') {
      const { id, type_key, name, file_name, drive_url, mapping, confirmUpdate } = req.body
      if (!type_key) return res.status(400).json({ error: 'type_key required' })

      if (id) {
        // Editing an existing template's mapping — no name-collision concern.
        const { data, error } = await supabaseAdmin.from('document_templates')
          .update({ name, mapping: mapping || [], updated_at: new Date().toISOString() })
          .eq('id', id).select().single()
        if (error) throw error
        return res.json({ template: data })
      }

      if (!file_name || !drive_url) return res.status(400).json({ error: 'file_name and drive_url required for a new template' })

      const { data: typeRow } = await supabaseAdmin.from('document_template_types').select('label').eq('key', type_key).maybeSingle()
      const finalName = (name || '').trim() || typeRow?.label || type_key

      const { data: existing } = await supabaseAdmin.from('document_templates')
        .select('id').eq('type_key', type_key).eq('name', finalName).maybeSingle()

      if (existing && !confirmUpdate) {
        return res.json({ needsConfirm: true, existingId: existing.id, name: finalName })
      }

      if (existing && confirmUpdate) {
        const { data, error } = await supabaseAdmin.from('document_templates')
          .update({ file_name, drive_url, mapping: mapping || [], updated_at: new Date().toISOString() })
          .eq('id', existing.id).select().single()
        if (error) throw error
        return res.json({ template: data, updated: true })
      }

      const { data, error } = await supabaseAdmin.from('document_templates')
        .insert({ type_key, name: finalName, file_name, drive_url, mapping: mapping || [] })
        .select().single()
      if (error) throw error
      return res.json({ template: data })
    }

    if (req.method === 'DELETE') {
      const id = String(req.query.id || '')
      if (!id) return res.status(400).json({ error: 'id required' })
      const { error } = await supabaseAdmin.from('document_templates').delete().eq('id', id)
      if (error) throw error
      return res.json({ ok: true })
    }

    res.status(405).end()
  } catch (err: any) {
    console.error('[document-templates] error:', err)
    res.status(500).json({ error: err.message })
  }
}
