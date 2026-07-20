import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '@/lib/serverAuth'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Remembers the last-used email Subject line (single row) so the "email this
// PDF" prompts default to it instead of a blank field — saving a different
// subject overwrites it for next time, exactly like the recipient list.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const authed = await requireAuth(req)
  if (!authed.ok) return res.status(authed.status).json({ error: authed.error })
  try {
    if (req.method === 'GET') {
      const { data } = await supabaseAdmin.from('email_settings').select('last_subject').eq('id', 1).maybeSingle()
      return res.json({ lastSubject: data?.last_subject || '' })
    }
    if (req.method === 'POST') {
      const lastSubject = String(req.body.lastSubject || '')
      const { error } = await supabaseAdmin.from('email_settings').upsert({ id: 1, last_subject: lastSubject, updated_at: new Date().toISOString() })
      if (error) throw error
      return res.json({ ok: true })
    }
    res.status(405).end()
  } catch (err: any) {
    console.error('[email-settings] error:', err)
    res.status(500).json({ error: err.message })
  }
}
