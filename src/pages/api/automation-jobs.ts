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

// Queue for the Barcode Enter automation. This route only ENQUEUES and reads status; the Navis / SLPA
// browsing happens in /api/automation-run (headless Chromium inside a Vercel function).
//   GET   ?kind=barcode_enter|trico_gate_pass → eligible CDNs + recent jobs
//   POST  { kind, cdnIds[] }                  → queue jobs (re-validated server side)
//   PATCH ?id=...  { navisDone }              → manually flip a job's "Navis done" mark
//   PATCH ?id=...  { cusdecNumber }           → fix the CDN's CUSDEC number + clear "Navis done"
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

      const eligible = (cdns || []).filter((c: any) => {
        if (blank(c.container_no) || busy.has(c.id)) return false
        if (kind === 'barcode_enter') return !haveBarcode.has(String(c.container_no).trim().toUpperCase())
        return blank(c.gate_add_time)   // Trico Gate Pass only for CDNs with no gate add time yet
      }).map((c: any) => ({ ...c, shipper: shipperName(c.shipper), ready: mappedPortals(map, c.shipper) }))

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
      // default — carry the "Navis done" mark over from that CDN's latest failed job. This mark can
      // itself be wrong (if what got typed into Navis the first time round was wrong — e.g. a
      // mistyped CUSDEC number), which is exactly what the PATCH ?id= actions below are for: fixing
      // the CDN's CUSDEC number clears the mark on that job so the next re-run (here) goes through
      // Navis fresh, and the plain "Navis done" toggle lets an admin flip it by hand for any job.
      let navisDone = new Set<string>()
      if (kind === 'barcode_enter') {
        const { data: prev } = await sb.from('automation_jobs').select('cdn_id, result, created_at').eq('kind', kind).eq('status', 'failed').in('cdn_id', cdnIds).order('created_at', { ascending: false })
        const latest = new Map<string, any>()
        for (const j of prev || []) if (!latest.has(j.cdn_id)) latest.set(j.cdn_id, j)
        navisDone = new Set(Array.from(latest.values()).filter((j: any) => j.result?.navis_done).map((j: any) => j.cdn_id))
      }
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
        const navisAlreadyDone = navisDone.has(c.id)
        rows.push({
          kind, cdn_id: c.id, container_no: c.container_no, cusdec_number: c.cusdec_number, shipper: shipperName(c.shipper),
          created_by: authed.userId, created_by_name: prof?.full_name || prof?.username || '',
          result: {
            ...(navisAlreadyDone ? { navis_done: true } : {}), dry_run: navisAlreadyDone ? false : dryRun,
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
      // objecting, while SLPA's own search rejects it; fixing it here means correcting it at the
      // source (the CDN row, which is what the Navis/SLPA data is built from) and clearing this
      // job's "Navis done" mark so the very next re-run goes through Navis again with the corrected
      // number, instead of retrying SLPA alone with the same wrong one.
      if (typeof req.body?.cusdecNumber === 'string') {
        const cusdecNumber = req.body.cusdecNumber.trim()
        if (!cusdecNumber) return res.status(400).json({ error: 'cusdecNumber required' })
        const { error: e1 } = await sb.from('cdn').update({ cusdec_number: cusdecNumber }).eq('id', job.cdn_id)
        if (e1) throw e1
        const { error: e2 } = await sb.from('automation_jobs').update({ cusdec_number: cusdecNumber, result: { ...(job.result || {}), navis_done: false } }).eq('id', id)
        if (e2) throw e2
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
