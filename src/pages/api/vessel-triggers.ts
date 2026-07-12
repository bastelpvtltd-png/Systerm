import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '@/lib/serverAuth'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Lists the synced vessel schedule (vessel_triggers, kept up to date by
// vesselTrigger.ts via manual trigger or the scheduled cron).
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end()
  const authed = await requireAuth(req)
  if (!authed.ok) return res.status(authed.status).json({ error: authed.error })
  try {
    const { search } = req.query
    let query = supabaseAdmin.from('vessel_triggers').select('*').order('etb', { ascending: true }).limit(500)
    const { data, error } = await query
    if (error) throw error
    const items = search
      ? (data || []).filter(r => `${r.vessel} ${r.voyage} ${r.terminal}`.toLowerCase().includes(String(search).toLowerCase()))
      : (data || [])
    res.json({ items })
  } catch (err: any) {
    console.error('[vessel-triggers] error:', err)
    res.status(500).json({ error: err.message })
  }
}
