import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '@/lib/serverAuth'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// The "Send" modal's umbrella record — created once per sent document
// regardless of which of Save/Mail/Notify were ticked, so Notify/Pick can
// reference a stable document_id even when Save wasn't ticked (the file
// still needs a Drive link to be viewable by other users via "Look Only").
//
// Folds the notification insert into this same request (pass notify: true)
// instead of a second round-trip to dashboard-notifications.ts — each
// serverless round-trip on Vercel has real fixed overhead, and this was
// most of what made "Done" feel slow. Also accepts an already-known
// uploaded_by_name from the client (documents-upload.tsx already resolved
// it once for the whole session) to skip a redundant profiles lookup —
// it's just a display label, not a security-sensitive value.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method === 'POST') {
      const authed = await requireAuth(req)
      if (!authed.ok) return res.status(authed.status).json({ error: authed.error })
      const { file_name, drive_url, doc_type, extracted_data, is_saved_to_db, notify, uploaded_by_name, reason, reason_note, cusdec_id, cusdec_number, lock_cusdec_ids } = req.body
      if (!file_name) return res.status(400).json({ error: 'file_name required' })

      let uploadedByName = uploaded_by_name || ''
      if (!uploadedByName) {
        const { data: prof } = await supabaseAdmin.from('profiles').select('username, full_name').eq('id', authed.userId).maybeSingle()
        uploadedByName = prof?.full_name || prof?.username || ''
      }

      const { data, error } = await supabaseAdmin.from('document_uploads').insert({
        file_name, drive_url: drive_url || null, doc_type: doc_type || null,
        extracted_data: extracted_data || null, is_saved_to_db: !!is_saved_to_db,
        status: notify ? 'notified' : (is_saved_to_db ? 'completed' : 'pending_action'),
        uploaded_by: authed.userId, uploaded_by_name: uploadedByName,
        reason: reason || null, reason_note: reason === 'Other' ? (reason_note || null) : null,
        cusdec_id: cusdec_id || null,
      }).select().single()
      if (error) throw error

      // Boat Note Pending's merge-and-pick (dashboard.tsx's confirmPick)
      // pins every CUSDEC it just merged so it can't be picked/merged again
      // by someone else — and stays visible in the pending list — until
      // this exact document is Mailed/Downloaded (released in
      // log-document-action.ts). See boat_note_locks migration.
      if (Array.isArray(lock_cusdec_ids) && lock_cusdec_ids.length) {
        try {
          await supabaseAdmin.from('boat_note_locks').insert(
            lock_cusdec_ids.map((cid: string) => ({ cusdec_id: cid, document_id: data.id, locked_by_name: uploadedByName }))
          )
        } catch { /* non-fatal — locks are supplemental, not a hard guarantee */ }
      }

      // "Final Document" is its own approval queue (final_document_tasks),
      // separate from the generic Notify/dashboard_notifications pending-item
      // path — that path force-disables Notify once a document is already
      // saved (the exact state a Final Document send is normally in), and its
      // "pending item" shape (a flat file list) doesn't carry the CUSDEC
      // number + document type the Dashboard panel needs to show.
      //
      // Only actually queue a task the FIRST time this cusdec+doc_type is
      // sent as Final Document — gated on `notify` (SendModal already knows
      // not to notify on a replace/re-save via notifyDisabled) and on there
      // being no pending/picked task for the same pair already. Every later
      // send for the same doc type is just a replace/update — the Save step
      // (document-link.ts / final-document-tasks.ts's own `done`/`update`
      // actions) already keeps cusdec_document_links current without a new
      // task or a second notify.
      if (reason === 'Final Document' && cusdec_id && doc_type && drive_url && notify) {
        const { data: existingTask } = await supabaseAdmin.from('final_document_tasks')
          .select('id').eq('cusdec_id', cusdec_id).eq('document_type', doc_type).in('status', ['pending', 'picked']).maybeSingle()
        if (!existingTask) {
          await supabaseAdmin.from('final_document_tasks').insert({
            cusdec_id, cusdec_number: cusdec_number || null, document_type: doc_type,
            drive_url, file_name, status: 'pending',
            created_by: authed.userId, created_by_name: uploadedByName,
            document_id: data.id,
          })
          await supabaseAdmin.from('pick_history_log').insert({
            document_id: data.id, user_id: authed.userId, user_name: uploadedByName, action: 'final_document_pending',
          })
        }
      }

      // Upload-time count is gated by admin-authorized approval now, for
      // both CDN (Container Moved) and CUSDEC (CUSDEC Passed) — a doc never
      // auto-credits just for being uploaded. See doc-approvals.ts; the
      // second (billing/CAP) approval stage happens separately once the
      // picked task is actually completed (mail/download), in
      // log-document-action.ts.
      try {
        if ((doc_type === 'cdn' && reason === 'Container Moved') || (doc_type === 'cusdec' && reason === 'CUSDEC Passed')) {
          await supabaseAdmin.from('doc_approvals').insert({
            document_id: data.id, cusdec_id: cusdec_id || null, doc_type, reason,
            uploaded_by: authed.userId, uploaded_by_name: uploadedByName, stage: 'upload',
          })
        }
      } catch { /* non-fatal — doc_approvals is supplemental */ }

      // Final Document already has its own dedicated pending queue
      // (final_document_tasks, above) — also dropping it into the generic
      // Active Log (dashboard_notifications) made it pickable two different
      // ways at once, so a document could show as "pending" in the Final
      // Document panel after it had already been picked via Active Log (or
      // vice versa). Final Document sends skip this generic path entirely.
      if (notify && reason !== 'Final Document') {
        const nowIso = new Date().toISOString()
        await supabaseAdmin.from('dashboard_notifications').insert({
          document_id: data.id, uploaded_by: authed.userId, uploaded_by_name: uploadedByName,
        })
        await supabaseAdmin.from('pick_history_log').insert({
          document_id: data.id, user_id: authed.userId, user_name: uploadedByName, action: 'notify',
          pdf_notify_user: uploadedByName, notify_update_time: nowIso,
        })
      }

      // Conflict detection: if a document of the same type + extracted reference
      // key is currently 'picked' by someone, flag it as a conflict and notify them.
      if (doc_type && extracted_data) {
        const refKey = extracted_data.container_no || extracted_data.number || extracted_data.cdn_no || null
        if (refKey) {
          // Find picked docs of same type with matching reference
          const { data: picked } = await supabaseAdmin
            .from('document_uploads')
            .select('id, extracted_data')
            .eq('doc_type', doc_type)
            .eq('status', 'picked')
            .neq('id', data.id)
            .limit(10)
          const matching = (picked || []).filter(p => {
            const ed = p.extracted_data || {}
            return ed.container_no === refKey || ed.number === refKey || ed.cdn_no === refKey
          })

          for (const old of matching) {
            // Find who picked it
            const { data: task } = await supabaseAdmin
              .from('user_tasks')
              .select('user_id, user_name')
              .eq('document_id', old.id)
              .eq('status', 'active')
              .maybeSingle()

            try {
              await supabaseAdmin.from('document_conflicts').insert({
                old_doc_id: old.id, new_doc_id: data.id,
                picked_by: task?.user_id || null,
                picked_by_name: task?.user_name || '',
                doc_type, ref_key: refKey,
              })
            } catch {}

            // In-app notification for the user who has the old doc
            if (task?.user_id) {
              try {
                await supabaseAdmin.from('user_notifications').insert({
                  user_id: task.user_id,
                  type: 'conflict',
                  title: 'Document Updated',
                  body: `A new version of ${doc_type.replace('_', ' ').toUpperCase()} (${refKey}) was uploaded. Check Conflict Review in Admin.`,
                  link_href: '/admin/automation',
                })
              } catch {}
            }
          }
        }
      }

      return res.json({ document: data })
    }
    res.status(405).end()
  } catch (err: any) {
    console.error('[document-uploads] error:', err)
    res.status(500).json({ error: err.message })
  }
}
