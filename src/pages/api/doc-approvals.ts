import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { requireSection } from '@/lib/serverAuth'

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Gates whether a CUSDEC upload's upload-count and billing (CAP) count ever
// actually credit anyone — document-uploads.ts inserts a pending row here
// instead of crediting work_counts immediately; only Approve here does that,
// exactly once, ever (Reject leaves it uncounted permanently). Whoever can
// act here is "admin-authorized" per the user's own wording — gated by
// section:my-tasks.cusdec-approval like every other grantable admin action,
// not open to everyone the way Final Document's pick-anyone model is.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const gated = await requireSection(req, 'section:my-tasks.cusdec-approval')
  if (!gated.ok) return res.status(gated.status).json({ error: gated.error })

  if (req.method === 'GET') {
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

    // Approve — credit the ORIGINAL uploader, not whoever approved it. CAP
    // is the shipment's own container count (same lookup log-document-
    // action.ts's mail/download path used to do before this gate existed),
    // read off the cusdec row this upload was linked to.
    let capValue = 1
    if (approval.cusdec_id) {
      const { data: cusdecRow } = await sb.from('cusdec').select('cap').eq('id', approval.cusdec_id).maybeSingle()
      const parsed = parseInt(String(cusdecRow?.cap ?? ''), 10)
      if (parsed > 0) capValue = parsed
    }
    try {
      await sb.from('work_counts').insert({
        user_id: approval.uploaded_by, user_name: approval.uploaded_by_name,
        document_id: approval.document_id, file_name: null,
        reason: approval.reason, action: 'approved',
        cdn_inc: 0, cusdec_inc: 1, cap_inc: capValue,
      })
    } catch (e: any) {
      return res.status(500).json({ error: 'Approved but crediting the count failed: ' + e.message })
    }
    await sb.from('doc_approvals').update({ status: 'approved', decided_by: gated.userId, decided_by_name: decidedByName, decided_at: new Date().toISOString() }).eq('id', id)
    return res.json({ ok: true })
  }

  res.status(405).end()
}
