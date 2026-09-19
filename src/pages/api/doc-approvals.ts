import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { requireAuth, requireAdmin } from '@/lib/serverAuth'

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// A stage only credits a count when the document TYPE and the REASON it was
// sent with agree — CDN needs "Container Moved", CUSDEC needs "CUSDEC Passed"
// (upload + billing stages); a Final Document needs Pytho/CO/SAFTA with the
// "Final Document" reason. Anything else is refused at approve time, so a
// mismatched item can never be counted (it stays pending and can be Rejected).
// boat_note: its reason text isn't checked here (set in log-document-action.ts).
const REQUIRED_REASON: Record<string, string> = { cdn: 'Container Moved', cusdec: 'CUSDEC Passed' }
const FINAL_DOC_TYPES = ['pytho', 'co', 'safta']
const sameText = (a: any, b: string) => String(a ?? '').trim().toLowerCase() === b.trim().toLowerCase()

function mismatchError(a: any): string | null {
  if (a.stage === 'final_document') {
    if (!FINAL_DOC_TYPES.includes(a.doc_type) || !sameText(a.reason, 'Final Document'))
      return `Cannot count: a Final Document must be Pytho / CO / SAFTA with reason "Final Document" (this one is "${a.doc_type}" / "${a.reason}")`
    return null
  }
  if (a.stage === 'boat_note') return null
  // 'upload' and 'billing'
  const need = REQUIRED_REASON[a.doc_type]
  if (!need || !sameText(a.reason, need))
    return `Cannot count: "${a.doc_type}" needs reason "${need || 'CDN / CUSDEC only'}" (this one is "${a.reason}")`
  return null
}

// The CUSDEC's own container (cap) count; 1 when it isn't set.
async function cusdecCap(cusdecId: string | null): Promise<number> {
  if (!cusdecId) return 1
  const { data: cusdecRow } = await sb.from('cusdec').select('cap').eq('id', cusdecId).maybeSingle()
  const parsed = parseInt(String(cusdecRow?.cap ?? ''), 10)
  return parsed > 0 ? parsed : 1
}

// Document name for each approval, so the panels can show it.
async function withFileNames(rows: any[]) {
  const ids = Array.from(new Set(rows.map(r => r.document_id).filter(Boolean)))
  if (!ids.length) return rows
  const { data: docs } = await sb.from('document_uploads').select('id, file_name').in('id', ids)
  const names = new Map((docs || []).map((d: any) => [d.id, d.file_name]))
  return rows.map(r => ({ ...r, file_name: names.get(r.document_id) ?? r.file_name ?? null }))
}

