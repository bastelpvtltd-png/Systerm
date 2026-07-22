import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '@/lib/serverAuth'
import { deleteDriveFileByUrl } from '@/lib/driveFolders'

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

// "Final Document" pending-approval queue — see supabase/migrations/
// 20260719_final_document_tasks.sql. Picking is open to any signed-in user
// (same as pick-task.ts's model); once picked, only that picker (or an
// admin) can Reject or Done it — see §5/§7 of the design.
async function resolveName(userId: string, fallback?: string): Promise<string> {
  if (fallback) return fallback
  const { data: prof } = await sb.from('profiles').select('username, full_name').eq('id', userId).maybeSingle()
  return prof?.full_name || prof?.username || ''
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const authed = await requireAuth(req)
  if (!authed.ok) return res.status(authed.status).json({ error: authed.error })

  try {
    if (req.method === 'GET') {
      const { data, error } = await sb.from('final_document_tasks')
        .select('*').in('status', ['pending', 'picked']).order('created_at', { ascending: true })
      if (error) throw error
      return res.json({ tasks: data || [] })
    }

    if (req.method === 'POST') {
      const { action, task_id, drive_url, file_name, uploaded_by_name } = req.body as {
        action: 'pick' | 'reject' | 'done'; task_id: string; drive_url?: string; file_name?: string; uploaded_by_name?: string
      }
      if (!action || !task_id) return res.status(400).json({ error: 'action and task_id required' })
      const name = await resolveName(authed.userId, uploaded_by_name)

      if (action === 'pick') {
        // Atomic claim — matches pick-task.ts's compare-and-swap so two
        // people clicking Pick at once can't both win.
        const { data, error } = await sb.from('final_document_tasks')
          .update({ status: 'picked', picked_by: authed.userId, picked_by_name: name, picked_at: new Date().toISOString() })
          .eq('id', task_id).eq('status', 'pending')
          .select().maybeSingle()
        if (error) throw error
        if (!data) return res.status(409).json({ error: 'Already picked by someone else' })
        await sb.from('pick_history_log').insert({ document_id: data.document_id, user_id: authed.userId, user_name: name, action: 'pick' })
        return res.json({ ok: true, task: data })
      }

      const { data: task, error: taskErr } = await sb.from('final_document_tasks').select('*').eq('id', task_id).maybeSingle()
      if (taskErr) throw taskErr
      if (!task) return res.status(404).json({ error: 'Task not found' })
      if (task.status !== 'picked') return res.status(400).json({ error: 'Pick it first' })

      const { data: prof } = await sb.from('profiles').select('is_admin').eq('id', authed.userId).maybeSingle()
      if (task.picked_by !== authed.userId && !prof?.is_admin) {
        return res.status(403).json({ error: 'Only the person who picked this can resolve it' })
      }

      if (action === 'reject') {
        await deleteDriveFileByUrl(task.drive_url)
        // Only clear the saved link if it's still pointing at the same file
        // this task was created for — if it's already been replaced by
        // something newer in the meantime, leave that alone.
        const { data: link } = await sb.from('cusdec_document_links').select('drive_url')
          .eq('cusdec_id', task.cusdec_id).eq('document_type', task.document_type).maybeSingle()
        if (link?.drive_url === task.drive_url) {
          await sb.from('cusdec_document_links').delete().eq('cusdec_id', task.cusdec_id).eq('document_type', task.document_type)
        }
        // Reject reopens it rather than terminating it — back to 'pending'
        // (picked_by cleared) so it's pickable by anyone again instead of
        // permanently stuck rejected with no way to redo the document.
        await sb.from('final_document_tasks').update({
          status: 'pending', picked_by: null, picked_by_name: null, picked_at: null,
          drive_url: null, file_name: null,
        }).eq('id', task_id)
        await sb.from('pick_history_log').insert({ document_id: task.document_id, user_id: authed.userId, user_name: name, action: 'reject' })
        return res.json({ ok: true })
      }

      if (action === 'done') {
        if (!drive_url) return res.status(400).json({ error: 'drive_url required — upload the scanned document first' })
        const { data: existing } = await sb.from('cusdec_document_links').select('drive_url')
          .eq('cusdec_id', task.cusdec_id).eq('document_type', task.document_type).maybeSingle()
        if (existing?.drive_url && existing.drive_url !== drive_url) {
          await deleteDriveFileByUrl(existing.drive_url)
        }
        await sb.from('cusdec_document_links').upsert(
          { cusdec_id: task.cusdec_id, document_type: task.document_type, drive_url, file_name: file_name || null, updated_at: new Date().toISOString() },
          { onConflict: 'cusdec_id,document_type' }
        )
        await sb.from('final_document_tasks').update({
          status: 'done', resolved_at: new Date().toISOString(), drive_url, file_name: file_name || null,
        }).eq('id', task_id)
        await sb.from('pick_history_log').insert({ document_id: task.document_id, user_id: authed.userId, user_name: name, action: 'done' })

        // Final Document count — per doc type (pytho/co/safta each have their
        // own rate, see work-rates.ts), credited to whoever actually did it
        // (the picker), and only once Done is clicked — a rejected task
        // never counts, same idea as the CUSDEC/CDN approval gate.
        const incCol = task.document_type === 'pytho' ? 'pytho_inc' : task.document_type === 'co' ? 'co_inc' : task.document_type === 'safta' ? 'safta_inc' : null
        if (incCol) {
          try {
            await sb.from('work_counts').insert({
              user_id: task.picked_by, user_name: task.picked_by_name || name,
              document_id: task.document_id, file_name: file_name || task.file_name,
              reason: 'Final Document', action: 'done',
              cdn_inc: 0, cusdec_inc: 0, cap_inc: 0, [incCol]: 1,
            })
          } catch { /* non-fatal — work_counts is supplemental */ }
        }
        return res.json({ ok: true })
      }

      return res.status(400).json({ error: 'Unknown action' })
    }

    res.status(405).end()
  } catch (err: any) {
    console.error('[final-document-tasks] error:', err)
    res.status(500).json({ error: err.message })
  }
}
