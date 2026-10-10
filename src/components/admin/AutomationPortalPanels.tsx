import { useState, useEffect, useMemo, useCallback, useRef, type ReactNode } from 'react'
import { authHeader } from '@/lib/supabase'
import { usePermission } from '@/components/admin/AdminLayout'
import { portalOfCredential } from '@/lib/portalSites'
import { Barcode as BarcodeIcon, Truck, Loader, Zap, Search, CheckCircle, XCircle, AlertTriangle, Users, RefreshCw } from 'lucide-react'

// Panels for the Automation tab that talk to the browser worker (Navis / SLPA /
// Trico) through the automation_jobs queue, plus the Trico Checking panel.
// Kept out of automation.tsx so that file only needs a few small edits.

interface EligibleCdn {
  id: string; cusdec_number: string; container_no: string; cdn_no: string | null; shipper: string
  gate_add_time?: string | null; trico_check_note?: string | null
  ready: { navis: boolean; slpa: boolean; trico: boolean }
  navisDone: boolean
}
interface Job {
  id: string; cdn_id: string; container_no: string; cusdec_number: string; shipper: string
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled'; step: string | null; error: string | null; error_step?: string | null; error_field?: string | null; has_screenshot?: boolean
  created_at: string; finished_at: string | null; created_by_name: string | null
  result?: { navis_done?: boolean } | null
}

const fmt = (iso?: string | null) => iso ? new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Colombo', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'

async function api(path: string, init: RequestInit = {}) {
  const res = await fetch(path, { ...init, headers: { 'Content-Type': 'application/json', ...(await authHeader()), ...(init.headers || {}) } })
  const d = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(d.error || `Request failed (${res.status})`)
  return d
}

// Fetches the screenshot saved for a failed / test-mode job and opens it in a new tab.
async function openShot(jobId: string) {
  const w = window.open('', '_blank')
  try {
    const d = await api(`/api/automation-screenshot?id=${jobId}`)
    const html = `<body style="margin:0;font-family:monospace;background:#111;color:#eee">${d.screenshot ? `<img src="data:image/jpeg;base64,${d.screenshot}" style="max-width:100%">` : ''}${d.debug ? `<pre style="padding:12px;white-space:pre-wrap">${String(d.debug).replace(/</g, '&lt;')}</pre>` : ''}</body>`
    if (w) { w.document.write(html); w.document.close() }
  } catch (e: any) { if (w) { w.document.write(`<pre>${e.message}</pre>`); w.document.close() } }
}

