import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { requireSection, requireAdmin } from '@/lib/serverAuth'
import { shipperName } from '@/lib/shipperName'
import { loadShipperMap, mappedPortals } from '@/lib/portalCredentials'
import { kickRunner, originOf } from '@/lib/automation/kick'

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

type Kind = 'barcode_enter' | 'trico_gate_pass'
const SECTION: Record<Kind, string> = {
  barcode_enter: 'section:automation.barcode-enter',
  trico_gate_pass: 'section:automation.trico-gate-pass',
}
const NEEDS: Record<Kind, ('navis' | 'slpa' | 'trico')[]> = {
  barcode_enter: ['navis', 'slpa'],
  trico_gate_pass: ['trico'],
}
const blank = (v: unknown) => v === null || v === undefined || String(v).trim() === ''

// What a fresh job for this CDN should carry over: "Navis done" (so a re-run skips straight to
// SLPA) and any one-off CUSDEC correction, both taken from that CDN's most recent failed job OR
// manual marker row (a 'cancelled' row created purely to record "Navis OK"/"Navis not done" for a
// CDN that was handled by hand, outside the automation, and has no real job yet).
async function latestMarks(kind: Kind, cdnIds: string[]): Promise<Map<string, { navisDone: boolean; cusdecOverride: string | null }>> {
  const out = new Map<string, { navisDone: boolean; cusdecOverride: string | null }>()
  if (kind !== 'barcode_enter' || !cdnIds.length) return out
  const { data: prev } = await sb.from('automation_jobs').select('cdn_id, result, created_at')
    .eq('kind', kind).in('status', ['failed', 'cancelled']).in('cdn_id', cdnIds).order('created_at', { ascending: false })
  const seen = new Set<string>()
  for (const j of prev || []) {
    if (seen.has(j.cdn_id)) continue
    seen.add(j.cdn_id)
    if (j.result?.navis_done || j.result?.cusdec_override) {
      out.set(j.cdn_id, { navisDone: !!j.result?.navis_done, cusdecOverride: j.result?.cusdec_override || null })
    }
  }
  return out
}

