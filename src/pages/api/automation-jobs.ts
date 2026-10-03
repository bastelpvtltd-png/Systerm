import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { requireSection } from '@/lib/serverAuth'
import { shipperName } from '@/lib/shipperName'
import { loadShipperMap, mappedPortals } from '@/lib/portalCredentials'

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
//   GET  ?kind=barcode_enter|trico_gate_pass → eligible CDNs + recent jobs
//   POST { kind, cdnIds[] }                  → queue jobs (re-validated server side)
//   DELETE ?id=...                           → cancel a job that is still queued
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
      if (kind === 'trico_gate_pass') return res.status(400).json({ error: 'Trico gate pass entry is not built yet (it needs the gate pass form HTML).' })
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
      // A barcode run that failed AFTER Navis succeeded must not enter Navis again
      // on the re-run — carry the "Navis done" mark over to the new job.
      let navisDone = new Set<string>()
      if (kind === 'barcode_enter') {
        const { data: prev } = await sb.from('automation_jobs').select('cdn_id, result').eq('kind', kind).eq('status', 'failed').in('cdn_id', cdnIds)
        navisDone = new Set((prev || []).filter((j: any) => j.result?.navis_done).map((j: any) => j.cdn_id))
      }
      for (const c of cdns || []) {
        const ref = c.container_no || c.id
        if (blank(c.container_no)) { skipped.push({ cdnId: c.id, container: ref, reason: 'No container number' }); continue }
        if (busy.has(c.id)) { skipped.push({ cdnId: c.id, container: ref, reason: 'A job is already queued/running' }); continue }
        if (kind === 'barcode_enter' && barcodeSet.has(String(c.container_no).trim().toUpperCase())) { skipped.push({ cdnId: c.id, container: ref, reason: 'Barcode already exists' }); continue }
        const ready = mappedPortals(map, c.shipper)
        const missing = NEEDS[kind].filter(p => !ready[p])
        if (missing.length) { skipped.push({ cdnId: c.id, container: ref, reason: `No ${missing.join(' / ').toUpperCase()} login mapped for this shipper` }); continue }
        rows.push({
          kind, cdn_id: c.id, container_no: c.container_no, cusdec_number: c.cusdec_number, shipper: shipperName(c.shipper),
          created_by: authed.userId, created_by_name: prof?.full_name || prof?.username || '',
          result: { ...(navisDone.has(c.id) ? { navis_done: true } : {}), dry_run: dryRun },
        })
      }
      if (rows.length) {
        const { error } = await sb.from('automation_jobs').insert(rows)
        if (error) throw error
        // Re-running a CDN clears its old failure from the dashboard's Automate Errors list.
        await sb.from('automation_jobs').update({ error_dismissed_at: new Date().toISOString() })
          .eq('kind', kind).eq('status', 'failed').is('error_dismissed_at', null).in('cdn_id', rows.map(r => r.cdn_id))
      }
      return res.json({ queued: rows.length, skipped })
    }

    if (req.method === 'DELETE') {
      const id = String(req.query.id || '')
      if (!id) return res.status(400).json({ error: 'id required' })
      const { data: job } = await sb.from('automation_jobs').select('kind').eq('id', id).maybeSingle()
      if (!job) return res.status(404).json({ error: 'Job not found' })
      const sec = await requireSection(req, SECTION[job.kind as Kind])
      if (!sec.ok) return res.status(sec.status).json({ error: sec.error })
      const { error } = await sb.from('automation_jobs').update({ status: 'cancelled', finished_at: new Date().toISOString() }).eq('id', id).eq('status', 'queued')
      if (error) throw error
      return res.json({ ok: true })
    }

    res.status(405).end()
  } catch (err: any) {
    console.error('[automation-jobs] error:', err)
    res.status(500).json({ error: err.message })
  }
}
