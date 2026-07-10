import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '@/lib/serverAuth'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// "My Picked Tasks" — only this user's own active picks. Returning one
// re-opens the notification for everyone else exactly as it was (same
// document, Look Only + Pick again) instead of leaving it stuck.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const authed = await requireAuth(req)
    if (!authed.ok) return res.status(authed.status).json({ error: authed.error })

    if (req.method === 'GET') {
      const { data, error } = await supabaseAdmin
        .from('user_tasks')
        .select('*, document_uploads(id, file_name, drive_url, doc_type)')
        .eq('user_id', authed.userId).eq('status', 'active')
        .order('picked_at', { ascending: false })
      if (error) throw error
      return res.json({ tasks: data || [] })
    }

    if (req.method === 'POST') {
      // "Resolve / Return" is one button/one action per the spec — it always
      // hands the document back to the pool (Return Logic), it's not a
      // separate "mark done and keep it" outcome.
      const { task_id } = req.body as { task_id: string }
      if (!task_id) return res.status(400).json({ error: 'task_id required' })

      const { data: task } = await supabaseAdmin.from('user_tasks').select('document_id, user_id').eq('id', task_id).maybeSingle()
      if (!task) return res.status(404).json({ error: 'Task not found' })
      if (task.user_id !== authed.userId) return res.status(403).json({ error: 'Not your task' })

      await supabaseAdmin.from('user_tasks').update({ status: 'returned' }).eq('id', task_id)
      // Re-open the notification for every user again, and put the document
      // back into the "notified" (incoming) state — same as before it was picked.
      await supabaseAdmin.from('dashboard_notifications').update({ is_active: true }).eq('document_id', task.document_id)
      await supabaseAdmin.from('document_uploads').update({ status: 'notified' }).eq('id', task.document_id)

      const { data: prof } = await supabaseAdmin.from('profiles').select('username, full_name').eq('id', authed.userId).maybeSingle()
      const userName = prof?.full_name || prof?.username || ''
      await supabaseAdmin.from('pick_history_log').insert({
        document_id: task.document_id, user_id: authed.userId, user_name: userName, action: 'return',
      })

      return res.json({ ok: true })
    }

    res.status(405).end()
  } catch (err: any) {
    console.error('[user-tasks] error:', err)
    res.status(500).json({ error: err.message })
  }
}