// Queue for the Barcode Enter automation. This route only ENQUEUES and reads status; the Navis / SLPA
// browsing happens in /api/automation-run (headless Chromium inside a Vercel function).
//   GET   ?kind=barcode_enter|trico_gate_pass → eligible CDNs + recent jobs
//   POST  { kind, cdnIds[] }                  → queue jobs (re-validated server side)
//   PATCH ?id=...     { navisDone }           → manually flip a job's "Navis done" mark
//   PATCH ?id=...     { cusdecNumber }        → one-off CUSDEC correction for this job's next retry
//   PATCH ?cdnId=...  { navisDone }           → mark/unmark "Navis done" for a CDN with no job yet
//                                                (e.g. Navis was done by hand, outside the automation)
//   DELETE ?id=...                            → cancel a job that is still queued
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const kind = String(req.method === 'POST' ? req.body?.kind : req.query.kind || '') as Kind
  if (req.method !== 'DELETE' && !SECTION[kind]) return res.status(400).json({ error: 'kind must be barcode_enter or trico_gate_pass' })
  const authed = await requireSection(req, SECTION[kind] || SECTION.barcode_enter)
  if (!authed.ok) return res.status(authed.status).json({ error: authed.error })

  try {
    if (req.method === 'GET') {
      const [{ data: cdns }, { data: barcodes }, { data: active }, { data: jobs }, map] = await Promise.all([
        sb.from('cdn').select('id, code, cusdec_number, container_no, cdn_no, shipper, gate_add_time, trico_checked_at, trico_check_note').order('created_at', { ascending: false }).limit(3000),
        kind === 'barcode_enter' ? sb.from('barcode').select('container_no').limit(10000) : Promise.resolve({ data: [] as any[] }),
        sb.from('automation_jobs').select('cdn_id').eq('kind', kind).in('status', ['queued', 'running']),
        sb.from('automation_jobs').select('id, kind, cdn_id, container_no, cusdec_number, shipper, status, step, error, error_step, error_field, has_screenshot, created_by_name, created_at, started_at, finished_at, result').eq('kind', kind).order('created_at', { ascending: false }).limit(40),
        loadShipperMap()
      ])
      const haveBarcode = new Set((barcodes || []).map((b: any) => String(b.container_no || '').trim().toUpperCase()))
      const busy = new Set((active || []).map((j: any) => j.cdn_id))

      const eligibleCdns = (cdns || []).filter((c: any) => {
        if (blank(c.container_no) || busy.has(c.id)) return false
        if (kind === 'barcode_enter') return !haveBarcode.has(String(c.container_no).trim().toUpperCase())
        return blank(c.gate_add_time)   // Trico Gate Pass only for CDNs with no gate add time yet
      })
      const marks = await latestMarks(kind, eligibleCdns.map((c: any) => c.id))
      const eligible = eligibleCdns.map((c: any) => ({ ...c, shipper: shipperName(c.shipper), ready: mappedPortals(map, c.shipper), navisDone: !!marks.get(c.id)?.navisDone }))

      return res.json({ eligible, jobs: jobs || [], needs: NEEDS[kind] })
    }

    if (req.method === 'POST') {
      const dryRun = req.body.dryRun !== false   // test mode unless explicitly turned off
      const cdnIds: string[] = Array.isArray(req.body.cdnIds) ? req.body.cdnIds.slice(0, 100) : []
      if (!cdnIds.length) return res.status(400).json({ error: 'cdnIds required' })
      const [{ data: cdns }, { data: active }, map] = await Promise.all([
        sb.from('cdn').select('id, cusdec_number, container_no, shipper, gate_add_time').in('id', cdnIds),
        sb.from('automation_jobs').select('cdn_id').eq('kind', kind).in('status', ['queued', 'running']).in('cdn_id', cdnIds),
        loadShipperMap(),
      ])
      const busy = new Set((active || []).map((j: any) => j.cdn_id))
      const { data: prof } = await sb.from('profiles').select('username, full_name').eq('id', authed.userId).maybeSingle()

      const skipped: { cdnId: string; container: string; reason: string }[] = []
      const rows: any[] = []
      let barcodeSet = new Set<string>()
      if (kind === 'barcode_enter') {
        const { data: b } = await sb.from('barcode').select('container_no').in('container_no', (cdns || []).map((c: any) => c.container_no).filter(Boolean))
        barcodeSet = new Set((b || []).map((x: any) => String(x.container_no).trim().toUpperCase()))
      }
      // A barcode run that failed AFTER Navis succeeded must not enter Navis again on the re-run by
      // default — carry the "Navis done" mark (and any one-off CUSDEC correction) over from that
      // CDN's latest failed job / manual marker. The plain "Navis done" toggle and the "fix CUSDEC &
      // retry" action below both just write to that same latest row, so this one lookup covers both.
      const marks = await latestMarks(kind, cdnIds)
      for (const c of cdns || []) {
        const ref = c.container_no || c.id
        if (blank(c.container_no)) { skipped.push({ cdnId: c.id, container: ref, reason: 'No container number' }); continue }
        if (busy.has(c.id)) { skipped.push({ cdnId: c.id, container: ref, reason: 'A job is already queued/running' }); continue }
        if (kind === 'barcode_enter' && barcodeSet.has(String(c.container_no).trim().toUpperCase())) { skipped.push({ cdnId: c.id, container: ref, reason: 'Barcode already exists' }); continue }
        const ready = mappedPortals(map, c.shipper)
        const missing = NEEDS[kind].filter(p => !ready[p])
        if (missing.length) { skipped.push({ cdnId: c.id, container: ref, reason: `No ${missing.join(' / ').toUpperCase()} login mapped for this shipper` }); continue }
        const tricoOpt = req.body.tricoOptions?.[c.id] || {}
        // A CDN whose Navis entry already really happened (carried over above) can't be put back
        // into test mode — there's nothing left to simulate, and "dry_run: true" here would make
        // the SLPA phase's own filter (navis_done && !dry_run) skip it forever, stranding the job in
        // "queued" with neither phase ever picking it up.
        const mark = marks.get(c.id)
        const navisAlreadyDone = !!mark?.navisDone
        rows.push({
          kind, cdn_id: c.id, container_no: c.container_no, cusdec_number: c.cusdec_number, shipper: shipperName(c.shipper),
          created_by: authed.userId, created_by_name: prof?.full_name || prof?.username || '',
          result: {
            ...(navisAlreadyDone ? { navis_done: true } : {}), dry_run: navisAlreadyDone ? false : dryRun,
            ...(mark?.cusdecOverride ? { cusdec_override: mark.cusdecOverride } : {}),
            ...(kind === 'trico_gate_pass' ? {
              vgm: tricoOpt.vgm !== false, fumigation: tricoOpt.fumigation !== false, quarantine: tricoOpt.quarantine !== false,
            } : {}),
          },
        })
      }
      if (rows.length) {
        const { error } = await sb.from('automation_jobs').insert(rows)
        if (error) throw error
        // Re-running a CDN clears its old failure from the dashboard's Automate Errors list.
        await sb.from('automation_jobs').update({ error_dismissed_at: new Date().toISOString() })
          .eq('kind', kind).eq('status', 'failed').is('error_dismissed_at', null).in('cdn_id', rows.map(r => r.cdn_id))
      }
      // Start processing on the server right away (the page does not have to stay open).
      if (rows.length) await kickRunner(originOf(req))
      return res.json({ queued: rows.length, skipped })
    }

    if (req.method === 'PATCH') {
      const id = String(req.query.id || '')
      const cdnId = String(req.query.cdnId || '')
      if (!id && !cdnId) return res.status(400).json({ error: 'id or cdnId required' })

      // No job exists yet for this CDN (e.g. Navis was done by hand, outside the automation) — mark
      // it with a 'cancelled' placeholder row purely so the next real run's carry-over lookup
      // (latestMarks, above) picks it up, the same way it would pick up a real failed job's mark.
      if (cdnId && typeof req.body?.navisDone === 'boolean') {
        const { data: cdn } = await sb.from('cdn').select('id, container_no, cusdec_number, shipper').eq('id', cdnId).maybeSingle()
        if (!cdn) return res.status(404).json({ error: 'CDN not found' })
        const { data: prof } = await sb.from('profiles').select('username, full_name').eq('id', authed.userId).maybeSingle()
        const { error } = await sb.from('automation_jobs').insert({
          kind, cdn_id: cdn.id, container_no: cdn.container_no, cusdec_number: cdn.cusdec_number, shipper: shipperName(cdn.shipper),
          created_by: authed.userId, created_by_name: prof?.full_name || prof?.username || '',
          status: 'cancelled', finished_at: new Date().toISOString(),
          error: `Navis marked ${req.body.navisDone ? 'done' : 'not done'} by hand`,
          result: { navis_done: req.body.navisDone },
        })
        if (error) throw error
        return res.json({ ok: true })
      }

      if (!id) return res.status(400).json({ error: 'id required' })
      const { data: job } = await sb.from('automation_jobs').select('id, kind, cdn_id, result').eq('id', id).maybeSingle()
      if (!job) return res.status(404).json({ error: 'Job not found' })
      const sec = await requireSection(req, SECTION[job.kind as Kind])
      if (!sec.ok) return res.status(sec.status).json({ error: sec.error })

      // Manual "Navis done" toggle — lets an admin correct the mark a re-run will carry over for
      // this CDN, either way, instead of trusting whatever the automation last recorded.
      if (typeof req.body?.navisDone === 'boolean') {
        const { error } = await sb.from('automation_jobs').update({ result: { ...(job.result || {}), navis_done: req.body.navisDone } }).eq('id', id)
        if (error) throw error
        return res.json({ ok: true })
      }

      // "Fix CUSDEC & retry" — a wrong CUSDEC number can get typed into Navis without Navis
      // objecting, while SLPA's own search rejects it. The correction is a one-off for this retry
      // only — it is NEVER written back to the CDN's own cusdec_number — and clears this job's
      // "Navis done" mark so the very next re-run goes through Navis again with the corrected
      // number, instead of retrying SLPA alone with the same wrong one.
      if (typeof req.body?.cusdecNumber === 'string') {
        const cusdecNumber = req.body.cusdecNumber.trim()
        if (!cusdecNumber) return res.status(400).json({ error: 'cusdecNumber required' })
        const { error } = await sb.from('automation_jobs').update({
          cusdec_number: cusdecNumber, result: { ...(job.result || {}), navis_done: false, cusdec_override: cusdecNumber },
        }).eq('id', id)
        if (error) throw error
        return res.json({ ok: true })
      }

      return res.status(400).json({ error: 'Nothing to update — pass navisDone or cusdecNumber' })
    }

    if (req.method === 'DELETE') {
      const id = String(req.query.id || '')
      if (!id) return res.status(400).json({ error: 'id required' })
      const { data: job } = await sb.from('automation_jobs').select('kind, status').eq('id', id).maybeSingle()
      if (!job) return res.status(404).json({ error: 'Job not found' })
      if (job.status === 'queued') {
        const sec = await requireSection(req, SECTION[job.kind as Kind])
        if (!sec.ok) return res.status(sec.status).json({ error: sec.error })
        const { error } = await sb.from('automation_jobs').update({ status: 'cancelled', finished_at: new Date().toISOString() }).eq('id', id).eq('status', 'queued')
        if (error) throw error
        return res.json({ ok: true })
      }
      // Removing a finished/failed/cancelled row from the Recent runs list is
      // permanent (not just a status flip) — admin only.
      const admin = await requireAdmin(req)
      if (!admin.ok) return res.status(admin.status).json({ error: admin.error })
      const { error } = await sb.from('automation_jobs').delete().eq('id', id)
      if (error) throw error
      return res.json({ ok: true })
    }

    res.status(405).end()
  } catch (err: any) {
    console.error('[automation-jobs] error:', err)
    res.status(500).json({ error: err.message })
  }
}
