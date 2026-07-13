import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { requireAuth, requireAdmin } from '@/lib/serverAuth'

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// GET  /api/work-counts?user_id=...    → totals + detail rows for one user
// GET  /api/work-counts?all=1          → admin: all users summary
// POST /api/work-counts                → insert one increment row (called by log-document-action)
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const authed = await requireAuth(req)
  if (!authed.ok) return res.status(authed.status).json({ error: authed.error })

  if (req.method === 'GET') {
    const { all, user_id } = req.query
    const targetId = all ? null : (user_id as string || authed.userId)

    let q = sb.from('work_counts').select('*').order('created_at', { ascending: false })
    if (targetId) q = q.eq('user_id', targetId)

    const { data, error } = await q.limit(500)
    if (error) return res.status(500).json({ error: error.message })

    // Aggregate totals
    const rows = data || []
    const totals = {
      cdn_count:    rows.reduce((s, r) => s + (r.cdn_inc || 0), 0),
      cusdec_count: rows.reduce((s, r) => s + (r.cusdec_inc || 0), 0),
      cap_count:    rows.reduce((s, r) => s + (r.cap_inc || 0), 0),
    }
    return res.json({ totals, rows })
  }

  if (req.method === 'DELETE') {
    const adminAuthed = await requireAdmin(req)
    if (!adminAuthed.ok) return res.status(adminAuthed.status).json({ error: adminAuthed.error })
    const { id } = req.query
    if (!id) return res.status(400).json({ error: 'id required' })
    await sb.from('work_counts').delete().eq('id', id)
    return res.json({ ok: true })
  }

  res.status(405).end()
}
