import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
const SOURCE_URL = 'https://s2.tricologi.net/webuser/?option=etc&action=vessel_opening'

export interface VesselRow {
  terminal: string
  vessel: string
  voyage: string
  opening_time: string
  closing_time: string
  etb: string
  last_update: string
}

// The page is a plain public table (no login) — one <tr> per vessel, six
// flat <td> cells in a fixed order (Terminal, Vessel/Voyage, Opening,
// Closing, ETB, Last Updated), no nested tags. A row-by-row regex is enough
// here — same style as the other tricologi/customs scrapers in this app —
// rather than pulling in a full HTML parser for one page shape.
export function parseVesselRows(html: string): VesselRow[] {
  const rows: VesselRow[] = []
  const trMatches = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) || []
  for (const tr of trMatches) {
    const cells = Array.from(tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)).map(m => m[1].replace(/<[^>]+>/g, '').trim())
    if (cells.length < 6) continue
    const [terminal, vesselVoyage, opening_time, closing_time, etb, last_update] = cells
    if (!vesselVoyage) continue
    const slashIdx = vesselVoyage.lastIndexOf('/')
    const vessel = (slashIdx > -1 ? vesselVoyage.slice(0, slashIdx) : vesselVoyage).trim()
    const voyage = (slashIdx > -1 ? vesselVoyage.slice(slashIdx + 1) : '').trim()
    if (!vessel || !voyage) continue
    rows.push({ terminal, vessel, voyage, opening_time, closing_time, etb, last_update })
  }
  return rows
}

export interface VesselSyncResult { fetched: number; inserted: number; updated: number; unchanged: number }

// Vessel Trigger's "Intelligent Sync" — primary-key match on (vessel,
// voyage), and only actually writes a row when something about it changed
// (Last Update timestamp, or the ETB/Terminal/Opening/Closing values
// themselves) rather than upserting every row on every run regardless.
export async function syncVesselTriggers(): Promise<VesselSyncResult> {
  const resp = await fetch(SOURCE_URL, { headers: { 'User-Agent': UA } })
  const html = await resp.text()
  const rows = parseVesselRows(html)

  const { data: existingRows } = await supabaseAdmin.from('vessel_triggers').select('*')
  const existingByKey = new Map((existingRows || []).map(r => [`${r.vessel}|||${r.voyage}`, r]))

  let inserted = 0, updated = 0, unchanged = 0
  for (const row of rows) {
    const key = `${row.vessel}|||${row.voyage}`
    const existing = existingByKey.get(key)
    if (!existing) {
      const { error } = await supabaseAdmin.from('vessel_triggers').insert({ ...row, updated_at: new Date().toISOString() })
      if (!error) inserted++
      continue
    }
    const changed = existing.last_update !== row.last_update ||
      existing.etb !== row.etb || existing.terminal !== row.terminal ||
      existing.opening_time !== row.opening_time || existing.closing_time !== row.closing_time
    if (changed) {
      const { error } = await supabaseAdmin.from('vessel_triggers')
        .update({ ...row, updated_at: new Date().toISOString() })
        .eq('vessel', row.vessel).eq('voyage', row.voyage)
      if (!error) updated++
    } else {
      unchanged++
    }
  }

  return { fetched: rows.length, inserted, updated, unchanged }
}
