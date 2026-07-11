import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '@/lib/serverAuth'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Lists the "Done Boat Note" archive — every Boat Note ever saved via Save
// Only (save-boat-note.ts writes one row here per save). Supports the
// spec's date-range / CUSDEC-number filters.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end()
  const authed = await requireAuth(req)
  if (!authed.ok) return res.status(authed.status).json({ error: authed.error })
  try {
    const { cusdecNumber, from, to } = req.query
    let query = supabaseAdmin.from('generated_boat_notes').select('*').order('created_at', { ascending: false }).limit(500)
    if (cusdecNumber) query = query.ilike('cusdec_number', `%${cusdecNumber}%`)
    if (from) query = query.gte('created_at', String(from))
    if (to) query = query.lte('created_at', String(to))
    const { data, error } = await query
    if (error) throw error
    res.json({ items: data || [] })
  } catch (err: any) {
    console.error('[generated-boat-notes] error:', err)
    res.status(500).json({ error: err.message })
  }
}
