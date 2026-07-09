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
// Pass/fail rule (confirmed against a real result page): "Export release"
// actually appears TWICE — once as the CURRENT STATUS summary near the top
// (immediately followed by "Reg Date" — a date with no time, e.g.
// "24-Jun-2026", which is the CUSDEC's registration date, NOT when it was
// released), and again as the last row of the CUSDEC ACTIVITY log, which
// carries the real event timestamp with both date and time (e.g.
// "2026-07-05 01:34 AM"). Only that second one is meaningful, so the date
// pattern below *requires* a time component — the CURRENT STATUS block's
// date-only "Reg Date" simply won't match it, leaving only the activity
// log's real timestamp to be found.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
const BASE = 'https://services.customs.gov.lk'

function toSanitizedText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, '\n').replace(/\n\s*\n+/g, '\n').split('\n').map(l => l.trim()).filter(Boolean).join('\n')
}

// Requires a time-of-day component so a bare "24-Jun-2026" (the Reg Date
// next to the CURRENT STATUS summary) can never match — only a genuine
// activity-log timestamp like "2026-07-05 01:34 AM" or "05/07/2026 1:34 AM" does.
const DATETIME_PATTERN = /\b(\d{4}-\d{1,2}-\d{1,2}[ T]\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?|\d{1,2}[./]\d{1,2}[./]\d{2,4}\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?)\b/i

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
    // "Export release" can appear more than once (CURRENT STATUS summary,
    // then the CUSDEC ACTIVITY log) — only the occurrence followed by a real
    // date+time (not the Reg Date's date-only value) is the actual event.
    let releaseDate: Date | null = null
    let rowLine = ''
    for (let i = 0; i < lines.length; i++) {
      if (!/export\s*release/i.test(lines[i])) continue
      const window = lines.slice(i, i + 2).join(' ')
      const m = window.match(DATETIME_PATTERN)
      if (m) { releaseDate = parseFlexibleDate(m[0]); rowLine = window; break }
    }
    const released = !!releaseDate

    let passed: boolean | null = null
    let cusdecDateForCompare: Date | null = null
    if (cusdecId) {
      const { data: cusdec } = await supabaseAdmin.from('cusdec').select('date').eq('id', cusdecId).single()
      cusdecDateForCompare = parseFlexibleDate(cusdec?.date || '')
    }
    if (!released) {
      passed = false
    } else if (releaseDate && cusdecDateForCompare) {
      passed = releaseDate > cusdecDateForCompare
    }
    // else: "Export release" text found but no comparable date on either
    // side — leave passed as null (ambiguous) rather than guessing, so the
    // raw text is what decides it this time.

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

    res.json({ found: true, text, rowLine, released, releaseDate: releaseDate?.toISOString() || null, passed })
  } catch (err: any) {
    console.error('[export-release-check] error:', err)
    res.status(500).json({ error: err.message })
  }
}
