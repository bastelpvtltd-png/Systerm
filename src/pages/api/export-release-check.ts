import type { NextApiRequest, NextApiResponse } from 'next'

// Sri Lanka Customs' public TrackMyCusDec lookup (services.customs.gov.lk).
// Confirmed live: GET / for a session cookie + csrf_token, then POST
// officeCode/serial/cusdecNumber/cusdecYear/consigneeTIN + that csrf_token
// to /dashboard using the same cookie. A wrong/unmatched combination comes
// back as a distinct "No Data" error page (HTTP 500, <h1 class="error-title">
// No Data</h1>) — anything else is a real result, returned as raw HTML since
// the exact success layout couldn't be captured without a genuine CUSDEC +
// Company TIN pair (only the real user has one to test with).
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
const BASE = 'https://services.customs.gov.lk'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  try {
    const { officeCode, serial, cusdecNumber, cusdecYear, consigneeTIN } = req.body
    if (!officeCode || !serial || !cusdecNumber || !cusdecYear || !consigneeTIN) {
      return res.status(400).json({ error: 'officeCode, serial, cusdecNumber, cusdecYear and consigneeTIN are all required' })
    }

    const homeResp = await fetch(`${BASE}/`, { headers: { 'User-Agent': UA } })
    const homeHtml = await homeResp.text()
    const csrf = homeHtml.match(/name="csrf_token" value="([^"]+)"/)?.[1]
    const cookie = homeResp.headers.get('set-cookie')?.split(';')[0]
    if (!csrf || !cookie) throw new Error('Could not start a session with the Customs site (page layout may have changed)')

    const body = new URLSearchParams({ officeCode, serial, cusdecNumber, cusdecYear, consigneeTIN, csrf_token: csrf })
    const dashResp = await fetch(`${BASE}/dashboard`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA, Cookie: cookie },
      body: body.toString(),
    })
    const dashHtml = await dashResp.text()

    if (/error-title/.test(dashHtml)) {
      return res.json({ found: false, message: 'No matching CUSDEC found for that Office Code / Serial / Number / Year / Company TIN combination.' })
    }

    // Strip tags rather than returning raw HTML to the browser — this is
    // government-site content fetched server-side, not something we want to
    // inject into the DOM verbatim.
    const text = dashHtml
      .replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, '\n').replace(/\n\s*\n+/g, '\n').split('\n').map(l => l.trim()).filter(Boolean).join('\n')

    res.json({ found: true, text })
  } catch (err: any) {
    console.error('[export-release-check] error:', err)
    res.status(500).json({ error: err.message })
  }
}
