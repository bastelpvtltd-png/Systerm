import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { checkBoatNote, checkExportRelease, cleanCusdecNumber, isBoatNotePassed, resolveTin } from '@/lib/automationChecks'
import { yearOf } from '@/lib/flexibleDate'
import { syncVesselTriggers } from '@/lib/vesselTrigger'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Automation Triggers (Search & Release) — the user-facing "Auto Trigger"
// buttons in automation.tsx already check every pending CDN/CUSDEC on
// demand; this is the same logic run on a schedule instead of a click.
// Vercel Cron has no logged-in user, so it authenticates with a shared
// secret (CRON_SECRET env var) instead of a Supabase session — Vercel signs
// its own cron requests with this same bearer token automatically once it's
// set, per https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs.
//
// Each panel tracks its own interval_minutes/last_run_at in automation_runs
// so this can run frequently (the cron schedule itself is fixed) while each
// panel only actually does work once its own configured interval has
// elapsed — an idle panel costs nothing beyond one cheap timestamp check.
//
// Vercel's Hobby plan only allows a cron to fire once per day (a shorter
// vercel.json schedule gets the whole deployment rejected at build time —
// confirmed the hard way), so today this only ever runs once/day regardless
// of what's configured in automation_runs; the interval field is real and
// will matter as soon as the project is on Pro (which allows finer cron
// schedules), it's just capped by the plan for now.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const expected = process.env.CRON_SECRET
  const authHeader = req.headers.authorization || ''
  if (!expected || authHeader !== `Bearer ${expected}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const now = new Date()
  const { data: runs } = await supabaseAdmin.from('automation_runs').select('*')
  const runByPanel = Object.fromEntries((runs || []).map(r => [r.panel, r]))
  const results: Record<string, any> = {}

  const boatNoteRun = runByPanel['boat_note']
  const dueBoatNote = boatNoteRun?.enabled !== false && (!boatNoteRun?.last_run_at ||
    (now.getTime() - new Date(boatNoteRun.last_run_at).getTime()) >= (boatNoteRun.interval_minutes || 60) * 60_000)

  if (boatNoteRun?.enabled === false) {
    results.boat_note = { skipped: true, reason: 'paused' }
  } else if (dueBoatNote) {
    // Only auto-check CDNs whose parent CUSDEC's CAP is already complete —
    // a CUSDEC still waiting on more CDN uploads isn't ready for Boat Note
    // checking yet, same rule isCapComplete/isBoatNotePassed use elsewhere.
    // Manual Trigger (the per-CDN button in automation.tsx) is unaffected —
    // it can still check any CDN regardless of CAP completeness.
    const [{ data: cdns }, { data: cusdecs }] = await Promise.all([
      supabaseAdmin.from('cdn').select('id, code, cusdec_number, container_no, boat_note_passed'),
      supabaseAdmin.from('cusdec').select('code, number, cap'),
    ])
    const capByCusdec = new Map((cusdecs || []).map(c => [`${c.code}|||${c.number}`, parseInt(c.cap || '', 10)]))
    const cdnCountByCusdec = new Map<string, number>()
    for (const d of cdns || []) {
      const key = `${d.code}|||${d.cusdec_number}`
      cdnCountByCusdec.set(key, (cdnCountByCusdec.get(key) || 0) + 1)
    }
    const isCapComplete = (d: { code: string; cusdec_number: string }) => {
      const key = `${d.code}|||${d.cusdec_number}`
      const cap = capByCusdec.get(key)
      if (!cap || Number.isNaN(cap)) return true // CAP not known — don't block on it
      return (cdnCountByCusdec.get(key) || 0) >= cap
    }
    const pending = (cdns || []).filter(c => !c.boat_note_passed && c.container_no && isCapComplete(c))
    let passedCount = 0
    for (const cdn of pending) {
      try {
        const r = await checkBoatNote(cdn.container_no, cdn.id)
        if (r.passed) passedCount++
      } catch { /* keep going through the rest of the batch */ }
    }
    // Only spend this panel's interval when there was actually something to
    // check — an empty run (nothing CAP-complete/pending right now) doesn't
    // reset last_run_at, so the very next ping tries again immediately
    // instead of waiting out the rest of the interval for no reason. Once
    // real data shows up it gets picked up on the next ping and only then
    // does the interval actually start counting down again.
    if (pending.length) await supabaseAdmin.from('automation_runs').update({ last_run_at: now.toISOString() }).eq('panel', 'boat_note')
    results.boat_note = { checked: pending.length, passed: passedCount }
  } else {
    results.boat_note = { skipped: true, reason: 'not due yet' }
  }

  const exportReleaseRun = runByPanel['export_release']
  const dueExportRelease = exportReleaseRun?.enabled !== false && (!exportReleaseRun?.last_run_at ||
    (now.getTime() - new Date(exportReleaseRun.last_run_at).getTime()) >= (exportReleaseRun.interval_minutes || 60) * 60_000)

  if (exportReleaseRun?.enabled === false) {
    results.export_release = { skipped: true, reason: 'paused' }
  } else if (dueExportRelease) {
    const [{ data: cusdecs }, { data: cdns }] = await Promise.all([
      supabaseAdmin.from('cusdec').select('id, code, number, date, cap, tin_vat, exporter, export_release_passed'),
      supabaseAdmin.from('cdn').select('code, cusdec_number, boat_note_passed'),
    ])
    const eligible = (cusdecs || []).filter(c => isBoatNotePassed(c, cdns || []))
    const pending = eligible.filter(c => !c.export_release_passed)
    let passedCount = 0
    for (const c of pending) {
      try {
        const tin = await resolveTin(c)
        if (!tin) continue // same "no TIN, skip" behavior as the manual panel, just without a UI to prompt for one
        const r = await checkExportRelease({
          officeCode: c.code, serial: 'E', cusdecNumber: cleanCusdecNumber(c.number),
          cusdecYear: yearOf(c.date), consigneeTIN: tin, cusdecId: c.id,
        })
        if (r.passed) passedCount++
      } catch { /* keep going through the rest of the batch */ }
    }
    // Same as boat_note above — don't spend the interval on an empty run.
    if (pending.length) await supabaseAdmin.from('automation_runs').update({ last_run_at: now.toISOString() }).eq('panel', 'export_release')
    results.export_release = { checked: pending.length, passed: passedCount }
  } else {
    results.export_release = { skipped: true, reason: 'not due yet' }
  }

  const vesselRun = runByPanel['vessel_trigger']
  const dueVessel = vesselRun?.enabled !== false && (!vesselRun?.last_run_at ||
    (now.getTime() - new Date(vesselRun.last_run_at).getTime()) >= (vesselRun.interval_minutes || 60) * 60_000)

  if (vesselRun?.enabled === false) {
    results.vessel_trigger = { skipped: true, reason: 'paused' }
  } else if (dueVessel) {
    try {
      const r = await syncVesselTriggers()
      results.vessel_trigger = r
    } catch (e: any) {
      results.vessel_trigger = { error: e.message }
    }
    await supabaseAdmin.from('automation_runs').update({ last_run_at: now.toISOString() }).eq('panel', 'vessel_trigger')
  } else {
    results.vessel_trigger = { skipped: true, reason: 'not due yet' }
  }

  res.json({ ok: true, ranAt: now.toISOString(), results })
}
