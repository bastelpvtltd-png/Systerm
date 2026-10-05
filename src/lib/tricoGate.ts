// Trico gate lookup (gate add / gate in / gate out per container) + the pure
// matching rules that decide what may be written onto a CDN row.
//
// How the lookup works (Trico → Gate Pass → Gate Pass List):
//   1. open  ?option=gatepass&action=list  and search the container number
//   2. every list row whose container matches → open its "View" page
//      (?option=gatepass&action=gatepass_view&gatepass_number=GP…)
//   3. the View page's  <div class="field-value">CBEX12026E58889</div>  holds the CUSDEC.
//      The part after the year (E58889) is what must equal the CDN's CUSDEC ("E 58889").
//   4. gate times come from the same pages (see GATE_LABELS / list columns below).
import { TRICO_UA } from './tricoSession'

const LIST_URL = 'https://s2.tricologi.net/webuser/?option=gatepass&action=list'

export interface GateRow { containerNo: string; cusdecNo: string; gateAdd: string; gateIn: string; gateOut: string }
export type GatePatch = { gate_add_time?: string; gate_in_time?: string; gate_out_time?: string }
export interface GateDecision {
  outcome: 'ok' | 'nothing_new' | 'no_container' | 'cusdec_mismatch'
  patch: GatePatch
  note: string
}

// ── small HTML helpers ────────────────────────────────────────────────────
const strip = (s: string) => s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()

const attr = (tag: string, name: string): string => {
  const m = tag.match(new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'))
  return (m?.[1] ?? m?.[2] ?? m?.[3] ?? '').replace(/&amp;/g, '&')
}

interface FormField { name: string; value: string; placeholder: string }
interface FoundForm { action: string; method: string; fields: FormField[] }

function extractForms(html: string): FoundForm[] {
  const forms: FoundForm[] = []
  for (const m of html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)) {
    const fields: FormField[] = []
    for (const i of m[2].matchAll(/<input\b[^>]*>/gi)) {
      const type = (attr(i[0], 'type') || 'text').toLowerCase()
      const name = attr(i[0], 'name')
      if (!name || ['submit', 'button', 'image', 'file', 'reset'].includes(type)) continue
      if ((type === 'checkbox' || type === 'radio') && !/\bchecked\b/i.test(i[0])) continue
      fields.push({ name, value: attr(i[0], 'value'), placeholder: attr(i[0], 'placeholder') })
    }
    forms.push({ action: attr(m[1], 'action'), method: (attr(m[1], 'method') || 'GET').toUpperCase(), fields })
  }
  return forms
}

async function get(url: string, cookie: string, init: RequestInit = {}): Promise<string> {
  const res = await fetch(url, {
    ...init,
    headers: { 'User-Agent': TRICO_UA, Cookie: cookie, ...((init.headers as any) || {}) },
    cache: 'no-store',
  })
  const text = await res.text()
  if (/name="login_user_id"/.test(text)) throw new Error('Trico session was not accepted on the gate pass page (got the login form).')
  return text
}

// ── list page ─────────────────────────────────────────────────────────────
export interface ListRow { date: string; gatepass: string; container: string; arrival: string; exit: string; viewUrl: string }

// Reads the Gate Pass List table (header names decide the columns).
export function parseGateList(html: string): ListRow[] {
  const out: ListRow[] = []
  for (const t of html.matchAll(/<table\b[\s\S]*?<\/table>/gi)) {
    const heads = Array.from(t[0].matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)).map(m => strip(m[1]).toLowerCase())
    const ci = heads.findIndex(h => h.includes('container'))
    if (ci === -1) continue
    const idx = (re: RegExp, fallback: number) => { const i = heads.findIndex(h => re.test(h)); return i === -1 ? fallback : i }
    const di = idx(/^date/, 0), gi = idx(/gatepass/, 1), ai = idx(/arrival/, 5), ei = idx(/exit/, 6)
    for (const r of t[0].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cells = Array.from(r[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)).map(m => m[1])
      if (cells.length <= ci) continue
      const gp = r[1].match(/gatepass_number=([A-Za-z0-9_-]+)/)?.[1] || strip(cells[gi] || '')
      const container = strip(cells[ci]).split('/')[0].trim()      // "GCXU5265936 / 40FT" → "GCXU5265936"
      if (!container) continue
      out.push({
        date: strip(cells[di] || ''), gatepass: gp, container,
        arrival: strip(cells[ai] || '').replace(/^-$/, ''), exit: strip(cells[ei] || '').replace(/^-$/, ''),
        viewUrl: gp ? new URL(`?option=gatepass&action=gatepass_view&gatepass_number=${encodeURIComponent(gp)}`, LIST_URL).toString() : '',
      })
    }
    if (out.length) break
  }
  return out
}

