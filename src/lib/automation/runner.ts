import { createClient } from '@supabase/supabase-js'
import type { Browser } from 'playwright-core'
import { launch } from './portal'
import { FieldError, asFieldError } from './errors'
import { prepareValues } from './data'
import { navisLogin, navisEnterOne, navisClose } from './navis'
import { slpaLogin, slpaEnterOne, slpaClose } from './slpa'
import { finalizeBarcode } from './finalize'
import { fetchGatePassForm, prepareGatePassValues, submitGatePass, formatGatePassPreview } from './tricoGatePass'
import { tricoLoginWith } from '@/lib/tricoSession'
import { resolvePortalLogins, type PortalLogin } from '@/lib/portalCredentials'

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

// The whole slice must finish inside the function's maxDuration (300 s in pages/api/automation-run.ts).
// If that is lowered (e.g. to 60 on a plan that doesn't allow 300), set AUTOMATION_MAX_MS to ~ (limit - 15 s).
const HARD_MS = Number(process.env.AUTOMATION_MAX_MS) || 285_000
const NAVIS_NEEDS_MS = 70_000      // a new container is only started if this much time is left
const SLPA_NEEDS_MS = 100_000
const TRICO_NEEDS_MS = 30_000      // plain fetch, no browser — much cheaper than Navis/SLPA
const LOGIN_MS = 25_000
const LOCK_KEY = 'automation_runner_lock'
const MAX_ATTEMPTS = 3
const BATCH = 40

export interface SliceResult { busy?: boolean; processed: number; remaining: number }
type Row = Record<string, any>
interface Cand { job: Row; cdn: Row; cusdec: { code?: string; number?: string; date?: string; hs_code?: string } | null; login: PortalLogin }

// ── DB helpers ───────────────────────────────────────────────────────────────
async function acquireLock(): Promise<boolean> {
  const { data } = await sb.from('app_settings').select('value').eq('key', LOCK_KEY).maybeSingle()
  const t = data?.value ? Date.parse(String(data.value)) : 0
  if (t && Date.now() - t < HARD_MS + 15_000) return false
  await sb.from('app_settings').upsert({ key: LOCK_KEY, value: new Date().toISOString() })
  return true
}
const releaseLock = () => sb.from('app_settings').upsert({ key: LOCK_KEY, value: '1970-01-01T00:00:00Z' })

async function claim(jobId: string, step: string): Promise<boolean> {
  const { data } = await sb.from('automation_jobs')
    .update({ status: 'running', step, started_at: new Date().toISOString(), error: null, error_step: null, error_field: null })
    .eq('id', jobId).eq('status', 'queued').select('id').maybeSingle()
  return !!data
}

async function failJob(job: Row, e: FieldError) {
  console.error(`[automation] ✗ ${job.container_no} [${e.step}/${e.field}] ${e.message}`)
  await sb.from('automation_jobs').update({
    status: 'failed', error: e.message.slice(0, 1000), error_step: e.step, error_field: e.field,
    finished_at: new Date().toISOString(), screenshot: e.screenshot || null, has_screenshot: !!e.screenshot, debug: e.debug || null,
  }).eq('id', job.id)
}

// A slice that was killed mid-way leaves jobs "running". A job interrupted during the Navis step
// is NOT retried automatically (it may or may not have been saved in Navis — entering it twice is
// worse than asking); an interrupted SLPA/finalize step is safe to retry.
async function recoverStale() {
  const before = new Date(Date.now() - (HARD_MS + 30_000)).toISOString()
  const { data } = await sb.from('automation_jobs').select('id, container_no, attempts, step').in('kind', ['barcode_enter', 'trico_gate_pass']).eq('status', 'running').lt('started_at', before)
  for (const s of data || []) {
    if (s.step === 'trico') {
      await failJob(s, new FieldError('trico', 'Interrupted', 'The run was interrupted while this container was being submitted to Trico — check the Trico Gate Pass List by hand (it may or may not have been saved) before running it again'))
    } else if (!s.step || s.step === 'navis') {
      await failJob(s, new FieldError('navis', 'Interrupted', 'The run was interrupted while this container was being entered in Navis — check Navis by hand (it may or may not have been saved) before running it again'))
    } else if ((s.attempts || 0) >= MAX_ATTEMPTS) {
      await failJob(s, new FieldError(s.step === 'finalize' ? 'finalize' : 'slpa', 'Retries', `Gave up after ${MAX_ATTEMPTS} attempts`))
    } else {
      await sb.from('automation_jobs').update({ status: 'queued', error: 'Run was interrupted — retrying', started_at: null }).eq('id', s.id)
    }
  }
}

