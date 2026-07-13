import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { requireAuth, requireAdmin } from '@/lib/serverAuth'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Peer-to-peer "I paid you" record, not a real money transfer — this only
// tracks who says they paid whom, how much, and whether the recipient
// confirms it actually landed. Any signed-in user can log a payment they
// made (to another user or an arbitrary "Other" name); only the recipient
// can confirm/decline it, and only once — after that it's locked, matching
// the spec's "once OK'd nobody but admin can touch it". A user only ever
// sees rows where they're the payer or the recipient; admin sees everyone's.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method === 'GET') {
      const authed = await requireAuth(req)
      if (!authed.ok) return res.status(authed.status).json({ error: authed.error })

      const { data: prof } = await supabaseAdmin.from('profiles').select('is_admin').eq('id', authed.userId).maybeSingle()
      const isAdmin = !!prof?.is_admin
      let query = supabaseAdmin.from('salary_payments').select('*').order('created_at', { ascending: false })
      if (!isAdmin) query = query.or(`from_user_id.eq.${authed.userId},to_user_id.eq.${authed.userId}`)
      const { data, error } = await query
      if (error) return res.status(400).json({ error: error.message })

      // Admin's monitoring view pairs each user's salary activity with how
      // much processed-document work they've actually done (Pick History's
      // notify/pick/mail/download log) — one count per user_name, computed
      // here instead of a separate manual "work log" the user doesn't want.
      let workCounts: Record<string, number> | undefined
      if (isAdmin) {
        const { data: logRows } = await supabaseAdmin.from('pick_history_log').select('user_name')
        workCounts = {}
        for (const r of logRows || []) {
          if (!r.user_name) continue
          workCounts[r.user_name] = (workCounts[r.user_name] || 0) + 1
        }
      }

      return res.json({ payments: data || [], workCounts })
    }

    if (req.method === 'POST') {
      const authed = await requireAuth(req)
      if (!authed.ok) return res.status(authed.status).json({ error: authed.error })

      const { to_user_id, to_other_name, amount } = req.body
      const amt = Number(amount)
      if (!amt || amt <= 0) return res.status(400).json({ error: 'A positive amount is required' })
      if (!to_user_id && !to_other_name?.trim()) return res.status(400).json({ error: 'Pick a recipient or type an "Other" name' })

      const { data: fromProf } = await supabaseAdmin.from('profiles').select('username, full_name').eq('id', authed.userId).maybeSingle()
      const fromName = fromProf?.full_name || fromProf?.username || ''

      let toDisplayName = to_other_name?.trim() || ''
      if (to_user_id) {
        const { data: toProf } = await supabaseAdmin.from('profiles').select('username, full_name').eq('id', to_user_id).maybeSingle()
        toDisplayName = toProf?.full_name || toProf?.username || 'Unknown user'
      }

      const { data, error } = await supabaseAdmin.from('salary_payments').insert({
        from_user_id: authed.userId, from_user_name: fromName,
        to_user_id: to_user_id || null, to_other_name: to_user_id ? null : (to_other_name?.trim() || null),
        to_display_name: toDisplayName, amount: amt, status: 'pending',
      }).select().single()
      if (error) return res.status(400).json({ error: error.message })
      return res.json({ payment: data })
    }

    if (req.method === 'PATCH') {
      // Recipient confirms (OK) or declines (No) — only the recipient, only
      // while it's still pending. Once responded, this is locked; nobody but
      // admin's DELETE can touch it after that.
      const authed = await requireAuth(req)
      if (!authed.ok) return res.status(authed.status).json({ error: authed.error })

      const { id, status } = req.body
      if (!id || (status !== 'confirmed' && status !== 'declined')) {
        return res.status(400).json({ error: 'id and a valid status (confirmed/declined) are required' })
      }
      const { data: payment } = await supabaseAdmin.from('salary_payments').select('to_user_id, status').eq('id', id).maybeSingle()
      if (!payment) return res.status(404).json({ error: 'Payment not found' })
      if (payment.to_user_id !== authed.userId) return res.status(403).json({ error: 'Only the recipient can respond to this' })
      if (payment.status !== 'pending') return res.status(400).json({ error: 'Already responded to' })

      const { data, error } = await supabaseAdmin.from('salary_payments')
        .update({ status, responded_at: new Date().toISOString() }).eq('id', id).select().single()
      if (error) return res.status(400).json({ error: error.message })
      return res.json({ payment: data })
    }

    if (req.method === 'DELETE') {
      const admin = await requireAdmin(req)
      if (!admin.ok) return res.status(admin.status).json({ error: admin.error })
      const id = String(req.query.id || '')
      if (!id) return res.status(400).json({ error: 'id required' })
      const { error } = await supabaseAdmin.from('salary_payments').delete().eq('id', id)
      if (error) return res.status(400).json({ error: error.message })
      return res.json({ ok: true })
    }

    res.status(405).end()
  } catch (err: any) {
    console.error('[salary-payments] error:', err)
    res.status(500).json({ error: err.message })
  }
}
