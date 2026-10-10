// Pure data rules for Barcode Enter — no browser, no network, unit-tested
// (data.test.ts). Everything that decides WHAT gets typed into
// Navis / SLPA lives here.
import { normalizeGrossMass } from '../grossMassFormat'
import { FieldError } from './errors'

// Container type written into Navis (these exist in its Con Type list; "40B0"/"20BO" do not).
// 40/45 foot -> 45G1, 20 foot -> 22G1.
export const NAVIS_CON_TYPE_40 = '45G1'
export const NAVIS_CON_TYPE_20 = '22G1'

const clean = (s: string) => String(s ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim()
const norm = (s: string) => clean(s).toUpperCase().replace(/[^A-Z0-9]/g, '')

/** "K.R.S.P.KUMARA 942143400V" -> "942143400V". Old NIC (9 digits + V/X) or new NIC (12 digits). */
export function driverId(driverName: string | null | undefined): string {
  const m = String(driverName || '').match(/\b(\d{9}[VvXx]|\d{12})\b/)
  return m ? m[1].toUpperCase() : ''
}

/** "45G1" / "40G1" -> "45G1"; "20G1" -> "22G1"; anything else -> "". */
export function navisConType(conType: string | null | undefined): string {
  const t = clean(conType || '').toUpperCase()
  if (/^(40|45)/.test(t)) return NAVIS_CON_TYPE_40
  if (/^20/.test(t)) return NAVIS_CON_TYPE_20
  return ''
}

// Same segment rules as normalizeGrossMass but WITHOUT its "strip digits until <= 35,000"
// correction. That correction is fine for a human-reviewed sheet, but for a live Navis
// submission a silently altered weight is worse than no submission.
function uncorrectedNumeric(raw: string): number {
  const segs = String(raw ?? '').replace(/[^\d.,\s]/g, '').split(/[.,\s]+/).filter(Boolean)
  if (!segs.length) return 0
  const last = segs[segs.length - 1]
  const [int, dec] = segs.length > 1 && last.length === 2 ? [segs.slice(0, -1).join(''), last] : [segs.join(''), '00']
  return parseFloat(`${int}.${dec}`)
}

/** Gross mass as plain kg digits for Navis ("23.580.00" -> "23580"). "" when unusable or when the
 *  value would have had to be "corrected" — it never guesses. */
export function navisGrossMass(raw: string | null | undefined): string {
  const r = normalizeGrossMass(raw)
  if (!r.ok || !r.numeric) return ''
  if (uncorrectedNumeric(String(raw)) !== r.numeric) return ''
  return String(r.numeric)
}

function yearFromDate(raw: string | null | undefined): string {
  const s = clean(raw || '')
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (m) return m[1]
  m = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{2,4})/)
  if (m) { const y = Number(m[3]); return String(y < 100 ? 2000 + y : y) }
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? '' : String(d.getFullYear())
}

/** CBEX1 + "E 61746" + 29/09/2026 -> "CBEX1E617462026" */
export function cusdecReference(code: string | null | undefined, number: string | null | undefined, date: string | null | undefined): string {
  const c = clean(code || '').replace(/\s+/g, ''), n = clean(number || '').replace(/\s+/g, ''), y = yearFromDate(date)
  return c && n && y ? `${c}${n}${y}`.toUpperCase() : ''
}

// ── option pickers (return the index to click, or an error string) ──────────
export type Pick = number | string

/** Option text is "CODE (Description)" — pick the one whose code is exactly `code`. */
export function pickByCode(options: string[], code: string, mustContain?: string): Pick {
  const c = code.toUpperCase()
  const i = options.findIndex(o => {
    const t = clean(o).toUpperCase()
    const codeOk = t === c || t.startsWith(c + ' ') || t.startsWith(c + '(')
    return codeOk && (!mustContain || t.includes(mustContain.toUpperCase()))
  })
  return i >= 0 ? i : `No option for "${code}"${mustContain ? ` (${mustContain})` : ''}. Options shown: ${options.map(clean).slice(0, 8).join(' | ') || 'none'}`
}

/**
 * For a fixed-value field with only ever one real choice (e.g. Navis's "Trucking Company", which
 * is always the agency's own "PRVT" entry) — pickByCode's strict CODE-must-be-a-prefix rule breaks
 * if the portal ever shows that code elsewhere in the label (e.g. as a trailing "(PRVT)" instead
 * of a leading "PRVT ("). Any option containing the text anywhere is unambiguous here, so just
 * take it.
 */
export function pickContaining(options: string[], text: string): Pick {
  const t = text.toUpperCase()
  const i = options.findIndex(o => clean(o).toUpperCase().includes(t))
  return i >= 0 ? i : `No option containing "${text}". Options shown: ${options.map(clean).slice(0, 8).join(' | ') || 'none'}`
}

/** "1XM640EW (MARGRETHE MAERSK,640E,SLPA)" -> { code, name, voyage } */
export function parseVesselOption(text: string): { code: string; name: string; voyage: string } | null {
  const t = clean(text)
  const m = t.match(/\(([^)]*)\)\s*$/)
  if (!m || m.index === undefined) return null
  const parts = m[1].split(',').map(clean)
  return { code: clean(t.slice(0, m.index)), name: parts[0] || '', voyage: parts[1] || '' }
}

/**
 * Voyage MUST match exactly (ignoring case/punctuation). The vessel name only has to
 * agree loosely — any word of the CDN vessel name matching a word of the Navis name
 * (or a prefix of at least 3 letters) is enough. No voyage match -> error (the CDN is skipped).
 */