// Loads CDN + CUSDEC + the shipper's decrypted login for a batch of queued jobs; jobs that can't run fail here.
async function loadCandidates(jobs: Row[], portal: 'navis' | 'slpa' | 'trico'): Promise<Cand[]> {
  const out: Cand[] = []
  for (const job of jobs.slice(0, BATCH)) {
    const { data: cdn } = await sb.from('cdn').select('*').eq('id', job.cdn_id).maybeSingle()
    if (!cdn) { await failJob(job, new FieldError('prepare', 'CDN', 'CDN row no longer exists')); continue }
    const logins = await resolvePortalLogins(cdn.shipper, [portal])
    const login = logins[portal]
    if (!login) { await failJob(job, new FieldError('prepare', 'Shipper login', `No ${portal.toUpperCase()} login mapped for this shipper (Barcode Enter → Shipper logins)`)); continue }
    const { data: cusdec } = await sb.from('cusdec').select('code, number, date, hs_code').eq('code', cdn.code).eq('number', cdn.cusdec_number).order('date', { ascending: false }).limit(1).maybeSingle()
    out.push({ job, cdn, cusdec: cusdec || null, login })
  }
  return out
}

const groupByLogin = (cands: Cand[]) => {
  const m = new Map<string, Cand[]>()
  for (const c of cands) m.set(c.login.id, [...(m.get(c.login.id) || []), c])
  return Array.from(m.values())
}

async function queuedBarcodeJobs(): Promise<Row[]> {
  const { data } = await sb.from('automation_jobs').select('*').eq('kind', 'barcode_enter').eq('status', 'queued').order('created_at', { ascending: true }).limit(200)
  return data || []
}

async function queuedTricoJobs(): Promise<Row[]> {
  const { data } = await sb.from('automation_jobs').select('*').eq('kind', 'trico_gate_pass').eq('status', 'queued').order('created_at', { ascending: true }).limit(200)
  return data || []
}

// ── the slice ────────────────────────────────────────────────────────────────
/**
 * One serverless run. Order is always: every container is entered in Navis first (one login per
 * Navis account), then each is completed in SLPA (one login per SLPA account). If the time budget
 * runs out, the unfinished containers simply stay queued and the next slice carries on — the
 * Automation page keeps calling /api/automation-run until nothing is left.
 */
