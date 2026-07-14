import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '@/lib/serverAuth'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Logs a 'mail', 'download', or 'look' action against a document — fills out
// the rest of pick_history_log's action set beyond pick/return.
//
// Whichever happens first for a picked document — Mail or Download — also
// auto-resolves that user's "My Picked Tasks" entry for it (marks it
// completed, doesn't re-open the notification to the pool the way a manual
// Return does — mail/download means the work is actually done, not handed
// back). "Look Only" never resolves anything, since it's explicitly a
// no-commitment preview.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  try {
    const authed = await requireAuth(req)
    if (!authed.ok) return res.status(authed.status).json({ error: authed.error })
    const { document_id, action } = req.body as { document_id: string; action: 'mail' | 'download' | 'look' }
    if (!document_id || !['mail', 'download', 'look'].includes(action)) return res.status(400).json({ error: 'document_id and a valid action required' })

    const { data: prof } = await supabaseAdmin.from('profiles').select('username, full_name').eq('id', authed.userId).maybeSingle()
    const userName = prof?.full_name || prof?.username || ''
    await supabaseAdmin.from('pick_history_log').insert({ document_id, user_id: authed.userId, user_name: userName, action })

    if (action === 'mail' || action === 'download') {
      await supabaseAdmin.from('user_tasks')
        .update({ status: 'completed' })
        .eq('document_id', document_id).eq('user_id', authed.userId).eq('status', 'active')

      // Increment work counts based on document reason (non-fatal if table missing)
      try {
        const { data: doc } = await supabaseAdmin
          .from('document_uploads').select('reason, file_name, doc_type').eq('id', document_id).maybeSingle()
        if (doc?.reason === 'Container Moved' && doc?.doc_type === 'cdn') {
          await supabaseAdmin.from('work_counts').insert({
            user_id: authed.userId, user_name: userName, document_id,
            file_name: doc.file_name, reason: doc.reason, action,
            cdn_inc: 1, cusdec_inc: 0, cap_inc: 0,
          })
        } else if (doc?.reason === 'CUSDEC Passed' && doc?.doc_type === 'cusdec') {
          await supabaseAdmin.from('work_counts').insert({
            user_id: authed.userId, user_name: userName, document_id,
            file_name: doc.file_name, reason: doc.reason, action,
            cdn_inc: 0, cusdec_inc: 0, cap_inc: 1,
          })
        }
      } catch { /* work_counts table not yet created — run the SQL migration */ }
    }

    res.json({ ok: true })
  } catch (err: any) {
    console.error('[log-document-action] error:', err)
    res.status(500).json({ error: err.message })
  }
}
