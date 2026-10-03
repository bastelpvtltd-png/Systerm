// Trico gate lookup (gate add / gate in / gate out per container) + the pure
// matching rules that decide what may be written onto a CDN row.
//
// CALIBRATION NEEDED: the matching/filling rules below are final, but I have not
// seen the real Trico page/XHR that lists gate add/in/out per container. Until
// TRICO_GATE_LOOKUP_URL is set (env var, or edit GATE_LOOKUP_URL here), the
// lookup throws a clear "not configured" error instead of guessing. The field
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

export function mapGateRow(item: any): GateRow {
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
      return Array.isArray(j) ? j : Array.isArray(j.data) ? j.data : Array.isArray(j.items) ? j.items : Array.isArray(j.rows) ? j.rows : []
    } catch { /* fall through to HTML */ }
  }
  const strip = (s: string) => s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
  const rows = Array.from(t.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)).map(m => Array.from(m[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)).map(c => strip(c[1])))
  if (rows.length < 2) return []
  const header = rows[0].map(h => h.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''))
  return rows.slice(1).filter(r => r.length === header.length).map(r => Object.fromEntries(header.map((h, i) => [h, r[i]])))
}

export async function fetchGateRows(cookie: string, containerNo: string): Promise<{ rows: GateRow[]; rawSample: any[] }> {
  if (!GATE_LOOKUP_URL) {
    throw new Error('Trico gate lookup is not configured yet — set TRICO_GATE_LOOKUP_URL (see lib/tricoGate.ts) once the Trico page that lists gate add / in / out is known.')
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
