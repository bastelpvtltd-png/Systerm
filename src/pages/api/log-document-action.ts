import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '@/lib/serverAuth'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// ── සිංහලෙන් ──────────────────────────────────────────────────────────────
// Pick කරගත්ත document එකකට Mail / Download / Look Only කළාම ඒක
// සටහන් කරන තැන. Mail හෝ Download කළාම ඒ වැඩේ ඉවරයි කියලා ගණන් —
// My Picked Tasks එකෙන් අයින් වෙනවා, සහ ඒකට අදාළ ගණන අනුමතයට යනවා
// (doc_approvals). Look Only කිසිම දෙයක් ඉවර කරන්නේ නෑ, බලනවා විතරයි.
// ──────────────────────────────────────────────────────────────────────────
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

      // Completing a picked task (Mail/Download) is the SECOND approval
      // stage — the "billing/CAP" count — for both CDN and CUSDEC reasons,
      // separate from the upload-stage approval in document-uploads.ts.
      // Neither stage auto-credits anything; both go through
      // doc-approvals.ts (admin-authorized), so a document's pay can never
      // be double-counted or counted before it's actually been signed off.
      try {
        const { data: doc } = await supabaseAdmin
          .from('document_uploads').select('reason, file_name, doc_type, cusdec_id').eq('id', document_id).maybeSingle()
        if ((doc?.reason === 'Container Moved' && doc?.doc_type === 'cdn') || (doc?.reason === 'CUSDEC Passed' && doc?.doc_type === 'cusdec')) {
          await supabaseAdmin.from('doc_approvals').insert({
            document_id, cusdec_id: doc.cusdec_id || null, doc_type: doc.doc_type, reason: doc.reason,
            uploaded_by: authed.userId, uploaded_by_name: userName, stage: 'billing',
          })
        } else if (doc?.reason === 'Boat Note Passed') {
          // Boat Note Pending's merge-and-pick flow (see dashboard.tsx's
          // confirmPick) had no count of its own at all — folds into
          // neither cdn_inc nor cap_inc. Gated the same way: only counts
          // once mailed/downloaded, and only after admin approval, crediting
          // a dedicated boat_note_inc — one per CUSDEC this merge covered
          // (see boat_note_locks; a merge can span several CUSDECs at once,
          // each with its own cap). A single pick batch produces up to 3
          // separate documents (Boat Note/Party's Copy/CDN merged PDFs),
          // each locking the same CUSDECs under their own document_id — so
          // whichever of the 3 gets Mailed/Downloaded FIRST is the one that
          // credits and releases the lock for that CUSDEC (deleted by
          // cusdec_id, not just this document_id) — the other 2 will find
          // no lock left for it and correctly skip crediting a second/third
          // time for the same CUSDEC.
          const { data: locks } = await supabaseAdmin.from('boat_note_locks').select('cusdec_id').eq('document_id', document_id)
          if (locks?.length) {
            const cusdecIds = locks.map(l => l.cusdec_id)
            await supabaseAdmin.from('doc_approvals').insert(
              cusdecIds.map(cid => ({
                document_id, cusdec_id: cid, doc_type: doc.doc_type || 'boat_note', reason: doc.reason,
                uploaded_by: authed.userId, uploaded_by_name: userName, stage: 'boat_note',
              }))
            )
            await supabaseAdmin.from('boat_note_locks').delete().in('cusdec_id', cusdecIds)
          }
        }
      } catch { /* non-fatal — doc_approvals is supplemental */ }
    }

    res.json({ ok: true })
  } catch (err: any) {
    console.error('[log-document-action] error:', err)
    res.status(500).json({ error: err.message })
  }
}
