import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { requireAdmin } from '@/lib/serverAuth'

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Admin-only — permanently deletes a login AND every personal/payroll
// record tied to it (work counts, other work, payments sent+received,
// approval history, pick/mail/download log, picked-task state, generated
// balance reports), then the profile row and the auth account itself. Does
// NOT touch the company's actual business records (document_uploads,
// cusdec/cdn/barcode, final_document_tasks) — those stay as the real
// audit trail of what was uploaded/processed even after the account that
// did it is gone, same reasoning as pick_history_log surviving a document's
// own deletion elsewhere in this app.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  const authed = await requireAdmin(req)
  if (!authed.ok) return res.status(authed.status).json({ error: authed.error })

  try {
    const { user_id } = req.body as { user_id: string }
    if (!user_id) return res.status(400).json({ error: 'user_id required' })
    if (user_id === authed.userId) return res.status(400).json({ error: "Can't delete your own account" })

    await Promise.all([
      sb.from('work_counts').delete().eq('user_id', user_id),
      sb.from('other_work').delete().eq('user_id', user_id),
      sb.from('salary_payments').delete().or(`from_user_id.eq.${user_id},to_user_id.eq.${user_id}`),
      sb.from('doc_approvals').delete().or(`uploaded_by.eq.${user_id},decided_by.eq.${user_id}`),
      sb.from('pick_history_log').delete().eq('user_id', user_id),
      sb.from('user_tasks').delete().eq('user_id', user_id),
      sb.from('balance_reports').delete().eq('user_id', user_id),
    ])

    await sb.from('profiles').delete().eq('id', user_id)
    await sb.auth.admin.deleteUser(user_id).catch(() => {})

    res.json({ ok: true })
  } catch (err: any) {
    console.error('[delete-user] error:', err)
    res.status(500).json({ error: err.message })
  }
}
