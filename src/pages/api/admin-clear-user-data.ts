import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { requireAdmin } from '@/lib/serverAuth'

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

// Admin-only reset of one user's financial history — deletes their Count
// Work rows, their Other Work rows, and payments they've received
// (to_user_id), so My Tasks' Cost/Received/Balance for that user goes back
// to zero. Payments they SENT to others are untouched (that's the other
// person's received-payment history, not this user's).
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  const authed = await requireAdmin(req)
  if (!authed.ok) return res.status(authed.status).json({ error: authed.error })

  try {
    const { user_id } = req.body as { user_id: string }
    if (!user_id) return res.status(400).json({ error: 'user_id required' })

    const [wc, ow, sp] = await Promise.all([
      sb.from('work_counts').delete().eq('user_id', user_id).select('id'),
      sb.from('other_work').delete().eq('user_id', user_id).select('id'),
      sb.from('salary_payments').delete().eq('to_user_id', user_id).select('id'),
    ])
    if (wc.error) throw wc.error
    if (ow.error) throw ow.error
    if (sp.error) throw sp.error

    res.json({
      ok: true,
      deleted: { work_counts: wc.data?.length || 0, other_work: ow.data?.length || 0, payments: sp.data?.length || 0 },
    })
  } catch (err: any) {
    console.error('[admin-clear-user-data] error:', err)
    res.status(500).json({ error: err.message })
  }
}