function Badge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full border ${ok ? 'bg-green-50 text-green-700 border-green-200' : 'bg-red-50 text-red-600 border-red-200'}`}>
      {ok ? <CheckCircle size={9}/> : <XCircle size={9}/>}{label}
    </span>
  )
}

function RunnerInfo({ driving }: { driving: boolean }) {
  return (
    <p className={`text-[11px] mb-3 flex items-center gap-1.5 ${driving ? 'text-blue-700' : 'text-gray-500'}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${driving ? 'bg-blue-500 animate-pulse' : 'bg-gray-300'}`}/>
      {driving ? 'Running on the server — you can close this page or turn the PC off; it carries on by itself, a few containers at a time. Progress shows here when you come back.' : 'Runs fully on the server (no PC, no open page needed): after you press Run it logs in to the portals and fills everything by itself.'}
    </p>
  )
}

function JobsTable({ jobs, kind, onCancel, onDelete, onToggleNavis, onFixCusdec, isAdmin }: {
  jobs: Job[]; kind: 'barcode_enter' | 'trico_gate_pass'; onCancel: (id: string) => void; onDelete: (id: string) => void
  onToggleNavis: (id: string, value: boolean) => void; onFixCusdec: (job: Job, cusdecNumber: string) => void; isAdmin: boolean
}) {
  const [fixing, setFixing] = useState<string | null>(null)
  const [fixValue, setFixValue] = useState('')
  if (!jobs.length) return null
  const color = (s: Job['status']) => s === 'done' ? 'text-green-600' : s === 'failed' ? 'text-red-600' : s === 'running' ? 'text-blue-600' : 'text-gray-500'
  const startFix = (j: Job) => { setFixing(j.id); setFixValue(j.cusdec_number || '') }
  const submitFix = (j: Job) => { if (fixValue.trim()) onFixCusdec(j, fixValue.trim()); setFixing(null) }
  return (
    <div className="mt-5">
      <h3 className="font-semibold text-gray-900 text-xs mb-2">Recent runs</h3>
      <div className="border border-gray-100 rounded-lg divide-y divide-gray-100 max-h-72 overflow-y-auto">
        {jobs.map(j => (
          <div key={j.id} className="px-3 py-2 text-xs flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <p className="font-mono font-semibold text-gray-800">{j.container_no} <span className="font-sans font-normal text-gray-400">· {j.cusdec_number}</span></p>
              <p className="text-gray-500 truncate">{j.shipper}</p>
              {j.error && <p className={`mt-0.5 break-words ${j.status === 'failed' ? 'text-red-600' : 'text-gray-500'}`}>{j.status === 'failed' && (j.error_step || j.error_field) ? `[${[j.error_step, j.error_field].filter(Boolean).join(' · ')}] ` : ''}{j.error}</p>}
              {kind === 'barcode_enter' && j.status === 'failed' && (
                fixing === j.id ? (
                  <div className="mt-1 flex items-center gap-1">
                    <input value={fixValue} onChange={e => setFixValue(e.target.value)} placeholder="Correct CUSDEC number"
                      className="input text-[11px] py-0.5 px-1.5 w-32" onKeyDown={e => e.key === 'Enter' && submitFix(j)}/>
                    <button onClick={() => submitFix(j)} className="text-[10px] text-green-600 hover:underline">save & retry</button>
                    <button onClick={() => setFixing(null)} className="text-[10px] text-gray-400 hover:underline">cancel</button>
                  </div>
                ) : (
                  <button onClick={() => startFix(j)} className="mt-0.5 text-[10px] text-blue-600 hover:underline block">fix CUSDEC & retry</button>
                )
              )}
            </div>
            <div className="text-right flex-shrink-0">
              <p className={`font-medium ${color(j.status)}`}>{j.status}{j.status === 'running' && j.step ? ` · ${j.step}` : ''}</p>
              {kind === 'barcode_enter' && j.status === 'failed' ? (
                <button onClick={() => onToggleNavis(j.id, !j.result?.navis_done)}
                  className={`text-[10px] block ml-auto hover:underline ${j.result?.navis_done ? 'text-green-600' : 'text-gray-400'}`}
                  title="Click to flip whether a re-run skips Navis for this CDN">
                  {j.result?.navis_done ? 'Navis ✓ (click to clear)' : 'Navis not done (click to mark)'}
                </button>
              ) : j.result?.navis_done && <p className="text-[10px] text-green-600">Navis ✓</p>}
              {j.has_screenshot && <button onClick={() => openShot(j.id)} className="text-[10px] text-blue-600 hover:underline block ml-auto">screenshot</button>}
              <p className="text-gray-400 text-[10px]">{fmt(j.finished_at || j.created_at)}</p>
              {j.status === 'queued' && <button onClick={() => onCancel(j.id)} className="text-[10px] text-red-500 hover:underline">cancel</button>}
              {j.status !== 'queued' && isAdmin && <button onClick={() => onDelete(j.id)} className="text-[10px] text-red-500 hover:underline">delete</button>}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// Shared "pick CDNs → queue jobs" panel used by Barcode Enter and Trico Gate Pass.
function QueuePanel({ kind, title, icon, description, needs, extraHeader, runLabel, autoRun }: {
  kind: 'barcode_enter' | 'trico_gate_pass'; title: string; icon: ReactNode; description: string
  needs: ('navis' | 'slpa' | 'trico')[]; extraHeader?: ReactNode; runLabel: string; autoRun?: boolean
}) {
  const [eligible, setEligible] = useState<EligibleCdn[]>([])
  const [jobs, setJobs] = useState<Job[]>([])
  const [testMode, setTestMode] = useState(true)
  type TricoOpts = { vgm: boolean; fumigation: boolean; quarantine: boolean }
  const DEFAULT_TRICO_OPTS: TricoOpts = { vgm: true, fumigation: true, quarantine: true }
  const [rowOpts, setRowOpts] = useState<Record<string, TricoOpts>>({})
  const optFor = (id: string): TricoOpts => rowOpts[id] || DEFAULT_TRICO_OPTS
  function setRowOpt(id: string, key: keyof TricoOpts, value: boolean) {
    setRowOpts(prev => ({ ...prev, [id]: { ...optFor(id), [key]: value } }))
  }
  // Master checkbox per category: ticks/unticks it for every row currently on screen at once;
  // each row's own box still overrides it afterwards.
  function setAllOpt(key: keyof TricoOpts, value: boolean, ids: string[]) {
    setRowOpts(prev => { const n = { ...prev }; for (const id of ids) n[id] = { ...optFor(id), [key]: value }; return n })
  }
  const { isAdmin } = usePermission()
  const [driving, setDriving] = useState(false)
  const driveRef = useRef(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState<{ ok: boolean; text: string; skipped?: { container: string; reason: string }[] } | null>(null)

  const load = useCallback(async () => {
    try {
      const d = await api(`/api/automation-jobs?kind=${kind}`)
      setEligible(d.eligible || []); setJobs(d.jobs || []); return d.jobs || []
      setSelected(prev => new Set(Array.from(prev).filter(id => (d.eligible || []).some((e: EligibleCdn) => e.id === id))))
    } catch (e: any) { setMsg({ ok: false, text: e.message }) }
    finally { setLoading(false) }
    return [] as Job[]
  }, [kind])
  useEffect(() => { load(); const t = setInterval(load, 10_000); return () => clearInterval(t) }, [load])

  // Barcode Enter runs inside a Vercel function that has a time limit, so it works in slices: this
  // loop keeps asking the server for the next slice until nothing is queued any more. If the page
  // is closed the remaining containers wait in the queue and continue when the page is opened again.
  const drive = useCallback(async () => {
    if (!autoRun || driveRef.current) return
    driveRef.current = true; setDriving(true)
    try {
      for (let i = 0; i < 300; i++) {
        const d = await api('/api/automation-run', { method: 'POST', body: '{}' })
        await load()
        if (d.busy) { await new Promise(r => setTimeout(r, 8000)); continue }
        if (!d.remaining || !d.processed) break
      }
    } catch (e: any) { setMsg({ ok: false, text: e.message }) }
    finally { driveRef.current = false; setDriving(false); load() }
  }, [autoRun, load])
  // Resume automatically when the page is opened and work is still queued/running.
  useEffect(() => { if (autoRun && jobs.some(j => j.status === 'queued')) drive() }, [autoRun, jobs.length]) // eslint-disable-line react-hooks/exhaustive-deps

  const isReady = (c: EligibleCdn) => needs.every(p => c.ready[p])
  const filtered = useMemo(() => eligible.filter(c => !search || [c.container_no, c.cusdec_number, c.shipper].some(v => v?.toLowerCase().includes(search.toLowerCase()))), [eligible, search])
  const selectableIds = filtered.filter(isReady).map(c => c.id)
  const allSelected = selectableIds.length > 0 && selectableIds.every(id => selected.has(id))

  function toggle(id: string) { setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n }) }
  function toggleAll() { setSelected(allSelected ? new Set() : new Set(selectableIds)) }

  async function run() {
    setBusy(true); setMsg(null)
    try {
      const tricoOptions = Object.fromEntries(Array.from(selected).map(id => [id, optFor(id)]))
      const d = await api('/api/automation-jobs', { method: 'POST', body: JSON.stringify({ kind, cdnIds: Array.from(selected), dryRun: testMode, tricoOptions }) })
      setMsg({ ok: d.queued > 0, text: `${d.queued} queued${d.skipped?.length ? `, ${d.skipped.length} skipped` : ''}`, skipped: d.skipped })
      setSelected(new Set()); await load()
      if (d.queued > 0) drive()
    } catch (e: any) { setMsg({ ok: false, text: e.message }) }
    finally { setBusy(false) }
  }

  async function cancel(id: string) { try { await api(`/api/automation-jobs?id=${id}`, { method: 'DELETE' }); load() } catch (e: any) { setMsg({ ok: false, text: e.message }) } }

  async function toggleNavis(id: string, value: boolean) {
    try { await api(`/api/automation-jobs?id=${id}`, { method: 'PATCH', body: JSON.stringify({ navisDone: value }) }); load() }
    catch (e: any) { setMsg({ ok: false, text: e.message }) }
  }
  // Corrects the CDN's CUSDEC number and clears this job's "Navis done" mark, then immediately
  // queues a fresh, live (not test-mode) run for that CDN — the user is fixing a real failure, not
  // previewing one.
  async function fixCusdec(job: Job, cusdecNumber: string) {
    setMsg(null)
    try {
      await api(`/api/automation-jobs?id=${job.id}`, { method: 'PATCH', body: JSON.stringify({ cusdecNumber }) })
      const d = await api('/api/automation-jobs', { method: 'POST', body: JSON.stringify({ kind, cdnIds: [job.cdn_id], dryRun: false }) })
      setMsg({ ok: d.queued > 0, text: d.queued > 0 ? `Retrying ${job.container_no} with corrected CUSDEC` : `Could not retry: ${d.skipped?.[0]?.reason || 'not queued'}` })
      await load()
      if (d.queued > 0) drive()
    } catch (e: any) { setMsg({ ok: false, text: e.message }) }
  }
  async function deleteJob(id: string) {
    if (!confirm('Delete this run from the list? This cannot be undone.')) return
    try { await api(`/api/automation-jobs?id=${id}`, { method: 'DELETE' }); load() } catch (e: any) { setMsg({ ok: false, text: e.message }) }
  }
  // For a CDN with no job yet (e.g. Navis was done by hand, outside the automation) — marks it so
  // a run started from here skips Navis and goes straight to SLPA.
  async function markNavis(cdnId: string, value: boolean) {
    try { await api(`/api/automation-jobs?kind=${kind}&cdnId=${cdnId}`, { method: 'PATCH', body: JSON.stringify({ navisDone: value }) }); load() }
    catch (e: any) { setMsg({ ok: false, text: e.message }) }
  }

  return (
    <div className="space-y-5 max-w-4xl">
      <div className="card">
        <h2 className="font-semibold text-gray-900 text-sm mb-1 flex items-center gap-2">{icon}{title}</h2>
        <p className="text-xs text-gray-500 mb-3">{description}</p>
        {!autoRun && (
          <p className="text-xs mb-3 bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-2.5 flex items-start gap-1.5">
            <AlertTriangle size={13} className="mt-0.5 flex-shrink-0"/>
            <span><b>Run is switched off on purpose.</b> Selecting rows works, but nothing will be sent.</span>
          </p>
        )}
        {autoRun && <RunnerInfo driving={driving}/>}
        {autoRun && (
          <label className="flex items-start gap-2 text-xs mb-3 bg-amber-50 border border-amber-200 rounded-lg p-2.5 cursor-pointer">
            <input type="checkbox" checked={testMode} onChange={e => setTestMode(e.target.checked)} className="mt-0.5"/>
            {kind === 'trico_gate_pass' ? (
              <span><b>Test mode</b> — resolves every field (shipper, driver, wharf clerk, container size...) and records what would be sent, but does <b>not</b> submit anything to Trico. Untick only after the resolved fields look right.{!testMode && <b className="text-red-600"> LIVE: this will really create a Gate Pass on Trico (and spend account balance).</b>}</span>
            ) : (
              <span><b>Test mode</b> — fills the Navis form and takes a screenshot but does <b>not</b> save anything on Navis/SLPA. Untick only when the test screenshots look right.{!testMode && <b className="text-red-600"> LIVE: this will really enter data on Navis and SLPA.</b>}</span>
            )}
          </label>
        )}
        {kind === 'trico_gate_pass' && (
          <div className="flex items-center gap-4 mb-3 bg-gray-50 border border-gray-200 rounded-lg p-2.5">
            <span className="text-xs font-medium text-gray-600">Tick all:</span>
            {(['vgm', 'fumigation', 'quarantine'] as const).map(key => {
              const label = key === 'vgm' ? 'Container Weighing (VGM)' : key === 'fumigation' ? 'Fumigation' : 'Quarantine'
              const allOn = filtered.length > 0 && filtered.every(c => optFor(c.id)[key])
              return (
                <label key={key} className="flex items-center gap-1.5 text-xs text-gray-700 cursor-pointer">
                  <input type="checkbox" checked={allOn} onChange={e => setAllOpt(key, e.target.checked, filtered.map(c => c.id))}/>{label}
                </label>
              )
            })}
            <span className="text-[11px] text-gray-400">— sets every row below at once; each row can still be adjusted individually</span>
          </div>
        )}
        {extraHeader}
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <div className="relative flex-1 min-w-[180px]">
            <Search size={13} className="absolute left-2.5 top-2.5 text-gray-400"/>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search container, CUSDEC or shipper..." className="input pl-8"/>
          </div>
          <button onClick={toggleAll} disabled={!selectableIds.length} className="btn-secondary text-xs">{allSelected ? 'Clear' : 'Select all ready'}</button>
          <button onClick={run} disabled={busy || !selected.size || !autoRun} title={autoRun ? '' : 'Run is switched off'} className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 text-xs">
            {busy ? <Loader size={13} className="animate-spin"/> : <Zap size={13}/>}{testMode && autoRun ? 'Test run' : runLabel} ({selected.size})
          </button>
        </div>
        {msg && (
          <div className={`text-xs mb-3 ${msg.ok ? 'text-green-700' : 'text-red-600'}`}>
            <p className="flex items-center gap-1">{msg.ok ? <CheckCircle size={12}/> : <AlertTriangle size={12}/>}{msg.text}</p>
            {msg.skipped?.map(s => <p key={s.container} className="text-amber-600 pl-4">{s.container}: {s.reason}</p>)}
          </div>
        )}
        {loading ? <Loader size={16} className="animate-spin text-gray-400"/> : (
          <div className="border border-gray-100 rounded-lg divide-y divide-gray-100 max-h-96 overflow-y-auto">
            {filtered.map(c => {
              const ready = isReady(c)
              const opts = optFor(c.id)
              return (
                <div key={c.id} className={`flex items-center gap-3 px-3 py-2 text-xs ${!ready ? 'opacity-60' : ''}`}>
                  <label className={`flex items-center gap-3 flex-1 min-w-0 ${ready ? 'cursor-pointer hover:bg-gray-50' : ''}`}>
                    <input type="checkbox" disabled={!ready} checked={selected.has(c.id)} onChange={() => toggle(c.id)} className="w-3.5 h-3.5 flex-shrink-0"/>
                    <div className="flex-1 min-w-0">
                      <p className="font-mono font-semibold text-gray-800">{c.container_no} <span className="font-sans font-normal text-gray-400">· {c.cusdec_number}</span></p>
                      <p className="text-gray-500 truncate">{c.shipper}</p>
                    </div>
                  </label>
                  {kind === 'trico_gate_pass' && (
                    <div className="flex gap-2 flex-shrink-0 text-[10px] text-gray-500">
                      <label className="flex items-center gap-1 cursor-pointer" title="Container Weighing (VGM)">
                        <input type="checkbox" checked={opts.vgm} onChange={e => setRowOpt(c.id, 'vgm', e.target.checked)}/>VGM
                      </label>
                      <label className="flex items-center gap-1 cursor-pointer" title="Fumigation">
                        <input type="checkbox" checked={opts.fumigation} onChange={e => setRowOpt(c.id, 'fumigation', e.target.checked)}/>Fumi
                      </label>
                      <label className="flex items-center gap-1 cursor-pointer" title="Quarantine">
                        <input type="checkbox" checked={opts.quarantine} onChange={e => setRowOpt(c.id, 'quarantine', e.target.checked)}/>Qtn
                      </label>
                    </div>
                  )}
                  {kind === 'barcode_enter' && (
                    <button onClick={() => markNavis(c.id, !c.navisDone)}
                      className={`text-[10px] flex-shrink-0 hover:underline ${c.navisDone ? 'text-green-600' : 'text-gray-400'}`}
                      title="Mark whether Navis was already done for this CDN (e.g. by hand) — a run then skips straight to SLPA">
                      {c.navisDone ? 'Navis ✓' : 'Navis OK?'}
                    </button>
                  )}
                  <div className="flex gap-1 flex-shrink-0">{needs.map(p => <Badge key={p} ok={c.ready[p]} label={p.toUpperCase()}/>)}</div>
                </div>
              )
            })}
            {!filtered.length && <p className="text-xs text-gray-400 text-center py-8">Nothing eligible right now</p>}
          </div>
        )}
        <JobsTable jobs={jobs} kind={kind} onCancel={cancel} onDelete={deleteJob} onToggleNavis={toggleNavis} onFixCusdec={fixCusdec} isAdmin={isAdmin}/>
      </div>
    </div>
  )
}

// ── Shipper → Navis / SLPA / Trico login mapping (admin) ───────────────────
function ShipperLoginsPanel() {
  const [data, setData] = useState<{ shippers: { key: string; name: string }[]; mappings: any[]; credentials: { id: string; identity_name: string; url: string; username: string | null }[] } | null>(null)
  const [draft, setDraft] = useState<Record<string, { navis: string; slpa: string; trico: string }>>({})
  const [savingKey, setSavingKey] = useState('')
  const [msg, setMsg] = useState('')

  async function load() {
    try {
      const d = await api('/api/shipper-credential-map')
      setData(d)
      const next: typeof draft = {}
      for (const m of d.mappings) next[m.shipper_key] = { navis: m.navis_credential_id || '', slpa: m.slpa_credential_id || '', trico: m.trico_credential_id || '' }
      setDraft(next)
    } catch (e: any) { setMsg(e.message) }
  }
  useEffect(() => { load() }, [])

  // Each dropdown only lists the saved logins whose Login URL belongs to that portal
  // (n4cap → Navis, n4cms → SLPA, tricologi → Trico).
  const optionsFor = (portal: 'navis' | 'slpa' | 'trico') => (data?.credentials || []).filter(c => portalOfCredential(c) === portal)

  async function save(s: { key: string; name: string }) {
    const d = draft[s.key] || { navis: '', slpa: '', trico: '' }
    setSavingKey(s.key); setMsg('')
    try {
      await api('/api/shipper-credential-map', { method: 'POST', body: JSON.stringify({ shipper_name: s.name, navis_credential_id: d.navis, slpa_credential_id: d.slpa, trico_credential_id: d.trico }) })
      setMsg(`✓ Saved ${s.name}`)
    } catch (e: any) { setMsg(`✗ ${e.message}`) }
    finally { setSavingKey('') }
  }

  const set = (key: string, field: 'navis' | 'slpa' | 'trico', v: string) => setDraft(p => {
    const cur = p[key] || { navis: '', slpa: '', trico: '' }
    return { ...p, [key]: { ...cur, [field]: v } }
  })

  return (
    <div className="card">
      <h2 className="font-semibold text-gray-900 text-sm mb-1 flex items-center gap-2"><Users size={15}/>Shipper logins</h2>
      <p className="text-xs text-gray-500 mb-3">Pick which saved Navis / SLPA / Trico login each shipper uses. Logins themselves are added in Settings → Credentials; the shipper list is every exporter name in the CUSDEC database.</p>
      {msg && <p className={`text-xs mb-2 ${msg.startsWith('✓') ? 'text-green-600' : 'text-red-600'}`}>{msg}</p>}
      {!data ? <Loader size={16} className="animate-spin text-gray-400"/> : (
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {data.shippers.map(s => (
            <div key={s.key} className="border border-gray-100 rounded-lg p-2.5">
              <p className="text-xs font-semibold text-gray-800 mb-1.5 truncate">{s.name}</p>
              <div className="grid grid-cols-3 gap-2">
                {(['navis', 'slpa', 'trico'] as const).map(p => (
                  <select key={p} value={draft[s.key]?.[p] || ''} onChange={e => set(s.key, p, e.target.value)} className="input text-xs py-1">
                    <option value="">{p.toUpperCase()} — none</option>
                    {optionsFor(p).map(c => <option key={c.id} value={c.id}>{c.identity_name}{c.username ? ` (${c.username})` : ''}</option>)}
                  </select>
                ))}
              </div>
              <button onClick={() => save(s)} disabled={savingKey === s.key} className="text-[11px] text-blue-600 hover:underline mt-1.5 disabled:opacity-50">
                {savingKey === s.key ? 'Saving...' : 'Save'}
              </button>
            </div>
          ))}
          {!data.shippers.length && <p className="text-xs text-gray-400">No shippers found in the CDN database yet.</p>}
        </div>
      )}
    </div>
  )
}

export function BarcodeEnterPanel() {
  const { isAdmin } = usePermission()
  const [showLogins, setShowLogins] = useState(false)
  return (
    <QueuePanel kind="barcode_enter" title="Barcode Enter" icon={<BarcodeIcon size={15}/>} needs={['navis', 'slpa']} runLabel="Run Barcode Enter" autoRun
      description="CDNs with no barcode yet. Select the ones to run: the server logs in to Navis once and enters all of them, then logs in to SLPA once and completes each one (consolidation, slip, print). The printed barcode PDF is saved into the system and notified (reason: Container Moved). A CDN that hits an error is skipped and shown in Dashboard → Automate Errors."
      extraHeader={isAdmin ? (
        <div className="mb-3">
          <button onClick={() => setShowLogins(s => !s)} className="text-xs text-blue-600 hover:underline flex items-center gap-1"><Users size={12}/>Shipper logins {showLogins ? '▲' : '▼'}</button>
          {showLogins && <div className="mt-2"><ShipperLoginsPanel/></div>}
        </div>
      ) : undefined}
    />
  )
}

export function TricoGatePassPanel() {
  return (
    <QueuePanel kind="trico_gate_pass" title="Trico Gate Pass Enter" icon={<Truck size={15}/>} needs={['trico']} runLabel="Run Gate Pass Enter" autoRun
      description="Only CDNs with no gate add time yet are listed here. Run Trico Checking first, so containers that already have a gate pass on Trico are filled in and drop off this list. The server logs in to Trico and submits the New Export Gate Pass form (shipper, CUSDEC, vessel/voyage, driver and wharf clerk are matched automatically — Container Weighing/Fumigation/Quarantine are set per row below, ticked Yes by default). A CDN that can't be mapped (no driver match, no wharf number set, etc.) is skipped and shown in Dashboard → Automate Errors."/>
  )
}

// ── Trico Checking ──────────────────────────────────────────────────────────
interface GateItem { id: string; cusdec_number: string; container_no: string; shipper: string; gate_add_time: string | null; gate_in_time: string | null; gate_out_time: string | null; trico_checked_at: string | null; trico_check_note: string | null; pending: boolean }

export function TricoCheckPanel({ scheduler }: { scheduler: ReactNode }) {
  const [items, setItems] = useState<GateItem[]>([])
  const [pending, setPending] = useState(0)
  const [search, setSearch] = useState('')
  const [onlyPending, setOnlyPending] = useState(true)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState('')
  const [rawSample, setRawSample] = useState<any[] | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try { const d = await api('/api/trico-check'); setItems(d.items || []); setPending(d.pending || 0) }
    catch (e: any) { setError(e.message) }
  }, [])
  useEffect(() => { load(); const t = setInterval(load, 15_000); return () => clearInterval(t) }, [load])

  // Runs in batches of 5 so no single request runs long; stops on the first
  // batch that makes no progress (e.g. the lookup isn't configured yet).
  async function run(ids?: string[]) {
    setRunning(true); setError(''); setRawSample(null)
    let checked = 0, updated = 0, errors = 0
    const before = new Date().toISOString()   // this sweep's start — rows checked during it aren't re-picked
    try {
      const queue = ids ? [...ids] : null
      for (let guard = 0; guard < 400; guard++) {
        const batchIds = queue ? queue.splice(0, 5) : undefined
        if (queue && !batchIds?.length) break
        setProgress(`Checking… ${checked} done · ${updated} updated${errors ? ` · ${errors} errors` : ''}`)
        const d = await api('/api/trico-check', { method: 'POST', body: JSON.stringify({ cdnIds: batchIds, limit: 5, before: queue ? undefined : before }) })
        checked += d.checked || 0; updated += d.updated || 0
        const errs = (d.results || []).filter((r: any) => r.outcome === 'error')
        errors += errs.length
        if (d.rawSample?.length) setRawSample(d.rawSample)
        if (errs.length && errs.length === (d.results || []).length) { setError(errs[0].note); break }
        if (!queue && !d.remaining) break
        if (!d.results?.length) break
      }
      setProgress(`Done — ${checked} checked, ${updated} updated${errors ? `, ${errors} errors` : ''}.`)
    } catch (e: any) { setError(e.message) }
    finally { setRunning(false); load() }
  }

  const shown = items.filter(i => (!onlyPending || i.pending) && (!search || [i.container_no, i.cusdec_number, i.shipper].some(v => v?.toLowerCase().includes(search.toLowerCase()))))

  return (
    <div className="card max-w-5xl">
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <h2 className="font-semibold text-gray-900 text-sm flex items-center gap-2"><Truck size={15}/>Trico Checking</h2>
        <div className="flex gap-2">
          <button onClick={load} className="btn-secondary text-xs flex items-center gap-1"><RefreshCw size={12}/></button>
          <button onClick={() => run()} disabled={running || !pending} className="btn-secondary flex items-center gap-2 text-xs">
            {running ? <Loader size={13} className="animate-spin"/> : <Zap size={13}/>}Check all pending ({pending})
          </button>
        </div>
      </div>
      <p className="text-xs text-gray-500 mb-3">Looks each CDN's container up on Trico using the shipper's Trico login. Fills Gate Add / Gate In / Gate Out only when the container <b>and</b> its CUSDEC match, and only into fields that are still empty. Containers not on Trico, with a different CUSDEC, or with nothing new are skipped and re-checked on the next run.</p>
      <div className="mb-3">{scheduler}</div>
      {progress && <p className="text-xs text-gray-600 mb-2">{progress}</p>}
      {error && <p className="text-xs text-red-600 mb-2 flex items-start gap-1"><AlertTriangle size={13} className="mt-0.5 flex-shrink-0"/>{error}</p>}
      {rawSample && (
        <details className="mb-3 text-[11px] bg-amber-50 border border-amber-200 rounded-lg p-2">
          <summary className="cursor-pointer text-amber-700">Trico gate pass found but not matched — what the View page contained (send this if the CUSDEC / times look wrong)</summary>
          <pre className="overflow-x-auto mt-1">{JSON.stringify(rawSample, null, 2)}</pre>
        </details>
      )}
      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search container, CUSDEC or shipper..." className="input max-w-sm"/>
        <label className="text-xs text-gray-600 flex items-center gap-1.5 cursor-pointer"><input type="checkbox" checked={onlyPending} onChange={e => setOnlyPending(e.target.checked)}/>Only rows still missing gate data</label>
      </div>
      <div className="overflow-x-auto border border-gray-100 rounded-lg max-h-[28rem] overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 text-gray-500 sticky top-0">
            <tr><th className="text-left p-2">Container</th><th className="text-left p-2">CUSDEC</th><th className="text-left p-2">Gate Add</th><th className="text-left p-2">Gate In</th><th className="text-left p-2">Gate Out</th><th className="text-left p-2">Last check</th><th/></tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {shown.map(i => (
              <tr key={i.id}>
                <td className="p-2 font-mono font-semibold">{i.container_no}</td>
                <td className="p-2">{i.cusdec_number}</td>
                <td className="p-2">{i.gate_add_time || '—'}</td>
                <td className="p-2">{i.gate_in_time || '—'}</td>
                <td className="p-2">{i.gate_out_time || '—'}</td>
                <td className="p-2 text-gray-500">{fmt(i.trico_checked_at)}{i.trico_check_note && <span className="block text-[10px] text-gray-400">{i.trico_check_note}</span>}</td>
                <td className="p-2"><button onClick={() => run([i.id])} disabled={running || !i.pending} className="text-blue-600 hover:underline disabled:opacity-30">check</button></td>
              </tr>
            ))}
            {!shown.length && <tr><td colSpan={7} className="text-center text-gray-400 py-8">Nothing to show</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}
