import { createClient } from '@supabase/supabase-js'
import { parseFlexibleDate } from '@/lib/flexibleDate'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

// Pulled out of boat-note-check.ts / export-release-check.ts so the same
// scraping + pass/fail logic can be driven either by a button click (those
// two API routes) or by the scheduled cron route (cron-check-pending.ts) —
// one implementation, two triggers.

export interface BoatNoteCheckResult { containerNo: string; vessel: string; level: string; status: string; passed: boolean }

export async function checkBoatNote(containerNo: string, cdnId?: string): Promise<BoatNoteCheckResult> {
  const container = containerNo.trim().toUpperCase()
  const url = `https://s2.tricologi.net/webuser/?option=etc&action=boatnote_check_view&req_type=raw&rnd=${Math.random()}`
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
    body: `cont_numebr=${encodeURIComponent(container)}`,
  })
  const html = await resp.text()

  const vessel = html.match(/Vessel\s*\/\s*Voyage:<\/span>\s*<span>([^<]*)<\/span>/i)?.[1]?.trim() || ''
  const statusMatch = html.match(/class="alert alert-(success|warning|danger)"[^>]*>([^<]*)</i)
  const statusText = statusMatch?.[2]?.trim() || html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300)
  const level = statusMatch?.[1] || 'unknown'
  const passed = level === 'success'

  if (cdnId && passed) {
    await supabaseAdmin.from('cdn').update({ boat_note_passed: true, boat_note_checked_at: new Date().toISOString() }).eq('id', cdnId)
  }

  return { containerNo: container, vessel, level, status: statusText, passed }
}

function toSanitizedText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, '\n').replace(/\n\s*\n+/g, '\n').split('\n').map(l => l.trim()).filter(Boolean).join('\n')
}

const DATETIME_PATTERN = /\b(\d{4}-\d{1,2}-\d{1,2}[ T]\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?|\d{1,2}[./]\d{1,2}[./]\d{2,4}\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?)\b/i
const BASE = 'https://services.customs.gov.lk'

export interface ExportReleaseParams { officeCode: string; serial: string; cusdecNumber: string; cusdecYear: string; consigneeTIN: string; cusdecId?: string }
export interface ExportReleaseResult { found: boolean; message?: string; text?: string; rowLine?: string; released?: boolean; releaseDate?: string | null; passed?: boolean | null }

export async function checkExportRelease(params: ExportReleaseParams): Promise<ExportReleaseResult> {
  const { officeCode, serial, cusdecNumber, cusdecYear, consigneeTIN, cusdecId } = params

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
    return { found: false, message: 'No matching CUSDEC found for that Office Code / Serial / Number / Year / Company TIN combination.' }
  }

  const text = toSanitizedText(dashHtml)
  const lines = text.split('\n')
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

  if (cusdecId && passed) {
    const nowIso = new Date().toISOString()
    const { data: cusdec } = await supabaseAdmin.from('cusdec').select('code, number').eq('id', cusdecId).single()
    await supabaseAdmin.from('cusdec').update({ export_release_passed: true, export_release_checked_at: nowIso }).eq('id', cusdecId)
    if (cusdec) {
      // All CDNs belonging to this CUSDEC turn green — no boat_note_passed filter,
      // since the CUSDEC's release covers the whole shipment regardless of which
      // containers individually passed the boat note check.
      await supabaseAdmin.from('cdn').update({ export_release_passed: true, export_release_checked_at: nowIso })
        .eq('code', cusdec.code).eq('cusdec_number', cusdec.number)
    }
  }

  return { found: true, text, rowLine, released, releaseDate: releaseDate?.toISOString() || null, passed }
}

export function cleanCusdecNumber(raw: string): string { return (raw || '').replace(/\D/g, '') }

// A CUSDEC only counts as "Boat Note passed" once every CDN row belonging
// to it (matched by code+number) is itself boat_note_passed, and the CDN
// count matches its CAP — the same rule ExportReleaseCheckPanel uses
// client-side, needed here too since the cron has no UI to filter in.
export function isBoatNotePassed(cusdec: { code: string; number: string; cap?: string }, cdns: { code: string; cusdec_number: string; boat_note_passed?: boolean }[]): boolean {
  const own = cdns.filter(d => d.code === cusdec.code && d.cusdec_number === cusdec.number)
  if (!own.length) return false
  const cap = parseInt(cusdec.cap || '', 10)
  if (cap && own.length < cap) return false
  return own.every(d => d.boat_note_passed)
}

export async function resolveTin(cusdec: { tin_vat?: string; exporter?: string }): Promise<string> {
  if (cusdec.tin_vat) return cusdec.tin_vat
  const shipperName = (cusdec.exporter || '').split('\n')[0].trim()
  if (!shipperName) return ''
  const { data } = await supabaseAdmin.from('shipper_profiles').select('tin').eq('shipper', shipperName).maybeSingle()
  return data?.tin || ''
}
