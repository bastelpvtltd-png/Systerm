import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { requireAuth, requireSection } from '@/lib/serverAuth'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Admin/Overview "Pick History" audit log — who uploaded what, who picked
// it and when, searchable/filterable by document name, user, or action.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    try {
      const authed = await requireAuth(req)
      if (!authed.ok) return res.status(authed.status).json({ error: authed.error })

      const { user, action, fileName } = req.query
      let query = supabaseAdmin
        .from('pick_history_log')
        .select('*, document_uploads(id, file_name, doc_type, uploaded_by_name)')
        .order('action_timestamp', { ascending: false })
        .limit(500)

      if (user) query = query.ilike('user_name', `%${user}%`)
      if (action) query = query.eq('action', action as string)

      const { data, error } = await query
      if (error) throw error

      const items = fileName
        ? (data || []).filter((r: any) => (r.document_uploads?.file_name || '').toLowerCase().includes(String(fileName).toLowerCase()))
        : (data || [])

      return res.json({ items })
    } catch (err: any) {
      console.error('[pick-history] error:', err)
      return res.status(500).json({ error: err.message })
    }
  }

  if (req.method === 'DELETE') {
    // Deleting audit-trail entries is a lot more sensitive than reading
    // them — grantable per-user via section:pick-history.delete (default:
    // only admins have it) instead of a hardcoded is_admin check, same
    // granular-panel-access model as Database/Recycle Bin.
    const gated = await requireSection(req, 'section:pick-history.delete')
    if (!gated.ok) return res.status(gated.status).json({ error: gated.error })
    try {
      const id = String(req.query.id || '')
      if (!id) return res.status(400).json({ error: 'id required' })

      const { data: row } = await supabaseAdmin.from('pick_history_log').select('*').eq('id', id).maybeSingle()
      if (row) {
        const { data: prof } = await supabaseAdmin.from('profiles').select('username, full_name').eq('id', gated.userId).maybeSingle()
        await supabaseAdmin.from('deleted_records').insert({
          table_name: 'pick_history_log', record_id: id, record_data: row,
          file_name: null, drive_url: null,
          deleted_by: gated.userId, deleted_by_name: prof?.full_name || prof?.username || '',
        })
      }
      const { error } = await supabaseAdmin.from('pick_history_log').delete().eq('id', id)
      if (error) return res.status(400).json({ error: error.message })
      return res.json({ ok: true })
    } catch (err: any) {
      console.error('[pick-history] delete error:', err)
      return res.status(500).json({ error: err.message })
    }
  }

  res.status(405).end()
}
