import type { NextApiRequest, NextApiResponse } from 'next'
import { checkBoatNote } from '@/lib/automationChecks'
import { requireAuth } from '@/lib/serverAuth'

// Public, no-login lookup on Trico's own site — confirmed live by fetching
// https://s2.tricologi.net/webuser/?option=etc&action=boatnote_check with a
// real browser User-Agent (it 403s a generic one) and inspecting its form:
// a single POST of cont_numebr to ?option=etc&action=boatnote_check_view
// returns an HTML fragment with the container/vessel and a status line in
// an alert-success/alert-warning/alert-danger div. Bootstrap-style alert
// levels: success = received (pass), warning/danger = not yet — this hasn't
// been confirmed against a genuine "received" container yet, so treat the
// first few real "passed" results as worth double-checking by eye.
//
// The actual scrape+pass/fail logic lives in automationChecks.ts so the
// scheduled cron route (cron-check-pending.ts) can drive the exact same
// check without duplicating it.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  const authed = await requireAuth(req)
  if (!authed.ok) return res.status(authed.status).json({ error: authed.error })
  try {
    const containerNo = String(req.body.containerNo || '').trim()
    const cdnId = req.body.cdnId ? String(req.body.cdnId) : undefined
    if (!containerNo) return res.status(400).json({ error: 'Container number required' })

    const result = await checkBoatNote(containerNo, cdnId)
    res.json(result)
  } catch (err: any) {
    console.error('[boat-note-check] error:', err)
    res.status(500).json({ error: err.message })
  }
}
