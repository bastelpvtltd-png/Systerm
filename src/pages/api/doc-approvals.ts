import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { requireAuth, requireAdmin } from '@/lib/serverAuth'

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Gates whether a CDN/CUSDEC document's counts ever actually credit anyone —
// TWO stages, both admin-authorized, neither automatic:
//   'upload'  — created when the document is first saved (document-
//               uploads.ts). Approving credits the upload count
//               (cdn_inc for CDN, cusdec_inc for CUSDEC).
//   'billing' — created when a picked task is actually completed, i.e.
//               Mail/Download (log-document-action.ts). Approving credits
//               the CAP/billing count (cap_inc) — the CUSDEC's own
//               container count for CUSDEC Passed docs, a flat 1 for CDN.
// Reject leaves that stage permanently uncounted; the other stage is
// unaffected either way.
//
// Two separate grantable panels, both gated (neither shows by default):
//   'Approvals' (section:my-tasks.cusdec-approval, or admin) — full power:
//               sees EVERY pending item + full history, Approve/Reject.
//   'Pending Approvals' (section:my-tasks.approvals-view) — read only, also
//               sees EVERY pending item + full history, no action buttons.
// Approving/rejecting still requires the 'Approvals' grant specifically —
// holding only the view grant never allows POST. Deleting a history entry
// stays admin-only either way (see DELETE below).
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const authed = await requireAuth(req)
  if (!authed.ok) return res.status(authed.status).json({ error: authed.error })
  const { data: selfProf } = await sb.from('profiles').select('is_admin, allowed_tabs').eq('id', authed.userId).maybeSingle()
  const isAdmin = !!selfProf?.is_admin
  const allowed = selfProf?.allowed_tabs || []
  const canApproveAll = isAdmin || allowed.includes('section:my-tasks.cusdec-approval')
  const canView = canApproveAll || allowed.includes('section:my-tasks.approvals-view')

  if (req.method === 'GET') {
    if (!canView) return res.status(403).json({ error: 'Access required: section:my-tasks.approvals-view or section:my-tasks.cusdec-approval' })
    if (req.query.history === '1') {
      const { data, error } = await sb.from('doc_approvals').select('*').neq('status', 'pending').order('decided_at', { ascending: false }).limit(10)
      if (error) return res.status(500).json({ error: error.message })
      return res.json({ history: data || [] })
    }
    const { data, error } = await sb.from('doc_approvals').select('*').eq('status', 'pending').order('created_at', { ascending: true })
    if (error) return res.status(500).json({ error: error.message })
    return res.json({ approvals: data || [], canApproveAll })
  }

  if (req.method === 'POST') {
    if (!canApproveAll) return res.status(403).json({ error: 'Access required: section:my-tasks.cusdec-approval' })
    const { id, action } = req.body as { id: string; action: 'approve' | 'reject' }
    if (!id || !action) return res.status(400).json({ error: 'id and action required' })

    const { data: approval } = await sb.from('doc_approvals').select('*').eq('id', id).maybeSingle()
    if (!approval) return res.status(404).json({ error: 'Not found' })
    if (approval.status !== 'pending') return res.status(400).json({ error: 'Already decided' })

    const { data: prof } = await sb.from('profiles').select('username, full_name').eq('id', authed.userId).maybeSingle()
    const decidedByName = prof?.full_name || prof?.username || ''

    if (action === 'reject') {
      await sb.from('doc_approvals').update({ status: 'rejected', decided_by: authed.userId, decided_by_name: decidedByName, decided_at: new Date().toISOString() }).eq('id', id)
      return res.json({ ok: true })
    }

    try {
      if (approval.stage === 'boat_note') {
        // "Boat cap" here is just the CUSDEC's own cap value (same field the
        // CAP/billing stage already reads) — this stage's own name for it,
        // not a separate column. Falls back to a flat 1 per document when unset.
        let boatCapValue = 1
        if (approval.cusdec_id) {
          const { data: cusdecRow } = await sb.from('cusdec').select('cap').eq('id', approval.cusdec_id).maybeSingle()
          const parsed = parseInt(String(cusdecRow?.cap ?? ''), 10)
          if (parsed > 0) boatCapValue = parsed
        }
        await sb.from('work_counts').insert({
          user_id: approval.uploaded_by, user_name: approval.uploaded_by_name,
          document_id: approval.document_id, file_name: null,
          reason: approval.reason, action: 'approved-boat-note',
          cdn_inc: 0, cusdec_inc: 0, cap_inc: 0, boat_note_inc: boatCapValue,
        })
      } else if (approval.stage === 'final_document') {
        const incCol = approval.doc_type === 'pytho' ? 'pytho_inc' : approval.doc_type === 'co' ? 'co_inc' : approval.doc_type === 'safta' ? 'safta_inc' : null
        if (incCol) {
          await sb.from('work_counts').insert({
            user_id: approval.uploaded_by, user_name: approval.uploaded_by_name,
            document_id: approval.document_id, file_name: null,
            reason: approval.reason, action: 'approved-final-document',
            cdn_inc: 0, cusdec_inc: 0, cap_inc: 0, [incCol]: 1,
          })
        }
      } else if (approval.stage === 'billing') {
        // CAP is the shipment's own container count for CUSDEC Passed —
        // CDN's billing stage has no equivalent per-row cap, so it's a
        // flat 1, same as its old un-gated cdn_inc credit used to be.
        let capValue = 1
        if (approval.doc_type === 'cusdec' && approval.cusdec_id) {
          const { data: cusdecRow } = await sb.from('cusdec').select('cap').eq('id', approval.cusdec_id).maybeSingle()
          const parsed = parseInt(String(cusdecRow?.cap ?? ''), 10)
          if (parsed > 0) capValue = parsed
        }
        await sb.from('work_counts').insert({
          user_id: approval.uploaded_by, user_name: approval.uploaded_by_name,
          document_id: approval.document_id, file_name: null,
          reason: approval.reason, action: 'approved-billing',
          cdn_inc: 0, cusdec_inc: 0, cap_inc: capValue,
        })
      } else {
        await sb.from('work_counts').insert({
          user_id: approval.uploaded_by, user_name: approval.uploaded_by_name,
          document_id: approval.document_id, file_name: null,
          reason: approval.reason, action: 'approved-upload',
          cdn_inc: approval.doc_type === 'cdn' ? 1 : 0,
          cusdec_inc: approval.doc_type === 'cusdec' ? 1 : 0,
          cap_inc: 0,
        })
      }
    } catch (e: any) {
      return res.status(500).json({ error: 'Approved but crediting the count failed: ' + e.message })
    }
    await sb.from('doc_approvals').update({ status: 'approved', decided_by: authed.userId, decided_by_name: decidedByName, decided_at: new Date().toISOString() }).eq('id', id)
    return res.json({ ok: true })
  }

  if (req.method === 'DELETE') {
    // Purging the approval HISTORY record itself (not the credited count —
    // that stays in work_counts either way) is admin-only, same reasoning
    // as Pick History's bulk-delete.
    const adminAuthed = await requireAdmin(req)
    if (!adminAuthed.ok) return res.status(adminAuthed.status).json({ error: adminAuthed.error })
    const { id } = req.query
    if (!id) return res.status(400).json({ error: 'id required' })
    const { error } = await sb.from('doc_approvals').delete().eq('id', id as string)
    if (error) return res.status(500).json({ error: error.message })
    return res.json({ ok: true })
  }

  res.status(405).end()
}
