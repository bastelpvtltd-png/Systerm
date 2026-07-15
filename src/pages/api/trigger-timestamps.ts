import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '@/lib/serverAuth'

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Returns the last-fired timestamps for the three dashboard trigger widgets:
//   boatNote      – last time a boat note was generated (boat_note_created_at in cusdec)
//   exportRelease – last time export_release_passed was set (trigger_log)
//   vessel        – next upcoming ETB from vessel_triggers
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end()
  const authed = await requireAuth(req)
  if (!authed.ok) return res.status(authed.status).json({ error: authed.error })

  try {
    const [{ data: bnRow }, { data: erRow }, { data: vesselRow }] = await Promise.all([
      // Last CDN container that passed boat note check
      sb.from('cdn')
        .select('container_no, boat_note_checked_at')
        .not('boat_note_checked_at', 'is', null)
        .order('boat_note_checked_at', { ascending: false })
        .limit(1)
        .maybeSingle(),

      // Last CUSDEC that passed export release check
      sb.from('cusdec')
        .select('number, export_release_checked_at')
        .not('export_release_checked_at', 'is', null)
        .order('export_release_checked_at', { ascending: false })
        .limit(1)
        .maybeSingle(),

      // Next upcoming vessel ETB
      sb.from('vessel_triggers')
        .select('vessel, voyage, etb, opening_time, closing_time')
        .order('etb', { ascending: true })
        .limit(1)
        .maybeSingle(),
    ])

    return res.json({
      boatNote: bnRow
        ? { time: bnRow.boat_note_checked_at, container: bnRow.container_no }
        : null,
      exportRelease: erRow
        ? { time: erRow.export_release_checked_at, cusdec: erRow.number }
        : null,
      vessel: vesselRow
        ? { etb: vesselRow.etb, vessel: vesselRow.vessel, voyage: vesselRow.voyage, opening: vesselRow.opening_time, closing: vesselRow.closing_time }
        : null,
    })
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
