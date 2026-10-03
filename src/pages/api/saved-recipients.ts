import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '@/lib/serverAuth'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const KINDS = ['to', 'cc', 'bcc']
const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/

// Saved mail addresses are PRIVATE to the signed-in user (user_saved_recipients
// is keyed by user_id) — nobody else ever sees what one person saved. Each
// address also remembers whether it belongs in To, Cc or Bcc.
// Every query below filters on authed.userId; the service-role client skips
// RLS, so that filter is what actually enforces the privacy.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const authed = await requireAuth(req)
  if (!authed.ok) return res.status(authed.status).json({ error: authed.error })
  try {
    if (req.method === 'GET') {
      const { data, error } = await supabaseAdmin.from('user_saved_recipients')
        .select('id, email, kind').eq('user_id', authed.userId).order('email')
      if (error) throw error
      const recipients = data || []
      return res.json({ recipients, emails: Array.from(new Set(recipients.map(r => r.email))) })
    }

    if (req.method === 'POST') {
      // Accepts one { email, kind } or a batch { entries: [{ email, kind }] }
      const raw: { email?: string; kind?: string }[] = Array.isArray(req.body.entries) ? req.body.entries : [req.body]
      const rows = raw
        .map(e => ({ email: String(e.email || '').trim().toLowerCase(), kind: String(e.kind || 'to').toLowerCase() }))
        .filter(e => EMAIL_RE.test(e.email) && KINDS.includes(e.kind))
        .map(e => ({ user_id: authed.userId, email: e.email, kind: e.kind }))
      if (!rows.length) return res.status(400).json({ error: 'A valid email (and kind: to / cc / bcc) is required' })
      const { error } = await supabaseAdmin.from('user_saved_recipients').upsert(rows, { onConflict: 'user_id,email,kind' })
      if (error) throw error
      return res.json({ ok: true, saved: rows.length })
    }

    if (req.method === 'DELETE') {
      const id = String(req.query.id || '')
      if (!id) return res.status(400).json({ error: 'id required' })
      const { error } = await supabaseAdmin.from('user_saved_recipients').delete().eq('id', id).eq('user_id', authed.userId)
      if (error) throw error
      return res.json({ ok: true })
    }

    res.status(405).end()
  } catch (err: any) {
    console.error('[saved-recipients] error:', err)
    res.status(500).json({ error: err.message })
  }
}
