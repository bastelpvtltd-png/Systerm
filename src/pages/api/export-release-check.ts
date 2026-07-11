import type { NextApiRequest, NextApiResponse } from 'next'
import { checkExportRelease } from '@/lib/automationChecks'
import { requireAuth } from '@/lib/serverAuth'

// Sri Lanka Customs' public TrackMyCusDec lookup (services.customs.gov.lk).
// Confirmed live: GET / for a session cookie + csrf_token, then POST
// officeCode/serial/cusdecNumber/cusdecYear/consigneeTIN + that csrf_token
// to /dashboard using the same cookie. A wrong/unmatched combination comes
// back as a distinct "No Data" error page (HTTP 500, <h1 class="error-title">
// No Data</h1>).
//
// Pass/fail rule (confirmed against a real result page): "Export release"
// actually appears TWICE — once as the CURRENT STATUS summary near the top
// (immediately followed by "Reg Date" — a date with no time, e.g.
// "24-Jun-2026", which is the CUSDEC's registration date, NOT when it was
// released), and again as the last row of the CUSDEC ACTIVITY log, which
// carries the real event timestamp with both date and time (e.g.
// "2026-07-05 01:34 AM"). Only that second one is meaningful — see
// automationChecks.ts, which holds the actual scrape+compare logic so the
// scheduled cron route can drive the same check without duplicating it.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  const authed = await requireAuth(req)
  if (!authed.ok) return res.status(authed.status).json({ error: authed.error })
  try {
    const { officeCode, serial, cusdecNumber, cusdecYear, consigneeTIN, cusdecId } = req.body
    if (!officeCode || !serial || !cusdecNumber || !cusdecYear || !consigneeTIN) {
      return res.status(400).json({ error: 'officeCode, serial, cusdecNumber, cusdecYear and consigneeTIN are all required' })
    }
    const result = await checkExportRelease({ officeCode, serial, cusdecNumber, cusdecYear, consigneeTIN, cusdecId })
    res.json(result)
  } catch (err: any) {
    console.error('[export-release-check] error:', err)
    res.status(500).json({ error: err.message })
  }
}
