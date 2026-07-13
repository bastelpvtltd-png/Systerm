import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '@/lib/serverAuth'

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// GET  /api/user-notifications          → current user's unread notifications
// POST /api/user-notifications?mark_read=1  → mark all as read
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const authed = await requireAuth(req)
  if (!authed.ok) return res.status(authed.status).json({ error: authed.error })

  if (req.method === 'GET') {
    const { data, error } = await sb
      .from('user_notifications')
      .select('*')
      .eq('user_id', authed.userId)
      .is('read_at', null)
      .order('created_at', { ascending: false })
      .limit(50)
    if (error) return res.status(500).json({ error: error.message })
    return res.json({ notifications: data || [] })
  }

  if (req.method === 'POST') {
    const { mark_read, notification_id } = req.body
    if (mark_read) {
      const nowIso = new Date().toISOString()
      const q = sb.from('user_notifications').update({ read_at: nowIso }).eq('user_id', authed.userId).is('read_at', null)
      await q
    } else if (notification_id) {
      await sb.from('user_notifications').update({ read_at: new Date().toISOString() }).eq('id', notification_id).eq('user_id', authed.userId)
    }
    return res.json({ ok: true })
  }

  res.status(405).end()
}
