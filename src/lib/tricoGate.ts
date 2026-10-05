// Trico gate lookup (gate add / gate in / gate out per container) + the pure
// matching rules that decide what may be written onto a CDN row.
//
// CALIBRATION: the matching/filling rules below are final. Without TRICO_GATE_LOOKUP_URL
// the lookup auto-discovers the data from the known gate pass page (autoLookup below);
// if that can't read rows it reports what the page contains instead of guessing. The field
// name candidates in mapGateRow() are guesses in the same style as
// trico-yard-sync.ts — the first real run returns a rawSample to correct them.
import { TRICO_UA } from './tricoSession'

// Use {container} where the container number goes, e.g.
//   https://s2.tricologi.net/webuser/?option=gatepass&action=...&cont={container}
const GATE_LOOKUP_URL = process.env.TRICO_GATE_LOOKUP_URL || ''
const GATE_LOOKUP_METHOD = (process.env.TRICO_GATE_LOOKUP_METHOD || 'GET').toUpperCase()   // GET | POST
// For POST: form body template, e.g. "cont_number={container}"
const GATE_LOOKUP_BODY = process.env.TRICO_GATE_LOOKUP_BODY || ''

export interface GateRow { containerNo: string; cusdecNo: string; gateAdd: string; gateIn: string; gateOut: string }
export type GatePatch = { gate_add_time?: string; gate_in_time?: string; gate_out_time?: string }
export interface GateDecision {
  outcome: 'ok' | 'nothing_new' | 'no_container' | 'cusdec_mismatch'
  patch: GatePatch
  note: string
}

const pick = (item: any, keys: string[]): string => {
  for (const k of keys) if (item?.[k] !== undefined && item[k] !== null && String(item[k]).trim() !== '') return String(item[k]).trim()
  return ''
}

// Fallback when none of the exact names above exist: look at the key NAMES
// (table headers become keys, e.g. "Gate In Time" → gate_in_time).
const findKey = (item: any, test: RegExp): string => {
  for (const k of Object.keys(item || {})) {
    if (test.test(k) && item[k] !== null && item[k] !== undefined && String(item[k]).trim() !== '') return String(item[k]).trim()
  }
  return ''
}

export function mapGateRow(item: any): GateRow {
  const r = mapGateRowExact(item)
  return {
    containerNo: r.containerNo || findKey(item, /cont(ainer)?(_?(no|num|number))?$|^cont_/),
    cusdecNo: r.cusdecNo || findKey(item, /cusdec|cus_dec|entry/),
    gateAdd: r.gateAdd || findKey(item, /gate_?add|(^|_)add(ed)?(_|$)/),
    gateIn: r.gateIn || findKey(item, /gate_?in|(^|_)in(_|$)/),
    gateOut: r.gateOut || findKey(item, /gate_?out|(^|_)out(_|$)/),
  }
}

function mapGateRowExact(item: any): GateRow {
  return {
    containerNo: pick(item, ['cont_number', 'container_no', 'container_number', 'container', 'containerno']),
    cusdecNo: pick(item, ['cusdec_no', 'cusdec_number', 'cusdec', 'cusdecno', 'cus_dec', 'entry_no']),
    gateAdd: pick(item, ['gate_add', 'gate_add_time', 'gateadd', 'add_date', 'add_time', 'added_date', 'created_date', 'gatepass_date']),
    gateIn: pick(item, ['gate_in', 'gate_in_time', 'gatein', 'in_time', 'time_in']),
    gateOut: pick(item, ['gate_out', 'gate_out_time', 'gateout', 'out_time', 'time_out']),
  }
}