export function pickVesselOption(options: string[], vessel: string | null | undefined, voyage: string | null | undefined): Pick {
  const wantVoyage = norm(voyage || '')
  if (!wantVoyage) return 'CDN has no voyage number'
  const parsed = options.map((o, i) => ({ i, p: parseVesselOption(o) })).filter(x => x.p)
  // The ",VOYAGE,YARD" fields in parens aren't always there — some options are just "CODE (NAME)"
  // with no comma at all, and then the voyage only shows up embedded in CODE itself (confirmed from
  // a real option, "ZEY26076NS (ZHONG PENG YOU YI)" for CDN voyage "26076N" — Navis's own code adds
  // a leg-letter suffix). Exact match on the parsed voyage field when there is one; when that field
  // is blank, fall back to the voyage appearing in the code instead of rejecting a real match.
  const sameVoyage = parsed.filter(x => {
    const v = norm(x.p!.voyage)
    return v ? v === wantVoyage : norm(x.p!.code).includes(wantVoyage)
  })
  if (!sameVoyage.length) return `No vessel with voyage "${clean(voyage || '')}" in Navis. Options shown: ${options.map(clean).slice(0, 8).join(' | ') || 'none'}`

  const words = (s: string) => clean(s).toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').split(' ').filter(w => w.length >= 3)
  const want = words(vessel || '')
  if (!want.length) return sameVoyage[0].i
  const score = (name: string) => {
    const have = words(name)
    return want.filter(w => have.some(h => h === w || h.startsWith(w) || w.startsWith(h))).length
  }
  const ranked = sameVoyage.map(x => ({ i: x.i, s: score(x.p!.name) })).sort((a, b) => b.s - a.s)
  if (ranked[0].s === 0) return `Voyage "${clean(voyage || '')}" found but vessel name differs (CDN: "${clean(vessel || '')}", Navis: "${sameVoyage.map(x => x.p!.name).join(' / ')}")`
  return ranked[0].i
}

/** Port option "AEJEA (Jebel Ali)": pick the one whose text contains the CDN's port name. */
export function pickPortOption(options: string[], portName: string | null | undefined): Pick {
  const want = norm(portName || '')
  if (!want) return 'CDN has no port name'
  const inParens = (o: string) => norm(clean(o).match(/\(([^)]*)\)/)?.[1] || '')
  const exact = options.findIndex(o => inParens(o) === want)
  if (exact >= 0) return exact
  const partial = options.findIndex(o => norm(o).includes(want))
  return partial >= 0 ? partial : `Port "${clean(portName || '')}" not found in Navis. Options shown: ${options.map(clean).slice(0, 8).join(' | ') || 'none'}`
}

// ── per-job value sets ───────────────────────────────────────────────────────
export interface NavisValues {
  containerNo: string; conType: string; grossMass: string; coc: string; voc: string
  vessel: string; voyage: string; dischargePort: string; cusdecRef: string
}
export interface SlpaValues { cusdecRef: string; containerNo: string; driverId: string; truckNo: string; trailerNo: string; sealNo: string }

const need = (field: string, value: string, why: string) => { if (!value) throw new FieldError('prepare', field, why) }

export function prepareValues(cdn: Record<string, any>, cusdec: { code?: string; number?: string; date?: string } | null, cusdecOverride?: string | null): { navis: NavisValues; slpa: SlpaValues } {
  const containerNo = clean(cdn.container_no || '').replace(/\s+/g, '').toUpperCase()
  need('Container No', containerNo, 'CDN has no container number')

  const conType = navisConType(cdn.con_type)
  need('Con Type', conType, `Container type "${cdn.con_type || ''}" is not 20/40/45`)

  const grossMass = navisGrossMass(cdn.gross_mass)
  need('Gross Mass', grossMass, `Gross mass "${cdn.gross_mass || ''}" is empty or could not be read safely`)

  const coc = clean(cdn.coc || '').toUpperCase()
  need('COC', coc, 'CDN has no COC')
  const voc = clean(cdn.voc || '').toUpperCase()
  need('VOC', voc, 'CDN has no VOC')

  const voyage = clean(cdn.voyage || '')
  need('Voyage', voyage, 'CDN has no voyage')
  const dischargePort = clean(cdn.discharge_port || '')
  need('Discharge Port', dischargePort, 'CDN has no discharge port')

  // A manual override (set via "fix CUSDEC & retry" after SLPA rejected what was typed into Navis
  // the first time) is a one-off correction for this run only — it is never written back to the
  // CDN's own cusdec_number, so it always takes priority over the computed reference here.
  const ref = clean(cusdecOverride || '') || cusdecReference(cusdec?.code || cdn.code, cusdec?.number || cdn.cusdec_number, cusdec?.date)
  need('CUSDEC Reference', ref, 'Could not build CUSDEC reference (CUSDEC code/number/date missing)')

  const id = driverId(cdn.driver_name)
  need('Driver ID', id, `No NIC found in driver name "${cdn.driver_name || ''}"`)
  const truckNo = clean(cdn.lorry_no || ''); need('Truck No', truckNo, 'CDN has no lorry number')
  const trailerNo = clean(cdn.trailer_no || ''); need('Trailer No', trailerNo, 'CDN has no trailer number')
  const sealNo = clean(cdn.seal_no || ''); need('Seal No', sealNo, 'CDN has no seal number')

  return {
    navis: { containerNo, conType, grossMass, coc, voc, vessel: clean(cdn.vessel || ''), voyage, dischargePort, cusdecRef: ref },
    slpa: { cusdecRef: ref, containerNo, driverId: id, truckNo, trailerNo, sealNo },
  }
}