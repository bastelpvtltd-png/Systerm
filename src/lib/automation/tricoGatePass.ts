// Trico "New Export Gate Pass" — fills and submits the gate pass form
// (?option=gatepass&action=gatepass_exp) for CDNs that have no gate_add_time
// yet (see automation-jobs.ts's eligibility filter). Plain fetch + session
// cookie, same style as tricoGate.ts / tricoCheckRun.ts — no browser needed,
// the form is a normal HTML <form> posted as x-www-form-urlencoded.
import { FieldError } from './errors'
import { TRICO_UA } from '../tricoSession'
import { shipperName } from '../shipperName'
import { cusdecReference } from './data'

const FORM_URL = 'https://s2.tricologi.net/webuser/?option=gatepass&action=gatepass_exp'
const SAVE_URL = 'https://s2.tricologi.net/webuser/?option=gatepass&action=gatepass_exp_save&req_type=raw'
const PREVIEW_URL = 'https://s2.tricologi.net/webuser/?option=gatepass&action=gatepass_exp_preview&req_type=raw'
const TERMINALS = ['CICT', 'CWIT', 'ECT', 'JCT', 'SAGT']
const STEP = 'trico' as const

const NBSP = String.fromCharCode(160)
const clean = (s: unknown) => String(s ?? '').split(NBSP).join(' ').trim().split(' ').filter(Boolean).join(' ')
const digitsOnly = (s: unknown) => clean(s).replace(/\D/g, '')

// "H.P.C.M.K.SIRISENA 871232733V" -> "SIRISENA" (NIC stripped, last name token).
// Matches CDN driver names against Trico's fixed "H.p.c.m.k.sirisena|phone" list,
// which is formatted the same way but may differ in initials/case.
function surnameOf(name: string): string {
  const noNic = clean(name).replace(/\b\d{9}[VvXx]\b|\b\d{12}\b/, '')
  const words = noNic.replace(/\./g, ' ').trim().split(/\s+/).filter(Boolean)
  return (words[words.length - 1] || '').toUpperCase()
}

function mapTerminal(location: string | null | undefined): string {
  const t = clean(location).toUpperCase()
  if (t === 'SLPA') return 'JCT'
  if (TERMINALS.includes(t)) return t
  throw new FieldError('prepare', 'Export Container Terminal', `CDN location "${location || ''}" is not a known Trico terminal (CICT/CWIT/ECT/JCT/SAGT)`)
}

// e-CDN container size ("45G1", "22G1", ...) -> Trico's 20FT/40FT/45FT. First
// digit of the ISO code is the length: 2 = 20ft, 4 = 40/45ft (Trico only cares
// about 20 vs 40 here per how these CDNs are coded).
function mapContainerSize(conType: string | null | undefined): string {
  const t = clean(conType)
  if (t.startsWith('2')) return '20FT'
  if (t.startsWith('4')) return '40FT'
  throw new FieldError('prepare', 'Container Size', `CDN container type "${conType || ''}" does not start with 2 or 4`)
}

const cdnNumberClean = (s: string | null | undefined) => clean(s).replace(/\s+/g, '').toUpperCase()