// Gates whether a CDN/CUSDEC document's counts ever actually credit anyone —
// TWO stages, both admin-authorized, neither automatic:
//   'upload'  — created when the document is first saved (document-
//               uploads.ts). Approving credits the UPLOAD count:
//               cdn_inc = 1 per CDN PDF, cusdec_inc = the CUSDEC's own
//               container (cap) count. Row action 'approved-upload' —
//               shown in Upload Count only, never in Balance.
//   'billing' — created when a picked task is actually completed, i.e.
//               Mail/Download (log-document-action.ts). Approving credits
//               the BALANCE count: cap_inc = the CUSDEC's own container
//               count for CUSDEC Passed docs, cdn_inc = 1 per PDF for CDN.
// Reject leaves that stage permanently uncounted; the other stage is
// unaffected either way.
//
// ── සිංහලෙන් ──────────────────────────────────────────────────────────────
// ගණන් අනුමත කිරීමේ පිටුව. CDN/CUSDEC/Boat Note/Final Document ඕනෑම
// වැඩක් ගණනට වැටෙන්නේ මෙතනින් Approve කළාම විතරයි — automatic ගණන්
// වෙන එකක් නෑ. Approve කළාම work_counts එකට row එකක් යනවා (ඒකයි
// පඩියට බලපාන්නේ), Reject කළොත් කවදාවත් ගණන් වෙන්නේ නෑ.
// Approve/Reject කරන්න පුළුවන් elevated grant එක තියෙන කෙනෙකුට විතරයි.
// ──────────────────────────────────────────────────────────────────────────
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
    // ?mine=1 → only the caller's OWN items, open to any signed-in user (the
    // Balance panel's approved/rejected list). Without it the view/approve
    // grant is still required and everyone's items come back.
    const mine = req.query.mine === '1'
    if (!canView && !mine) return res.status(403).json({ error: 'Access required: section:my-tasks.approvals-view or section:my-tasks.cusdec-approval' })
    const ownOnly = mine || !canView
    if (req.query.history === '1') {
      let hq = sb.from('doc_approvals').select('*').neq('status', 'pending').order('decided_at', { ascending: false }).limit(100)
      if (ownOnly) hq = hq.eq('uploaded_by', authed.userId)
      const { data, error } = await hq
      if (error) return res.status(500).json({ error: error.message })
      return res.json({ history: await withFileNames(data || []) })
    }
    let pq = sb.from('doc_approvals').select('*').eq('status', 'pending').order('created_at', { ascending: true })
    if (ownOnly) pq = pq.eq('uploaded_by', authed.userId)
    const { data, error } = await pq
    if (error) return res.status(500).json({ error: error.message })
    return res.json({ approvals: await withFileNames(data || []), canApproveAll })
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

    // Type + reason must agree before anything is counted (see top of file).
    const mismatch = mismatchError(approval)
    if (mismatch) return res.status(400).json({ error: mismatch })

    const { data: docRow } = await sb.from('document_uploads').select('file_name').eq('id', approval.document_id).maybeSingle()
    const fileName = docRow?.file_name || null

    try {
      if (approval.stage === 'boat_note') {
        // "Boat cap" here is just the CUSDEC's own cap value (same field the
        // CAP/billing stage already reads) — this stage's own name for it,
        // not a separate column. Falls back to a flat 1 per document when unset.
        const boatCapValue = await cusdecCap(approval.cusdec_id)
        await sb.from('work_counts').insert({
          user_id: approval.uploaded_by, user_name: approval.uploaded_by_name,
          document_id: approval.document_id, file_name: fileName,
          reason: approval.reason, action: 'approved-boat-note',
          cdn_inc: 0, cusdec_inc: 0, cap_inc: 0, boat_note_inc: boatCapValue,
        })
      } else if (approval.stage === 'final_document') {
        const incCol = approval.doc_type === 'pytho' ? 'pytho_inc' : approval.doc_type === 'co' ? 'co_inc' : approval.doc_type === 'safta' ? 'safta_inc' : null
        if (incCol) {
          await sb.from('work_counts').insert({
            user_id: approval.uploaded_by, user_name: approval.uploaded_by_name,
            document_id: approval.document_id, file_name: fileName,
            reason: approval.reason, action: 'approved-final-document',
            cdn_inc: 0, cusdec_inc: 0, cap_inc: 0, [incCol]: 1,
          })
        }
      } else if (approval.stage === 'billing') {
        // CUSDEC Passed → CAP, counted by the CUSDEC's own container count
        //   (the panel also shows how many CUSDEC PDFs that came from).
        // Container Moved (CDN) → counted per PDF at the CDN rate (cdn_inc).
        const isCdn = approval.doc_type === 'cdn'
        const capValue = isCdn ? 0 : await cusdecCap(approval.cusdec_id)
        await sb.from('work_counts').insert({
          user_id: approval.uploaded_by, user_name: approval.uploaded_by_name,
          document_id: approval.document_id, file_name: fileName,
          reason: approval.reason, action: 'approved-billing',
          cdn_inc: isCdn ? 1 : 0, cusdec_inc: 0, cap_inc: capValue,
        })
      } else {
        // Upload count: CDN = 1 per PDF; CUSDEC = its container (cap) count.
        const uploadCusdec = approval.doc_type === 'cusdec' ? await cusdecCap(approval.cusdec_id) : 0
        await sb.from('work_counts').insert({
          user_id: approval.uploaded_by, user_name: approval.uploaded_by_name,
          document_id: approval.document_id, file_name: fileName,
          reason: approval.reason, action: 'approved-upload',
          cdn_inc: approval.doc_type === 'cdn' ? 1 : 0,
          cusdec_inc: uploadCusdec,
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