import type { NextApiRequest, NextApiResponse } from 'next'
import { requireSection } from '@/lib/serverAuth'
import { requireWorker } from '@/lib/workerAuth'
import { runSlice } from '@/lib/automation/runner'

// One serverless run of the Barcode Enter automation (headless Chromium inside this function).
// Called by the Automation page after "Run", and repeated by the page until nothing is left in the
// queue. 300 s needs a Vercel plan/setting that allows it (Hobby with Fluid Compute, or Pro); if the
// deploy complains, lower this to 60 AND set the env var AUTOMATION_MAX_MS=45000.
export const config = { maxDuration: 300 }

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  const viaSecret = requireWorker(req).ok     // Authorization: Bearer WORKER_SECRET (for an external scheduler)
  if (!viaSecret) {
    const authed = await requireSection(req, 'section:automation.barcode-enter')
    if (!authed.ok) return res.status(authed.status).json({ error: authed.error })
  }
  try {
    const host = String(req.headers.host || '')
    const proto = String(req.headers['x-forwarded-proto'] || (/^(localhost|127\.0\.0\.1)/.test(host) ? 'http' : 'https')).split(',')[0]
    const result = await runSlice({ origin: `${proto}://${host}` })
    res.json(result)
  } catch (err: any) {
    console.error('[automation-run] error:', err)
    res.status(500).json({ error: err.message })
  }
}
