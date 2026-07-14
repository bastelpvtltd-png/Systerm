import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { requireAuth, requireAdmin } from '@/lib/serverAuth'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// GET  — list CDNs pending admin approval (pending_admin_approval = true)
// POST — approve one CDN by id (admin only)
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method === 'GET') {
      const authed = await requireAuth(req)
      if (!authed.ok) return res.status(authed.status).json({ error: authed.error })
      const { data, error } = await supabaseAdmin
        .from('cdn')
        .select('*')
        .eq('pending_admin_approval', true)
        .order('uploaded_at', { ascending: false })
      if (error) throw error
      return res.json({ cdns: data || [] })
    }

    if (req.method === 'POST') {
      const authed = await requireAdmin(req)
      if (!authed.ok) return res.status(authed.status).json({ error: authed.error })
      const { cdn_id } = req.body
      if (!cdn_id) return res.status(400).json({ error: 'cdn_id required' })

      const { data: prof } = await supabaseAdmin.from('profiles').select('username, full_name').eq('id', authed.userId).maybeSingle()
      const approverName = prof?.full_name || prof?.username || ''

      const { error } = await supabaseAdmin
        .from('cdn')
        .update({
          pending_admin_approval: false,
          approved_by: approverName,
          approved_at: new Date().toISOString(),
        })
        .eq('id', cdn_id)
      if (error) throw error
      return res.json({ ok: true })
    }

    res.status(405).end()
  } catch (err: any) {
    console.error('[cdn-approval] error:', err)
    res.status(500).json({ error: err.message })
  }
}
