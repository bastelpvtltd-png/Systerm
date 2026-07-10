import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '@/lib/serverAuth'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Claims a notification for the calling user — the update below is the
// lock-out: it only succeeds if is_active is STILL true at the moment it
// runs (the .eq('is_active', true) filter), so if two users click Pick
// within milliseconds of each other, only the first one's UPDATE actually
// matches a row; the second gets zero rows back and a clear "already picked"
// error instead of both silently believing they got it.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  try {
    const authed = await requireAuth(req)
    if (!authed.ok) return res.status(authed.status).json({ error: authed.error })
    const { notification_id, document_id } = req.body
    if (!notification_id || !document_id) return res.status(400).json({ error: 'notification_id and document_id required' })

    const { data: claimed, error: claimErr } = await supabaseAdmin
      .from('dashboard_notifications')
      .update({ is_active: false })
      .eq('id', notification_id)
      .eq('is_active', true)
      .select()
    if (claimErr) throw claimErr
    if (!claimed?.length) return res.status(409).json({ error: 'Someone else already picked this' })

    const { data: prof } = await supabaseAdmin.from('profiles').select('username, full_name').eq('id', authed.userId).maybeSingle()
    const userName = prof?.full_name || prof?.username || ''

    const { data: task, error: taskErr } = await supabaseAdmin.from('user_tasks').insert({
      document_id, user_id: authed.userId, user_name: userName, status: 'active',
    }).select().single()
    if (taskErr) throw taskErr

    await supabaseAdmin.from('document_uploads').update({ status: 'picked' }).eq('id', document_id)
    await supabaseAdmin.from('pick_history_log').insert({ document_id, user_id: authed.userId, user_name: userName, action: 'pick' })

    res.json({ ok: true, task })
  } catch (err: any) {
    console.error('[pick-task] error:', err)
    res.status(500).json({ error: err.message })
  }
}
