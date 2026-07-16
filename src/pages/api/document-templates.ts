import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '@/lib/serverAuth'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

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
      const { id, type_key, name, file_name, drive_url, sheet_url, mapping, print_range, print_config, confirmUpdate } = req.body
      if (!type_key) return res.status(400).json({ error: 'type_key required' })

      // The effective URL for the template: sheet_url (Google Sheets) takes precedence
      // over drive_url (legacy .xlsx). Either is accepted; both are stored.
      const effectiveUrl = sheet_url || drive_url || null

      if (id) {
        const { data, error } = await supabaseAdmin.from('document_templates')
          .update({
            name,
            sheet_url: sheet_url || null,
            drive_url: drive_url || null,
            mapping: mapping || [],
            print_range: print_range ?? null,
            print_config: print_config ?? null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', id).select().single()
        if (error) throw error
        return res.json({ template: data })
      }

      if (!effectiveUrl) return res.status(400).json({ error: 'sheet_url or drive_url required' })

      const { data: typeRow } = await supabaseAdmin.from('document_template_types').select('label').eq('key', type_key).maybeSingle()
      const finalName = (name || '').trim() || typeRow?.label || type_key

      const { data: existing } = await supabaseAdmin.from('document_templates')
        .select('id').eq('type_key', type_key).eq('name', finalName).maybeSingle()

      if (existing && !confirmUpdate) {
        return res.json({ needsConfirm: true, existingId: existing.id, name: finalName })
      }

      if (existing && confirmUpdate) {
        const { data, error } = await supabaseAdmin.from('document_templates')
          .update({
            file_name: file_name || null,
            sheet_url: sheet_url || null,
            drive_url: drive_url || null,
            mapping: mapping || [],
            print_range: print_range ?? null,
            print_config: print_config ?? null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existing.id).select().single()
        if (error) throw error
        return res.json({ template: data, updated: true })
      }

      const { data, error } = await supabaseAdmin.from('document_templates')
        .insert({
          type_key,
          name: finalName,
          file_name: file_name || null,
          sheet_url: sheet_url || null,
          drive_url: drive_url || null,
          mapping: mapping || [],
          print_range: print_range ?? null,
          print_config: print_config ?? null,
        })
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