function todayDDMMYYYY(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`
}

async function get(url: string, cookie: string): Promise<string> {
  const res = await fetch(url, { headers: { 'User-Agent': TRICO_UA, Cookie: cookie }, cache: 'no-store' })
  const text = await res.text()
  if (/name="login_user_id"/.test(text)) throw new FieldError(STEP, 'Login', 'Trico session was not accepted on the Gate Pass form page.')
  return text
}

export interface GatePassForm {
  token: string
  shippers: { id: string; name: string }[]
  wharfClerks: { phone: string; raw: string }[]
  drivers: { label: string; raw: string }[]
}

// Pulls the CSRF token + the three dropdowns (shippers, wharf clerks, drivers)
// straight off the live form — these change over time (shippers/drivers added,
// a fresh token per page load) so nothing here is hardcoded.
export async function fetchGatePassForm(cookie: string): Promise<GatePassForm> {
  const html = await get(FORM_URL, cookie)

  const token = html.match(/<input[^>]*name="token"[^>]*value="([^"]+)"/i)?.[1]
  if (!token) throw new FieldError(STEP, 'Form', 'Could not find the CSRF "token" field on the Gate Pass form — the page layout may have changed.')

  const block = (name: string) => html.match(new RegExp(`<select name="${name}"[\\s\\S]*?<\\/select>`))?.[0] || ''
  const optionRe = /<option value="([^"]*)"\s*(disabled)?[^>]*>([^<]*)<\/option>/g

  const shippers = Array.from(block('shipper_id').matchAll(optionRe))
    .filter(m => m[1] && !m[2])
    .map(m => ({ id: m[1], name: clean(m[3]) }))
  if (!shippers.length) throw new FieldError(STEP, 'Form', 'No active shipper options found on the Gate Pass form.')

  const pairOption = (block_: string) => Array.from(block_.matchAll(/<option value="([^"|]+)\|([^"]+)"[^>]*>([^<]*)<\/option>/g))
  const wharfClerks = pairOption(block('wc_list')).map(m => ({ phone: digitsOnly(m[2]), raw: `${m[1]}|${m[2]}` }))
  const drivers = pairOption(block('driver_list')).map(m => ({ label: clean(m[1]), raw: `${m[1]}|${m[2]}` }))

  return { token, shippers, wharfClerks, drivers }
}

export interface GatePassCdn {
  shipper: string | null; cusdec_number: string | null; code: string | null
  container_no: string | null; con_type: string | null; seal_no: string | null
  trailer_no: string | null; vessel: string | null; voyage: string | null
  location: string | null; cdn_no: string | null; driver_name: string | null
}
export interface GatePassCusdec { date: string | null; hs_code: string | null }

export type GatePassValues = Record<
  'shipper_id' | 'cusdec_number' | 'cont_terminal' | 'vessel_name' | 'voyage_no' | 'entry_date' |
  'wc_list' | 'driver_list' | 'cdn_number' | 'contanier_type' | 'cont_numebr' | 'seal_number' |
  'vechi_numebr' | 'hs_code' | 'weigh_inyard' | 'fumi_inyard' | 'qrntne_inyard',
  string
>

// Resolves every Trico field from CDN/CUSDEC data + the live form's dropdowns.
// Throws a FieldError (step 'prepare') the moment anything can't be mapped —
// nothing gets near Trico until the whole payload is known-good (per the rule:
// a mapping problem is OUR error, shown on our own Automate Errors panel, not
// something half-submitted to Trico).
export function prepareGatePassValues(cdn: GatePassCdn, cusdec: GatePassCusdec | null, form: GatePassForm, wharfNumber: string | null | undefined): GatePassValues {
  const need = (field: string, val: unknown, msg: string) => { const v = clean(val); if (!v) throw new FieldError('prepare', field, msg); return v }

  const shipperDisplay = shipperName(cdn.shipper).toUpperCase()
  const shipper = form.shippers.find(s => s.name.toUpperCase() === shipperDisplay)
    || form.shippers.find(s => shipperDisplay.includes(s.name.toUpperCase()) || s.name.toUpperCase().includes(shipperDisplay))
  if (!shipper) throw new FieldError('prepare', 'Shipper', `No active Trico shipper matches "${shipperName(cdn.shipper)}". Trico shippers: ${form.shippers.map(s => s.name).join(' | ')}`)

  const wharfDigits = digitsOnly(wharfNumber || '')
  if (!wharfDigits) throw new FieldError('prepare', 'Wharf Clerk', 'No Wharf Number set on this shipper\'s Trico login — add it in Settings → Credentials before running Trico Gate Pass')
  const wc = form.wharfClerks.find(w => w.phone === wharfDigits)
  if (!wc) throw new FieldError('prepare', 'Wharf Clerk', `Your Trico Wharf Number (${wharfNumber}) is not one of Trico's Wharf Clerk options`)

  const driverSurname = surnameOf(cdn.driver_name || '')
  if (!driverSurname) throw new FieldError('prepare', 'Driver', 'CDN has no driver name')
  const driverMatches = form.drivers.filter(d => surnameOf(d.label) === driverSurname)
  if (!driverMatches.length) throw new FieldError('prepare', 'Driver', `No Trico driver with surname "${driverSurname}" (from "${cdn.driver_name}")`)
  if (driverMatches.length > 1) throw new FieldError('prepare', 'Driver', `${driverMatches.length} Trico drivers share surname "${driverSurname}" — can't pick one automatically`)

  const cusdecNo = cusdecReference(cdn.code, cdn.cusdec_number, cusdec?.date)
  if (!cusdecNo) throw new FieldError('prepare', 'CUSDEC No.', 'Could not build the CUSDEC reference (missing code / number / date)')

  const hs = clean(cusdec?.hs_code)
  if (!hs) throw new FieldError('prepare', 'HS Code', 'No hs_code on the matching CUSDEC row')

  // "~SL KELANG" - a leading "~" marks an unconfirmed vessel name elsewhere in
  // this app; stripped here since Trico should never receive the literal "~".
  const vessel = need('Vessel Name', cdn.vessel, 'CDN has no vessel').replace(/^~\s*/, '')

  return {
    shipper_id: shipper.id,
    cusdec_number: cusdecNo,
    cont_terminal: mapTerminal(cdn.location),
    vessel_name: vessel,
    voyage_no: need('Voyage No.', cdn.voyage, 'CDN has no voyage'),
    entry_date: todayDDMMYYYY(),
    wc_list: wc.raw,
    driver_list: driverMatches[0].raw,
    cdn_number: cdnNumberClean(need('e-CDN No.', cdn.cdn_no, 'CDN has no cdn_no')),
    contanier_type: mapContainerSize(cdn.con_type),
    cont_numebr: need('Container Number', cdn.container_no, 'CDN has no container number'),
    seal_number: need('Seal Number', cdn.seal_no, 'CDN has no seal number'),
    vechi_numebr: need('Vehicle Number', cdn.trailer_no, 'CDN has no trailer number'),
    hs_code: hs.slice(0, 8),
    weigh_inyard: 'Y', fumi_inyard: 'Y', qrntne_inyard: 'Y',
  }
}

