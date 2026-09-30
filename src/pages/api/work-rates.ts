import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { requireAuth, requireAdmin } from '@/lib/serverAuth'

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// GET  /api/work-rates  → { cdn_rate, cap_rate, pytho_rate, co_rate, safta_rate, boat_note_rate } (auth required)
// PATCH /api/work-rates → admin: set rates
//
// boat_note_rate (the "Boat Cap" rate) used to be missing from BOTH the GET
// and the PATCH here: the My Tasks page sent it, this route ignored it, so it
// never saved and always came back as 0 — and Boat Cap count × 0 = Rs. 0, so
// an approved Boat Cap never reached Cost/Balance. It is now read and saved
// like every other rate. (The work_rates table needs a boat_note_rate column —
// see the SQL note in the reply.)
const shape = (data: any) => ({
  cdn_rate: Number(data?.cdn_rate) || 0, cap_rate: Number(data?.cap_rate) || 0,
  pytho_rate: Number(data?.pytho_rate) || 0, co_rate: Number(data?.co_rate) || 0, safta_rate: Number(data?.safta_rate) || 0,
  boat_note_rate: Number(data?.boat_note_rate) || 0,
})

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const authed = await requireAuth(req)
  if (!authed.ok) return res.status(authed.status).json({ error: authed.error })

  if (req.method === 'GET') {
    // select('*') so this still works before the boat_note_rate column exists.
    const { data, error } = await sb.from('work_rates').select('*').eq('id', 'global').single()
    if (error) return res.status(500).json({ error: error.message })
    return res.json(shape(data))
  }

  if (req.method === 'PATCH') {
    const adminAuthed = await requireAdmin(req)
    if (!adminAuthed.ok) return res.status(adminAuthed.status).json({ error: adminAuthed.error })
    const { cdn_rate, cap_rate, pytho_rate, co_rate, safta_rate, boat_note_rate } = req.body
    const patch: Record<string, any> = { updated_at: new Date().toISOString(), updated_by: authed.userId }
    if (cdn_rate !== undefined) patch.cdn_rate = Number(cdn_rate) || 0
    if (cap_rate !== undefined) patch.cap_rate = Number(cap_rate) || 0
    if (pytho_rate !== undefined) patch.pytho_rate = Number(pytho_rate) || 0
    if (co_rate !== undefined) patch.co_rate = Number(co_rate) || 0
    if (safta_rate !== undefined) patch.safta_rate = Number(safta_rate) || 0
    if (boat_note_rate !== undefined) patch.boat_note_rate = Number(boat_note_rate) || 0
    const { data, error } = await sb.from('work_rates').update(patch).eq('id', 'global').select('*').single()
    if (error) {
      const hint = /boat_note_rate/i.test(error.message)
        ? ' — the work_rates table has no boat_note_rate column yet. Run: alter table work_rates add column if not exists boat_note_rate numeric not null default 0;'
        : ''
      return res.status(500).json({ error: error.message + hint })
    }
    return res.json({ ok: true, ...shape(data) })
  }

  res.status(405).end()
}