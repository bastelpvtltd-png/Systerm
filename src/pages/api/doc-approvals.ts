import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { requireSection, requireAdmin } from '@/lib/serverAuth'

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
// unaffected either way. Whoever can act here is "admin-authorized" per the
// user's own wording — gated by section:my-tasks.cusdec-approval like every
// other grantable admin action, not open to everyone the way Final
// Document's pick-anyone model is.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const gated = await requireSection(req, 'section:my-tasks.cusdec-approval')
  if (!gated.ok) return res.status(gated.status).json({ error: gated.error })

  if (req.method === 'GET') {
    if (req.query.history === '1') {
      const { data, error } = await sb.from('doc_approvals').select('*').neq('status', 'pending').order('decided_at', { ascending: false }).limit(10)
      if (error) return res.status(500).json({ error: error.message })
      return res.json({ history: data || [] })
    }
    const { data, error } = await sb.from('doc_approvals').select('*').eq('status', 'pending').order('created_at', { ascending: true })
    if (error) return res.status(500).json({ error: error.message })
    return res.json({ approvals: data || [] })
  }

  if (req.method === 'POST') {
    const { id, action } = req.body as { id: string; action: 'approve' | 'reject' }
    if (!id || !action) return res.status(400).json({ error: 'id and action required' })

    const { data: approval } = await sb.from('doc_approvals').select('*').eq('id', id).maybeSingle()
    if (!approval) return res.status(404).json({ error: 'Not found' })
    if (approval.status !== 'pending') return res.status(400).json({ error: 'Already decided' })

    const { data: prof } = await sb.from('profiles').select('username, full_name').eq('id', gated.userId).maybeSingle()
    const decidedByName = prof?.full_name || prof?.username || ''

    if (action === 'reject') {
      await sb.from('doc_approvals').update({ status: 'rejected', decided_by: gated.userId, decided_by_name: decidedByName, decided_at: new Date().toISOString() }).eq('id', id)
      return res.json({ ok: true })
    }

    try {
      if (approval.stage === 'billing') {
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
    await sb.from('doc_approvals').update({ status: 'approved', decided_by: gated.userId, decided_by_name: decidedByName, decided_at: new Date().toISOString() }).eq('id', id)
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
