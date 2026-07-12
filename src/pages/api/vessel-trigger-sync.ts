import type { NextApiRequest, NextApiResponse } from 'next'
import { syncVesselTriggers } from '@/lib/vesselTrigger'
import { requireAuth } from '@/lib/serverAuth'

// Manual "Trigger Now" for the Vessel Triggers tab — same sync logic the
// scheduled cron uses (cron-check-pending.ts), just user-initiated.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  const authed = await requireAuth(req)
  if (!authed.ok) return res.status(authed.status).json({ error: authed.error })
  try {
    const result = await syncVesselTriggers()
    res.json({ ok: true, ...result })
  } catch (err: any) {
    console.error('[vessel-trigger-sync] error:', err)
    res.status(500).json({ error: err.message })
  }
}