export async function runSlice(opts: { origin: string }): Promise<SliceResult> {
  if (!(await acquireLock())) return { busy: true, processed: 0, remaining: -1 }
  const t0 = Date.now()
  const hasBudget = (needMs: number) => Date.now() + needMs < t0 + HARD_MS
  let processed = 0
  let browser: Browser | null = null
  // If Chromium died mid-slice (OOM, crash — seen as "Target page, context or
  // browser has been closed" when the next login tries to open a page), a
  // cached dead Browser object just keeps failing every call after it. Relaunch
  // instead of reusing a browser that's no longer connected.
  const getBrowser = async () => (browser && browser.isConnected() ? browser : (browser = await launch()))

  try {
    await recoverStale()

    // ── A) Navis ──
    const needNavis = (await queuedBarcodeJobs()).filter(j => !j.result?.navis_done)
    for (const group of groupByLogin(await loadCandidates(needNavis, 'navis'))) {
      if (!hasBudget(NAVIS_NEEDS_MS + LOGIN_MS)) break
      let session
      try { session = await navisLogin(await getBrowser(), group[0].login) }
      catch (e) { for (const c of group) { if (await claim(c.job.id, 'navis')) { await failJob(c.job, asFieldError(e, 'navis', 'Login')); processed++ } } continue }

      for (const c of group) {
        if (!hasBudget(NAVIS_NEEDS_MS)) break
        if (!(await claim(c.job.id, 'navis'))) continue
        processed++
        try {
          const values = prepareValues(c.cdn, c.cusdec)
          const dry = !!c.job.result?.dry_run
          const r = await navisEnterOne(session, values.navis, { dryRun: dry })
          if (dry) {
            await sb.from('automation_jobs').update({
              status: 'cancelled', error: 'TEST MODE — Navis form was filled and a screenshot taken; nothing was saved on Navis.',
              finished_at: new Date().toISOString(), screenshot: r.screenshot || null, has_screenshot: !!r.screenshot,
            }).eq('id', c.job.id)
          } else {
            // Navis accepted it → back to the queue for the SLPA step. A re-run never enters Navis twice.
            await sb.from('automation_jobs').update({ status: 'queued', step: 'slpa', started_at: null, result: { ...(c.job.result || {}), navis_done: true } }).eq('id', c.job.id)
          }
        } catch (e) { await failJob(c.job, asFieldError(e, 'prepare')) }
      }
      await navisClose(session)
    }

    // Navis can leave the shared Chromium process carrying a lot of accumulated memory by the
    // time this many pages/contexts have been through it — SLPA's own login has crashed right at
    // its first page open ("Target page, context or browser has been closed") straight after a
    // busy Navis phase. Starting SLPA with a clean, freshly-launched browser instead of the one
    // Navis wore down costs one extra ~3s cold start but avoids carrying that pressure over.
    await (browser as Browser | null)?.close().catch(() => {})
    browser = null

    // ── B) SLPA (only containers Navis accepted) ──
    const needSlpa = (await queuedBarcodeJobs()).filter(j => j.result?.navis_done && !j.result?.dry_run)
    for (const group of groupByLogin(await loadCandidates(needSlpa, 'slpa'))) {
      if (!hasBudget(SLPA_NEEDS_MS + LOGIN_MS)) break
      let session
      try { session = await slpaLogin(await getBrowser(), group[0].login) }
      catch (e) { for (const c of group) { if (await claim(c.job.id, 'slpa')) { await failJob(c.job, asFieldError(e, 'slpa', 'Login')); processed++ } } continue }

      for (const c of group) {
        if (!hasBudget(SLPA_NEEDS_MS)) break
        if (!(await claim(c.job.id, 'slpa'))) continue
        processed++
        try {
          const values = prepareValues(c.cdn, c.cusdec)
          const out = await slpaEnterOne(session, values.slpa)
          await sb.from('automation_jobs').update({ step: 'finalize' }).eq('id', c.job.id)
          const fin = await finalizeBarcode({ cdn: c.cdn, pdf: out.pdf, fileName: out.fileName, origin: opts.origin })
          await sb.from('automation_jobs').update({
            status: 'done', step: 'finalize', finished_at: new Date().toISOString(), error: fin.notifyError,
            result: { ...(c.job.result || {}), driveLink: fin.driveLink },
          }).eq('id', c.job.id)
        } catch (e) { await failJob(c.job, asFieldError(e, 'slpa')) }
      }
      await slpaClose(session)
    }

    // ── C) Trico Gate Pass — plain fetch + session cookie, no browser needed ──
    const needTrico = await queuedTricoJobs()
    for (const group of groupByLogin(await loadCandidates(needTrico, 'trico'))) {
      if (!hasBudget(TRICO_NEEDS_MS + LOGIN_MS)) break
      let cookie: string
      try { cookie = await tricoLoginWith(group[0].login.username, group[0].login.password) }
      catch (e) { for (const c of group) { if (await claim(c.job.id, 'trico')) { await failJob(c.job, asFieldError(e, 'trico', 'Login')); processed++ } } continue }

      for (const c of group) {
        if (!hasBudget(TRICO_NEEDS_MS)) break
        if (!(await claim(c.job.id, 'trico'))) continue
        processed++
        try {
          const form = await fetchGatePassForm(cookie)
          const opts = {
            vgm: c.job.result?.vgm !== false, fumigation: c.job.result?.fumigation !== false, quarantine: c.job.result?.quarantine !== false,
          }
          const values = prepareGatePassValues(c.cdn as any, c.cusdec as any, form, c.login.wharf_number, opts)
          const dry = !!c.job.result?.dry_run
          if (dry) {
            const shipperLabel = form.shippers.find(s => s.id === values.shipper_id)?.name || values.shipper_id
            await sb.from('automation_jobs').update({
              status: 'cancelled', error: 'TEST MODE — Gate Pass fields were resolved; nothing was submitted to Trico.',
              finished_at: new Date().toISOString(), has_screenshot: true, debug: formatGatePassPreview(values, shipperLabel).slice(0, 4000),
            }).eq('id', c.job.id)
          } else {
            const out = await submitGatePass(cookie, form.token, values)
            await sb.from('automation_jobs').update({
              status: 'done', finished_at: new Date().toISOString(), has_screenshot: !!out.preview, debug: out.preview.slice(0, 4000) || null,
            }).eq('id', c.job.id)
          }
        } catch (e) { await failJob(c.job, asFieldError(e, 'prepare')) }
      }
    }

    const { count: barcodeLeft } = await sb.from('automation_jobs').select('id', { count: 'exact', head: true }).eq('kind', 'barcode_enter').eq('status', 'queued')
    const { count: tricoLeft } = await sb.from('automation_jobs').select('id', { count: 'exact', head: true }).eq('kind', 'trico_gate_pass').eq('status', 'queued')
    return { processed, remaining: (barcodeLeft || 0) + (tricoLeft || 0) }
  } finally {
    await (browser as Browser | null)?.close().catch(() => {})
    await releaseLock()
  }
}
