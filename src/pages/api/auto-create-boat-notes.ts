import type { NextApiRequest, NextApiResponse } from 'next'
import { requireAuth } from '@/lib/serverAuth'
import { autoCreateBoatNotes } from '@/lib/autoCreateDocs'

// Manual "Run Now" trigger for the Boat Note Create automation panel — the
// scheduled version of the same call lives in cron-check-pending.ts.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  const authed = await requireAuth(req)
  if (!authed.ok) return res.status(authed.status).json({ error: authed.error })
  try {
    const summary = await autoCreateBoatNotes()
    res.json({ ok: true, ...summary })
  } catch (err: any) {
    console.error('[auto-create-boat-notes] error:', err)
    res.status(500).json({ error: err.message })
  }
}
