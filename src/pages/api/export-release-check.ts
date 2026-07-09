import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { parseFlexibleDate } from '@/lib/flexibleDate'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Sri Lanka Customs' public TrackMyCusDec lookup (services.customs.gov.lk).
// Confirmed live: GET / for a session cookie + csrf_token, then POST
// officeCode/serial/cusdecNumber/cusdecYear/consigneeTIN + that csrf_token
// to /dashboard using the same cookie. A wrong/unmatched combination comes
// back as a distinct "No Data" error page (HTTP 500, <h1 class="error-title">
// No Data</h1>).
//
// Pass/fail rule (per the user): the result is only "released" if its status
// says EXPORT RELEASE (not NOT EXPORT RELEASE) *and* the release date/time is
// later than the CUSDEC's own date — an EXPORT RELEASE line dated before the
// CUSDEC was even filed doesn't count. The exact success-page layout wasn't
// capturable without a genuine CUSDEC + Company TIN pair, so this parses the
// sanitized text generically (a line containing the office/serial/number/year
// plus a trailing status, with the nearest date on/after it) — worth
// eyeballing the raw text on the first few real checks to confirm it's
// reading the right row.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
const BASE = 'https://services.customs.gov.lk'

function toSanitizedText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, '\n').replace(/\n\s*\n+/g, '\n').split('\n').map(l => l.trim()).filter(Boolean).join('\n')
}

const DATE_PATTERN = /\b(\d{4}-\d{1,2}-\d{1,2}(?:[ T]\d{1,2}:\d{2}(:\d{2})?)?|\d{1,2}[./]\d{1,2}[./]\d{2,4}(?:\s+\d{1,2}:\d{2}(:\d{2})?)?)\b/

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  try {
    const { officeCode, serial, cusdecNumber, cusdecYear, consigneeTIN, cusdecId } = req.body
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

    const text = toSanitizedText(dashHtml)
    const lines = text.split('\n')
    const rowIdx = lines.findIndex(l =>
      l.toUpperCase().includes(String(officeCode).toUpperCase()) &&
      l.includes(String(cusdecNumber)) && l.includes(String(cusdecYear))
    )
    const rowLine = rowIdx >= 0 ? lines[rowIdx] : ''
    const notReleased = /NOT\s+EXPORT\s+RELEASE/i.test(rowLine)
    const released = !notReleased && /EXPORT\s+RELEASE/i.test(rowLine)

    // Look for a date on the matched line, or the couple of lines around it.
    const nearby = lines.slice(Math.max(0, rowIdx - 1), rowIdx + 3).join(' ')
    const dateStr = nearby.match(DATE_PATTERN)?.[0] || ''
    const releaseDate = parseFlexibleDate(dateStr)

    let passed: boolean | null = null
    let cusdecDateForCompare: Date | null = null
    if (cusdecId) {
      const { data: cusdec } = await supabaseAdmin.from('cusdec').select('date').eq('id', cusdecId).single()
      cusdecDateForCompare = parseFlexibleDate(cusdec?.date || '')
    }
    if (released) {
      passed = !releaseDate || !cusdecDateForCompare ? true : releaseDate > cusdecDateForCompare
    } else if (notReleased) {
      passed = false
    }

    if (cusdecId && passed) {
      const nowIso = new Date().toISOString()
      const { data: cusdec } = await supabaseAdmin.from('cusdec').select('code, number').eq('id', cusdecId).single()
      await supabaseAdmin.from('cusdec').update({ export_release_passed: true, export_release_checked_at: nowIso }).eq('id', cusdecId)
      if (cusdec) {
        // Only containers that already passed Boat Note check get marked —
        // per the rule, Export Release only matters for those.
        await supabaseAdmin.from('cdn').update({ export_release_passed: true, export_release_checked_at: nowIso })
          .eq('code', cusdec.code).eq('cusdec_number', cusdec.number).eq('boat_note_passed', true)
      }
    }

    res.json({ found: true, text, rowLine, released, notReleased, releaseDate: releaseDate?.toISOString() || null, passed })
  } catch (err: any) {
    console.error('[export-release-check] error:', err)
    res.status(500).json({ error: err.message })
  }
}