// ── view page ─────────────────────────────────────────────────────────────
// Pairs every <div class="field-value"> with the closest field-label before it.
export function parseGateView(html: string): Record<string, string> {
  const fields: Record<string, string> = {}
  let label = ''
  for (const m of html.matchAll(/<div\b[^>]*class\s*=\s*["'][^"']*\bfield-(label|value)\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi)) {
    const text = strip(m[2])
    if (m[1].toLowerCase() === 'label') label = text.toLowerCase()
    else { fields[label || `value_${Object.keys(fields).length}`] = text; label = '' }
  }
  return fields
}

// CUSDEC on the View page looks like CBEX12026E58889 (office + year + E + number).
const CUSDEC_SHAPE = /^[A-Z0-9]{2,10}20\d{2}[A-Z]\s?\d+$/i
function cusdecFromView(f: Record<string, string>): string {
  for (const [k, v] of Object.entries(f)) if (/cusdec/.test(k) && v) return v
  for (const v of Object.values(f)) if (CUSDEC_SHAPE.test(v.replace(/\s/g, ''))) return v.replace(/\s/g, '')
  return ''
}
const labelled = (f: Record<string, string>, re: RegExp) => Object.entries(f).find(([k, v]) => re.test(k) && v && v !== '-')?.[1] || ''

const sameContainer = (a: string, b: string) => normContainer(a) === normContainer(b)

export async function fetchGateRows(cookie: string, containerNo: string): Promise<{ rows: GateRow[]; rawSample: any[] }> {
  const html1 = await get(LIST_URL, cookie)
  const defaultRows = parseGateList(html1)
  if (!defaultRows.length && !/<table/i.test(html1)) {
    throw new Error('Trico Gate Pass List page did not contain a table — the page layout may have changed.')
  }

  // Search the container. Prefer the page's own search form (the box whose placeholder
  // mentions gatepass / container); otherwise try the usual parameter names.
  const forms = extractForms(html1)
  const form = forms.find(f => f.fields.some(x => /container|gatepass/i.test(x.placeholder)))
  const attempts: { method: string; target: URL; params: URLSearchParams }[] = []
  if (form) {
    const box = form.fields.find(x => /container|gatepass/i.test(x.placeholder))!
    const params = new URLSearchParams()
    for (const f of form.fields) params.set(f.name, f.name === box.name ? containerNo : f.value)
    attempts.push({ method: form.method, target: new URL(form.action || LIST_URL, LIST_URL), params })
  } else {
    for (const name of ['search', 'q', 'keyword', 'term', 'gatepass_search']) {
      const params = new URLSearchParams(); params.set('option', 'gatepass'); params.set('action', 'list'); params.set(name, containerNo)
      attempts.push({ method: 'GET', target: new URL(LIST_URL), params })
    }
  }

  let rows: ListRow[] = []
  let searchWorked = !!form
  for (const a of attempts) {
    let html: string
    if (a.method === 'POST') {
      html = await get(a.target.toString(), cookie, { method: 'POST', body: a.params.toString(), headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: LIST_URL } })
    } else {
      const u = new URL(a.target.toString()); a.params.forEach((v, k) => u.searchParams.set(k, v))
      html = await get(u.toString(), cookie, { headers: { Referer: LIST_URL } })
    }
    const r = parseGateList(html)
    if (r.some(x => sameContainer(x.container, containerNo))) { rows = r; searchWorked = true; break }
    if (form) { rows = r; break }
  }

  // Search box not found and nothing changed → say so instead of reporting "not found".
  if (!rows.length && !searchWorked) {
    const inputs = Array.from(html1.matchAll(/<input\b[^>]*>/gi)).map(m => `${attr(m[0], 'name') || '?'}${attr(m[0], 'placeholder') ? ` ("${attr(m[0], 'placeholder')}")` : ''}`).slice(0, 12)
    if (!defaultRows.some(x => sameContainer(x.container, containerNo))) {
      throw new Error(`Could not use the search box on the Trico Gate Pass List. Inputs on the page: [${inputs.join(', ') || 'none'}]`)
    }
    rows = defaultRows
  }

  // Every matching gate pass (a container can have several) → open its View page.
  const matches = rows.filter(x => sameContainer(x.container, containerNo)).slice(0, 4)
  const out: GateRow[] = []
  const rawSample: any[] = []
  for (const m of matches) {
    const view = m.viewUrl ? parseGateView(await get(m.viewUrl, cookie, { headers: { Referer: LIST_URL } })) : {}
    if (rawSample.length < 2) rawSample.push({ gatepass: m.gatepass, container: m.container, ...view })
    out.push({
      containerNo: m.container,
      cusdecNo: cusdecFromView(view),
      gateAdd: labelled(view, /gate\s*add|created|issued/) || m.date,
      gateIn: labelled(view, /gate\s*in/) || m.arrival,
      gateOut: labelled(view, /gate\s*out/) || m.exit,
    })
  }
  return { rows: out, rawSample }
}

// ── pure rules ────────────────────────────────────────────────────────────
const normContainer = (s: string) => (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
// "E 58889" (CDN) and "CBEX12026E58889" (Trico) both end in letter + number → "E58889".
export function cusdecKey(s: string): string {
  const t = (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  const m = t.match(/([A-Z])0*(\d+)$/)
  return m ? `${m[1]}${m[2]}` : (t.match(/\d+$/)?.[0].replace(/^0+/, '') || '')
}
// If one side has no letter, fall back to comparing just the numbers.
const sameCusdec = (a: string, b: string) => {
  const ka = cusdecKey(a), kb = cusdecKey(b)
  if (!ka || !kb) return false
  const na = ka.replace(/^[A-Z]/, ''), nb = kb.replace(/^[A-Z]/, '')
  return /^[A-Z]/.test(ka) && /^[A-Z]/.test(kb) ? ka === kb : na === nb
}
const blank = (v: unknown) => v === null || v === undefined || String(v).trim() === ''

export interface CdnGateFields { container_no: string | null; cusdec_number: string | null; gate_add_time?: string | null; gate_in_time?: string | null; gate_out_time?: string | null }

// Rules (as specified):
//  • container must exist in Trico, and its CUSDEC number must match the CDN's —
//    otherwise skip the row.
//  • only fields that are still EMPTY on the CDN get filled; anything already
//    there is left exactly as it is (never re-filled).
//  • if Trico has no new value for the empty fields, nothing is written.
export function decideGatePatch(cdn: CdnGateFields, rows: GateRow[]): GateDecision {
  const sameContainerRows = rows.filter(r => normContainer(r.containerNo) === normContainer(cdn.container_no || ''))
  if (!sameContainerRows.length) return { outcome: 'no_container', patch: {}, note: 'Container not found in Trico' }

  const matching = sameContainerRows.filter(r => sameCusdec(r.cusdecNo, cdn.cusdec_number || ''))
  if (!matching.length) return { outcome: 'cusdec_mismatch', patch: {}, note: `Container found but CUSDEC does not match (Trico: ${sameContainerRows.map(r => r.cusdecNo || '—').join(' / ')})` }

  // Several matching rows (re-added gate pass): prefer the one with the most gate fields filled.
  const score = (r: GateRow) => [r.gateAdd, r.gateIn, r.gateOut].filter(Boolean).length
  const best = [...matching].sort((a, b) => score(b) - score(a))[0]

  const patch: GatePatch = {}
  if (blank(cdn.gate_add_time) && best.gateAdd) patch.gate_add_time = best.gateAdd
  if (blank(cdn.gate_in_time) && best.gateIn) patch.gate_in_time = best.gateIn
  if (blank(cdn.gate_out_time) && best.gateOut) patch.gate_out_time = best.gateOut

  const filled = Object.keys(patch).map(k => k.replace('gate_', '').replace('_time', ''))
  return Object.keys(patch).length
    ? { outcome: 'ok', patch, note: `Filled: ${filled.join(', ')}` }
    : { outcome: 'nothing_new', patch: {}, note: 'Matched, nothing new on Trico yet' }
}
