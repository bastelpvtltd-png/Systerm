import type { NextApiRequest, NextApiResponse } from 'next'

// Barcode Enter / Trico Gate Pass entry / Boat Note Check / Export Release
// Check all require driving a real login session on a government/port
// website (Navis, SLPA, Trico, Sri Lanka Customs) with real submitted data.
// That can't be built correctly by guessing selectors from a description —
// getting a field wrong on a live gate-pass or customs submission has real
// consequences, so this intentionally returns "not connected" instead of a
// best-guess automation until it's built and verified together against the
// real site (Playwright/Puppeteer, run once against a test entry first).
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  const { action } = req.body
  res.status(501).json({
    ok: false,
    error: `"${action || 'this action'}" isn't wired up to the live site yet — it needs a supervised session to build against the real page safely.`,
  })
}
