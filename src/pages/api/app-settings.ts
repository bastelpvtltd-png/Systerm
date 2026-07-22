import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { requireAuth, requireAdmin } from '@/lib/serverAuth'

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Tiny generic key/value store for system-wide toggles (currently just
// monthly_reports_enabled) — not per-user, not a permission, just "is this
// automated thing switched on".
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const authed = await requireAuth(req)
  if (!authed.ok) return res.status(authed.status).json({ error: authed.error })

  if (req.method === 'GET') {
    const key = String(req.query.key || '')
    if (!key) return res.status(400).json({ error: 'key required' })
    const { data } = await sb.from('app_settings').select('value').eq('key', key).maybeSingle()
    return res.json({ key, value: data?.value ?? null })
  }

  if (req.method === 'POST') {
    const adminAuthed = await requireAdmin(req)
    if (!adminAuthed.ok) return res.status(adminAuthed.status).json({ error: adminAuthed.error })
    const { key, value } = req.body as { key: string; value: string }
    if (!key) return res.status(400).json({ error: 'key required' })
    const { error } = await sb.from('app_settings').upsert({ key, value: String(value) })
    if (error) return res.status(500).json({ error: error.message })
    return res.json({ ok: true })
  }

  res.status(405).end()
}
