import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { requireAuth, requireAdmin } from '@/lib/serverAuth'

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// The Other Work "Type" dropdown (Panel / Amendment / Other / ...) — a plain
// admin-managed list, same shape as document_template_types, so new types an
// admin adds show up for every user immediately rather than being typed fresh
// each time.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const authed = await requireAuth(req)
  if (!authed.ok) return res.status(authed.status).json({ error: authed.error })

  if (req.method === 'GET') {
    const { data, error } = await sb.from('other_work_types').select('*').order('created_at')
    if (error) return res.status(500).json({ error: error.message })
    return res.json({ types: data || [] })
  }

  if (req.method === 'POST') {
    const adminAuthed = await requireAdmin(req)
    if (!adminAuthed.ok) return res.status(adminAuthed.status).json({ error: adminAuthed.error })
    const { label } = req.body
    if (!label?.trim()) return res.status(400).json({ error: 'label required' })
    const { data, error } = await sb.from('other_work_types').insert({ label: label.trim() }).select().single()
    if (error) return res.status(500).json({ error: error.message })
    return res.json({ ok: true, type: data })
  }

  res.status(405).end()
}
