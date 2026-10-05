import { createClient } from '@supabase/supabase-js'
import { resolvePortalLogins } from '@/lib/portalCredentials'
import { shipperKey } from '@/lib/shipperName'
import { tricoLoginWith } from '@/lib/tricoSession'
import { fetchGateRows, decideGatePatch, type GateDecision } from '@/lib/tricoGate'

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

export interface TricoCheckSummary {
  checked: number
  updated: number
  results: { cdnId: string; containerNo: string; outcome: GateDecision['outcome'] | 'skipped' | 'error'; note: string }[]
  rawSample?: any[]
  remaining: number
}

const blank = (v: unknown) => v === null || v === undefined || String(v).trim() === ''

// CDN rows Trico Checking still has work for: have a container number and at
// least one of gate add / gate in / gate out empty. Rows that already have all
// three are never touched again.
export function needsGateCheck(c: any): boolean {
  return !blank(c.container_no) && (blank(c.gate_add_time) || blank(c.gate_in_time) || blank(c.gate_out_time))
}

// Checks up to `limit` pending CDN rows (oldest-checked first) against Trico,
// logging in once per distinct Trico credential. Safe to call repeatedly: the
// per-row rules live in decideGatePatch (match container + CUSDEC, fill only empty).
export async function runTricoCheck(opts: { cdnIds?: string[]; limit?: number; maxMs?: number; before?: string } = {}): Promise<TricoCheckSummary> {
  const limit = Math.max(1, Math.min(opts.limit ?? 5, 50))
  const deadline = Date.now() + (opts.maxMs ?? 40_000)

  let q = sb.from('cdn')
    .select('id, container_no, cusdec_number, shipper, gate_add_time, gate_in_time, gate_out_time, trico_checked_at')
    .order('trico_checked_at', { ascending: true, nullsFirst: true })
    .limit(2000)
  if (opts.cdnIds?.length) q = q.in('id', opts.cdnIds)
  const { data, error } = await q
  if (error) throw new Error(`${error.message} (did you run the SQL migration that adds the gate_* columns?)`)

  // `before` = when this whole sweep started. Rows already checked during the
  // sweep (even ones that stay pending, e.g. "nothing new on Trico yet") are not
  // picked again, so a sweep always finishes instead of looping on the same rows.
  const pending = (data || []).filter(needsGateCheck)
    .filter(c => !opts.before || !c.trico_checked_at || new Date(c.trico_checked_at).getTime() < new Date(opts.before).getTime())
  const batch = pending.slice(0, limit)
  const summary: TricoCheckSummary = { checked: 0, updated: 0, results: [], remaining: Math.max(0, pending.length - batch.length) }

  const cookieByShipper = new Map<string, string | Error>()
  const loginFor = async (shipperRaw: string): Promise<string> => {
    const key = shipperKey(shipperRaw)
    if (!cookieByShipper.has(key)) {
      try {
        const logins = await resolvePortalLogins(shipperRaw, ['trico'])
        if (!logins.trico) throw new Error('No Trico login mapped for this shipper (Barcode Enter → Shipper logins)')
        cookieByShipper.set(key, await tricoLoginWith(logins.trico.username, logins.trico.password))
      } catch (e: any) { cookieByShipper.set(key, e instanceof Error ? e : new Error(String(e))) }
    }
    const v = cookieByShipper.get(key)!
    if (v instanceof Error) throw v
    return v
  }

  for (const cdn of batch) {
    if (Date.now() > deadline) { summary.remaining += batch.length - summary.results.length; break }
    const base = { cdnId: cdn.id as string, containerNo: cdn.container_no as string }
    try {
      const cookie = await loginFor(cdn.shipper)
      const { rows, rawSample } = await fetchGateRows(cookie, cdn.container_no)
      const decision = decideGatePatch(cdn, rows)
      const update: Record<string, any> = { ...decision.patch, trico_checked_at: new Date().toISOString(), trico_check_note: decision.note }
      const { error: upErr } = await sb.from('cdn').update(update).eq('id', cdn.id)
      if (upErr) throw new Error(upErr.message)
      summary.checked++
      if (decision.outcome === 'ok') summary.updated++
      summary.results.push({ ...base, outcome: decision.outcome, note: decision.note })
      if ((decision.outcome === 'no_container' || decision.outcome === 'cusdec_mismatch') && rawSample.length && !summary.rawSample) summary.rawSample = rawSample
    } catch (e: any) {
      // Config / login problems are recorded on the row so the panel can show why,
      // and the batch carries on with the remaining rows.
      const note = `Error: ${String(e.message).slice(0, 600)}`
      await sb.from('cdn').update({ trico_checked_at: new Date().toISOString(), trico_check_note: note }).eq('id', cdn.id)
      summary.results.push({ ...base, outcome: 'error', note })
    }
  }
  return summary
}
