import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { requireAuth, requireAdmin } from '@/lib/serverAuth'

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Lists generated Monthly/Balance Reports (balance_reports, see
// generate-balance-report.ts) — every user sees only their own by default;
// admin can pass ?all=1 to see everyone's, same pattern as work-counts.ts.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    const authed = await requireAuth(req)
    if (!authed.ok) return res.status(authed.status).json({ error: authed.error })

    let q = sb.from('balance_reports').select('*').order('generated_at', { ascending: false })
    if (req.query.all) {
      const { data: prof } = await sb.from('profiles').select('is_admin').eq('id', authed.userId).maybeSingle()
      if (!prof?.is_admin) return res.status(403).json({ error: 'Admin only' })
    } else {
      q = q.eq('user_id', authed.userId)
    }
    const { data, error } = await q.limit(200)
    if (error) return res.status(500).json({ error: error.message })
    return res.json({ reports: data || [] })
  }

  if (req.method === 'DELETE') {
    // Deletes the report record itself only — does not un-archive (reported
    // -> false) the work_counts/other_work/salary_payments rows it
    // summarized, since that history is real and already correctly reset
    // for the next period regardless of whether this report row exists.
    const adminAuthed = await requireAdmin(req)
    if (!adminAuthed.ok) return res.status(adminAuthed.status).json({ error: adminAuthed.error })
    const { id } = req.query
    if (!id) return res.status(400).json({ error: 'id required' })
    const { error } = await sb.from('balance_reports').delete().eq('id', id as string)
    if (error) return res.status(500).json({ error: error.message })
    return res.json({ ok: true })
  }

  res.status(405).end()
}
