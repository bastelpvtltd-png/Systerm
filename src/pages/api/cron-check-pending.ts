import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { checkBoatNote, checkExportRelease, cleanCusdecNumber, isBoatNotePassed, resolveTin } from '@/lib/automationChecks'
import { yearOf } from '@/lib/flexibleDate'

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
  const dueBoatNote = !boatNoteRun?.last_run_at ||
    (now.getTime() - new Date(boatNoteRun.last_run_at).getTime()) >= (boatNoteRun.interval_minutes || 60) * 60_000

  if (dueBoatNote) {
    const { data: cdns } = await supabaseAdmin.from('cdn').select('id, container_no, boat_note_passed')
    const pending = (cdns || []).filter(c => !c.boat_note_passed && c.container_no)
    let passedCount = 0
    for (const cdn of pending) {
      try {
        const r = await checkBoatNote(cdn.container_no, cdn.id)
        if (r.passed) passedCount++
      } catch { /* keep going through the rest of the batch */ }
    }
    await supabaseAdmin.from('automation_runs').update({ last_run_at: now.toISOString() }).eq('panel', 'boat_note')
    results.boat_note = { checked: pending.length, passed: passedCount }
  } else {
    results.boat_note = { skipped: true, reason: 'not due yet' }
  }

  const exportReleaseRun = runByPanel['export_release']
  const dueExportRelease = !exportReleaseRun?.last_run_at ||
    (now.getTime() - new Date(exportReleaseRun.last_run_at).getTime()) >= (exportReleaseRun.interval_minutes || 60) * 60_000

  if (dueExportRelease) {
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
    await supabaseAdmin.from('automation_runs').update({ last_run_at: now.toISOString() }).eq('panel', 'export_release')
    results.export_release = { checked: pending.length, passed: passedCount }
  } else {
    results.export_release = { skipped: true, reason: 'not due yet' }
  }

  res.json({ ok: true, ranAt: now.toISOString(), results })
}