export interface GatePassResult { preview: string }

// Posts the save request Trico's own "Next" button posts (?...gatepass_exp_save).
// Its JS never fires a further "confirm" call after that - the ajax success
// handler just renders ?...gatepass_exp_preview as a read-only receipt - so
// `_save` is the one call that actually creates the Gate Pass.
export async function submitGatePass(cookie: string, token: string, v: GatePassValues): Promise<GatePassResult> {
  const body = new URLSearchParams({ token, ...v })
  const res = await fetch(SAVE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': TRICO_UA, Cookie: cookie, Referer: FORM_URL },
    body: body.toString(),
  })
  const data = await res.json().catch(() => null) as { status?: string; message?: string; error_element?: string } | null
  if (!data) throw new FieldError(STEP, 'Save', `Trico did not return JSON from the save request (HTTP ${res.status})`)
  if (data.status !== '1') throw new FieldError(STEP, data.error_element || 'Save', data.message || 'Trico rejected the Gate Pass (no message given)')

  let preview = ''
  try {
    const r = await fetch(PREVIEW_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': TRICO_UA, Cookie: cookie, Referer: FORM_URL },
      body: body.toString(),
    })
    preview = await r.text()
  } catch { /* cosmetic receipt only - a failure here doesn't undo the save above */ }
  return { preview }
}
