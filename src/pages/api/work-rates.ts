import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { requireAuth, requireAdmin } from '@/lib/serverAuth'

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// GET  /api/work-rates          → returns { cdn_rate, cap_rate, pytho_rate, co_rate, safta_rate } (auth required)
// PATCH /api/work-rates         → admin: set rates
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const authed = await requireAuth(req)
  if (!authed.ok) return res.status(authed.status).json({ error: authed.error })

  if (req.method === 'GET') {
    const { data, error } = await sb.from('work_rates').select('cdn_rate,cap_rate,pytho_rate,co_rate,safta_rate').eq('id', 'global').single()
    if (error) return res.status(500).json({ error: error.message })
    return res.json({
      cdn_rate: Number(data.cdn_rate) || 0, cap_rate: Number(data.cap_rate) || 0,
      pytho_rate: Number(data.pytho_rate) || 0, co_rate: Number(data.co_rate) || 0, safta_rate: Number(data.safta_rate) || 0,
    })
  }

  if (req.method === 'PATCH') {
    const adminAuthed = await requireAdmin(req)
    if (!adminAuthed.ok) return res.status(adminAuthed.status).json({ error: adminAuthed.error })
    const { cdn_rate, cap_rate, pytho_rate, co_rate, safta_rate } = req.body
    const patch: Record<string, any> = { updated_at: new Date().toISOString(), updated_by: authed.userId }
    if (cdn_rate !== undefined) patch.cdn_rate = Number(cdn_rate) || 0
    if (cap_rate !== undefined) patch.cap_rate = Number(cap_rate) || 0
    if (pytho_rate !== undefined) patch.pytho_rate = Number(pytho_rate) || 0
    if (co_rate !== undefined) patch.co_rate = Number(co_rate) || 0
    if (safta_rate !== undefined) patch.safta_rate = Number(safta_rate) || 0
    const { data, error } = await sb.from('work_rates').update(patch).eq('id', 'global').select('cdn_rate,cap_rate,pytho_rate,co_rate,safta_rate').single()
    if (error) return res.status(500).json({ error: error.message })
    return res.json({
      ok: true, cdn_rate: Number(data.cdn_rate), cap_rate: Number(data.cap_rate),
      pytho_rate: Number(data.pytho_rate) || 0, co_rate: Number(data.co_rate) || 0, safta_rate: Number(data.safta_rate) || 0,
    })
  }

  res.status(405).end()
}
