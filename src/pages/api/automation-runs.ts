import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '@/lib/serverAuth'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Lets the Boat Note Check / Export Release Check panels show and edit
// their own scheduler interval (plain minutes — 1440 for "once a day") and
// see when the cron route (cron-check-pending.ts) last actually ran them.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const authed = await requireAuth(req)
  if (!authed.ok) return res.status(authed.status).json({ error: authed.error })
  try {
    if (req.method === 'GET') {
      const { data, error } = await supabaseAdmin.from('automation_runs').select('*')
      if (error) throw error
      return res.json({ runs: data || [] })
    }

    if (req.method === 'POST') {
      const { panel, interval_minutes, enabled } = req.body as { panel?: string; interval_minutes?: number; enabled?: boolean }
      if (!['boat_note', 'export_release', 'vessel_trigger'].includes(panel || '')) return res.status(400).json({ error: 'panel must be boat_note, export_release, or vessel_trigger' })
      const patch: Record<string, any> = { updated_at: new Date().toISOString() }
      if (interval_minutes !== undefined) {
        const minutes = Number(interval_minutes)
        if (!Number.isFinite(minutes) || minutes < 1) return res.status(400).json({ error: 'interval_minutes must be a positive number' })
        patch.interval_minutes = Math.round(minutes)
      }
      if (enabled !== undefined) patch.enabled = !!enabled
      const { error } = await supabaseAdmin.from('automation_runs').update(patch).eq('panel', panel)
      if (error) throw error
      return res.json({ ok: true })
    }

    res.status(405).end()
  } catch (err: any) {
    console.error('[automation-runs] error:', err)
    res.status(500).json({ error: err.message })
  }
}
