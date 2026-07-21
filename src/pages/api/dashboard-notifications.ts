import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { requireAuth, requireAdmin } from '@/lib/serverAuth'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Dashboard's "Incoming" panel — every signed-in user sees every still-active
// (not yet picked) notification. Embeds document_uploads via the real FK so
// file_name/drive_url come back in one query.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const authed = await requireAuth(req)
    if (!authed.ok) return res.status(authed.status).json({ error: authed.error })

    if (req.method === 'GET') {
      const { data, error } = await supabaseAdmin
        .from('dashboard_notifications')
        .select('*, document_uploads(id, file_name, drive_url, doc_type, reason, reason_note)')
        .eq('is_active', true)
        .order('created_at', { ascending: false })
      if (error) throw error
      return res.json({ notifications: data || [] })
    }

    if (req.method === 'POST') {
      const { document_id } = req.body
      if (!document_id) return res.status(400).json({ error: 'document_id required' })
      const { data: prof } = await supabaseAdmin.from('profiles').select('username, full_name').eq('id', authed.userId).maybeSingle()
      const uploadedByName = prof?.full_name || prof?.username || ''

      const { error } = await supabaseAdmin.from('dashboard_notifications').insert({
        document_id, uploaded_by: authed.userId, uploaded_by_name: uploadedByName,
      })
      if (error) throw error
      await supabaseAdmin.from('document_uploads').update({ status: 'notified' }).eq('id', document_id)
      return res.json({ ok: true })
    }

    if (req.method === 'DELETE') {
      // Dismisses from the Activity Log only — is_active=false, same flag GET
      // already filters on, so the document/upload itself is never touched.
      // Admin-only, same as every other bulk-purge control in the app.
      const gated = await requireAdmin(req)
      if (!gated.ok) return res.status(gated.status).json({ error: gated.error })
      const { ids } = req.body as { ids: string[] }
      if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ids required' })
      const { error } = await supabaseAdmin.from('dashboard_notifications').update({ is_active: false }).in('id', ids)
      if (error) throw error
      return res.json({ ok: true })
    }

    res.status(405).end()
  } catch (err: any) {
    console.error('[dashboard-notifications] error:', err)
    res.status(500).json({ error: err.message })
  }
}