// Reads the response as JSON (array, or under data/items/rows) and, failing that,
// as the first HTML table (header cells become the keys, lower-cased + underscored).
export function parseGateResponse(text: string): any[] {
  const t = text.trim()
  if (t.startsWith('[') || t.startsWith('{')) {
    try {
      const j = JSON.parse(t)
      return Array.isArray(j) ? j : Array.isArray(j.data) ? j.data : Array.isArray(j.items) ? j.items : Array.isArray(j.rows) ? j.rows : Array.isArray(j.aaData) ? j.aaData : []
    } catch { /* fall through to HTML */ }
  }
  const strip = (s: string) => s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
  const rows = Array.from(t.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)).map(m => Array.from(m[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)).map(c => strip(c[1])))
  if (rows.length < 2) return []
  const header = rows[0].map(h => h.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''))
  return rows.slice(1).filter(r => r.length === header.length).map(r => Object.fromEntries(header.map((h, i) => [h, r[i]])))
}

// The one Trico page we know lists export gate passes (it is the "after login"
// page saved in Settings → Credentials). Used when no explicit lookup URL is set.
const DEFAULT_GATE_PAGE = 'https://s2.tricologi.net/webuser/?option=gatepass&action=gatepass_exp'

const attr = (tag: string, name: string): string => {
  const m = tag.match(new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'))
  return (m?.[1] ?? m?.[2] ?? m?.[3] ?? '').replace(/&amp;/g, '&')
}

interface FormField { name: string; value: string }
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
      fields.push({ name, value: attr(i[0], 'value') })
    }
    for (const sel of m[2].matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/gi)) {
      const name = attr(sel[1], 'name'); if (!name) continue
      const opt = sel[2].match(/<option\b[^>]*selected[^>]*value\s*=\s*["']?([^"'\s>]*)/i) || sel[2].match(/<option\b[^>]*value\s*=\s*["']?([^"'\s>]*)/i)
      fields.push({ name, value: opt?.[1] || '' })
    }
    forms.push({ action: attr(m[1], 'action'), method: (attr(m[1], 'method') || 'GET').toUpperCase(), fields })
  }
  return forms
}

async function get(url: string, cookie: string, ajax = false, init: RequestInit = {}): Promise<string> {
  const res = await fetch(url, {
    ...init,
    headers: { 'User-Agent': TRICO_UA, Cookie: cookie, ...(ajax ? { 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json, text/javascript, */*; q=0.01' } : {}), ...((init.headers as any) || {}) },
    cache: 'no-store',
  })
  const text = await res.text()
  if (/name="login_user_id"/.test(text)) throw new Error('Trico session was not accepted on the gate lookup page (got the login form).')
  return text
}

// Used when TRICO_GATE_LOOKUP_URL is not set. Opens the gate pass page, then tries, in order:
//   1. the page's own table (if the rows are already in the HTML),
//   2. its search form (the field whose name contains "cont" gets the container number),
//   3. any ajax/json endpoint the page's scripts mention (same host).
// If none of those gives a readable table, the error lists exactly what the page contains
// (table headers, form field names, ajax URLs) so the lookup can be pinned down in one step.
const listCache = new Map<string, { t: number; raw: any[] }>()

async function autoLookup(cookie: string, containerNo: string): Promise<any[]> {
  const cacheKey = cookie
  const hit = listCache.get(cacheKey)
  if (hit && Date.now() - hit.t < 30_000) return hit.raw

  const html1 = await get(DEFAULT_GATE_PAGE, cookie)
  let raw = parseGateResponse(html1)
  const forms = extractForms(html1)

  if (!raw.length) {
    const searchForm = forms.find(f => f.fields.some(x => /cont/i.test(x.name)))
    if (searchForm) {
      const params = new URLSearchParams()
      for (const f of searchForm.fields) params.set(f.name, /cont/i.test(f.name) ? containerNo : f.value)
      const target = new URL(searchForm.action || DEFAULT_GATE_PAGE, DEFAULT_GATE_PAGE)
      let html2: string
      if (searchForm.method === 'POST') {
        html2 = await get(target.toString(), cookie, false, { method: 'POST', body: params.toString(), headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: DEFAULT_GATE_PAGE } })
      } else {
        params.forEach((v, k) => target.searchParams.set(k, v))
        html2 = await get(target.toString(), cookie, false, { headers: { Referer: DEFAULT_GATE_PAGE } })
      }
      raw = parseGateResponse(html2)
      if (raw.length) return raw   // search results are per container — don't cache
    }
  }

  const ajaxUrls = Array.from(new Set(Array.from(html1.matchAll(/["'`]([^"'`\s<>]*(?:ajax|json)[^"'`\s<>]*)["'`]/gi)).map(m => m[1])
    .filter(u => /option=|\.php/i.test(u)))).slice(0, 4)

  if (!raw.length) {
    for (const u of ajaxUrls) {
      try {
        const abs = new URL(u.replace(/&amp;/g, '&'), DEFAULT_GATE_PAGE)
        if (abs.host !== new URL(DEFAULT_GATE_PAGE).host) continue
        raw = parseGateResponse(await get(abs.toString(), cookie, true, { headers: { Referer: DEFAULT_GATE_PAGE } }))
        if (raw.length) break
      } catch { /* try the next one */ }
    }
  }

  if (!raw.length) {
    const headers = Array.from(html1.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)).map(m => m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 14)
    const fields = forms.flatMap(f => f.fields.map(x => x.name)).slice(0, 14)
    throw new Error(`Gate page opened but no gate rows could be read. Table headers: [${headers.join(' | ') || 'none'}]; form fields: [${fields.join(', ') || 'none'}]; ajax urls: [${ajaxUrls.join(', ') || 'none'}]`)
  }

  listCache.set(cacheKey, { t: Date.now(), raw })
  return raw
}

export async function fetchGateRows(cookie: string, containerNo: string): Promise<{ rows: GateRow[]; rawSample: any[] }> {
  if (!GATE_LOOKUP_URL) {
    const raw = await autoLookup(cookie, containerNo)
    return { rows: raw.map(mapGateRow), rawSample: raw.slice(0, 2) }
  }
  const enc = encodeURIComponent(containerNo)
  const url = GATE_LOOKUP_URL.replace('{container}', enc)
  const res = await fetch(url, {
    method: GATE_LOOKUP_METHOD,
    headers: {
      'User-Agent': TRICO_UA, Cookie: cookie, 'X-Requested-With': 'XMLHttpRequest',
      ...(GATE_LOOKUP_METHOD === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    body: GATE_LOOKUP_METHOD === 'POST' ? GATE_LOOKUP_BODY.replace('{container}', enc) : undefined,
    cache: 'no-store',
  })
  const text = await res.text()
  if (/name="login_user_id"/.test(text)) throw new Error('Trico session was not accepted on the gate lookup page (got the login form).')
  const raw = parseGateResponse(text)
  return { rows: raw.map(mapGateRow), rawSample: raw.slice(0, 2) }
}

// ── pure rules ────────────────────────────────────────────────────────────
const normContainer = (s: string) => (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
// "E 60147" and "CBEX1 E 60147" both end in the same number — compare that.
const lastNumber = (s: string) => (s || '').match(/\d+/g)?.pop() || ''
const blank = (v: unknown) => v === null || v === undefined || String(v).trim() === ''

export interface CdnGateFields { container_no: string | null; cusdec_number: string | null; gate_add_time?: string | null; gate_in_time?: string | null; gate_out_time?: string | null }

// Rules (as specified):
//  • container must exist in Trico, and its CUSDEC number must match the CDN's —
//    otherwise skip the row.
//  • only fields that are still EMPTY on the CDN get filled; anything already
//    there is left exactly as it is (never re-filled).
//  • if Trico has no new value for the empty fields, nothing is written.
export function decideGatePatch(cdn: CdnGateFields, rows: GateRow[]): GateDecision {
  const sameContainer = rows.filter(r => normContainer(r.containerNo) === normContainer(cdn.container_no || ''))
  if (!sameContainer.length) return { outcome: 'no_container', patch: {}, note: 'Container not found in Trico' }

  const wantNo = lastNumber(cdn.cusdec_number || '')
  const matching = sameContainer.filter(r => wantNo && lastNumber(r.cusdecNo) === wantNo)
  if (!matching.length) return { outcome: 'cusdec_mismatch', patch: {}, note: `Container found but CUSDEC does not match (Trico: ${sameContainer.map(r => r.cusdecNo || '—').join(' / ')})` }

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
