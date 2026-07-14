import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/router'
import AdminLayout, { usePermission } from '@/components/admin/AdminLayout'
import { authHeader } from '@/lib/supabase'
import { yearOf } from '@/lib/flexibleDate'
import {
  Zap, Barcode as BarcodeIcon, Truck, RefreshCw,
  ClipboardCheck, ShieldCheck, Loader, Search, Copy, Plus, Trash2,
  StickyNote, Save, Mail, CheckSquare, Square, AlertTriangle, Clock, Ship,
  GitMerge, ExternalLink,
} from 'lucide-react'

type AutomationTab =
  | 'barcode' | 'trico' | 'data-updates'
  | 'boat-note-check' | 'export-release' | 'vessel-trigger'
  | 'conflict-review' | 'cdn-approval' | 'notes'

interface CusdecRec { id: string; code: string; number: string; date: string; exporter: string; consignee: string; vessel: string; voyage_no: string; bl_no: string; gross_mass: string; net_mass: string; discharge_port: string; location_of_goods: string; cap: string; hs_code: string; preference: string; procedure_code: string; delivery_terms: string; amount: string; pkges: string; export_release_passed?: boolean; tin_vat?: string }

// The stored CUSDEC number often carries its serial letter/space (e.g.
// "E 38812") — the Customs lookup form wants just the digits.
function cleanCusdecNumber(raw: string): string { return (raw || '').replace(/\D/g, '') }
interface CdnRec { id: string; code: string; cusdec_number: string; shipper: string; consignee: string; container_no: string; goods_description: string; gross_mass: string; vessel: string; voyage: string; voyage_date: string; bl_no: string; slpa_no: string; voc: string; coc: string; lorry_no: string; trailer_no: string; loading_port: string; discharge_port: string; driver_name: string; pkg_no: string; pkg_type: string; volume: string; seal_no: string; con_type: string; marks: string; cdn_no: string; boat_note_passed?: boolean; export_release_passed?: boolean }

const SUB_TABS: { key: AutomationTab; label: string; icon: any; permission: string }[] = [
  { key: 'barcode', label: 'Barcode Enter', icon: BarcodeIcon, permission: 'section:automation.barcode-enter' },
  { key: 'trico', label: 'Trico Gate Passes', icon: Truck, permission: 'section:automation.trico-gate-pass' },
  { key: 'data-updates', label: 'Data Updates', icon: RefreshCw, permission: 'section:automation.data-updates' },
  { key: 'boat-note-check', label: 'Boat Note Check', icon: ClipboardCheck, permission: 'section:automation.boat-note-check' },
  { key: 'export-release', label: 'Export Release Check', icon: ShieldCheck, permission: 'section:automation.export-release-check' },
  { key: 'vessel-trigger', label: 'Vessel Triggers', icon: Ship, permission: 'section:automation.vessel-trigger' },
  { key: 'conflict-review', label: 'Conflict Review', icon: GitMerge, permission: 'section:automation.conflict-review' },
  { key: 'cdn-approval', label: 'CDN Approval', icon: CheckSquare, permission: 'section:automation.cdn-approval' },
  { key: 'notes', label: 'System Logic & Integration Notes', icon: StickyNote, permission: 'section:automation.notes' },
]

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      {children}
    </div>
  )
}

// Shared "not connected yet" call for the RPA-dependent actions — see
// src/pages/api/automation-rpa.ts for why these are stubbed rather than
// guessed: getting a live gate-pass/customs submission wrong has real
// consequences, so this needs a supervised build session against the real
// site instead of best-guess selectors.
async function notConnectedYet(action: string): Promise<string> {
  const res = await fetch('/api/automation-rpa', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action }),
  })
  const d = await res.json()
  return d.error || 'Not connected yet'
}

function AutomationContent() {
  const { has } = usePermission()
  const visibleTabs = SUB_TABS.filter(t => has(t.permission))
  const router = useRouter()
  const [tab, setTab] = useState<AutomationTab>(visibleTabs[0]?.key || 'barcode')
  // Lets the Dashboard's pending-work cards deep-link straight into the
  // relevant sub-tab, e.g. /admin/automation?tab=export-release.
  useEffect(() => {
    const q = router.query.tab
    if (typeof q === 'string' && visibleTabs.some(t => t.key === q)) setTab(q as AutomationTab)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.query.tab])

  return (
    <div className="p-6">
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><Zap size={20} className="text-amber-500"/>Automation</h1>
        <p className="text-gray-500 text-sm mt-0.5">Cusdec XML, CDN text output, port/gov portal shortcuts, and Boat Note tools in one place</p>
      </div>

      <div className="flex gap-1 mb-6 bg-gray-100 p-1 rounded-xl w-fit flex-wrap">
        {visibleTabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
              tab === t.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}>
            <t.icon size={13}/>{t.label}
          </button>
        ))}
      </div>

      {tab === 'barcode' && <RpaStub title="Barcode Enter" action="barcode-enter" description="Auto-fills the Barcode entry on the port system from a CDN's data, or lets you enter it manually."/>}
      {tab === 'trico' && <TricoGatePasses/>}
      {tab === 'data-updates' && <DataUpdates/>}
      {tab === 'boat-note-check' && <BoatNoteCheckPanel/>}
      {tab === 'export-release' && <ExportReleaseCheckPanel/>}
      {tab === 'vessel-trigger' && <VesselTriggerPanel/>}
      {tab === 'conflict-review' && <ConflictReviewPanel/>}
      {tab === 'cdn-approval' && <CdnApprovalPanel/>}
      {tab === 'notes' && <SystemNotes/>}
    </div>
  )
}

// Credentials Settings itself now lives on the Settings page
// (settings.tsx, section:settings.credentials) — this interface stays here
// since TricoGatePasses below still reads saved credentials.
interface Credential { id: string; identity_name: string; url: string; username: string | null; created_at: string }

// ── 2.4 Barcode Enter (stub) & Trico Gate Passes ─────────────────────────
function RpaStub({ title, action, description }: { title: string; action: string; description: string }) {
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  async function run() {
    setBusy(true)
    setMsg(await notConnectedYet(action))
    setBusy(false)
  }
  return (
    <div className="card max-w-xl">
      <h2 className="font-semibold text-gray-900 text-sm mb-2">{title}</h2>
      <p className="text-xs text-gray-500 mb-4">{description}</p>
      <button onClick={run} disabled={busy} className="btn-primary flex items-center gap-2">
        {busy ? <Loader size={14} className="animate-spin"/> : <Zap size={14}/>}Run
      </button>
      {msg && <p className="text-xs text-amber-600 mt-3 flex items-center gap-1"><AlertTriangle size={13}/>{msg}</p>}
    </div>
  )
}

function TricoGatePasses() {
  const [creds, setCreds] = useState<Credential[]>([])
  const [username, setUsername] = useState('')
  const [count, setCount] = useState('1')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    authHeader().then(headers => fetch('/api/automation-credentials', { headers })).then(r => r.json()).then(d => setCreds((d.credentials || []).filter((c: Credential) => c.identity_name === 'Trico'))).catch(() => {})
  }, [])

  // Trico Gate Pass Trigger: ask which username + how many gate passes,
  // exactly as the spec calls for — the actual RPA submission is stubbed
  // (see automation-rpa.ts) pending a supervised build session.
  async function trigger() {
    if (!username) { setMsg('Pick a username first'); return }
    setBusy(true)
    setMsg(await notConnectedYet(`trico-gate-pass (user=${username}, count=${count})`))
    setBusy(false)
  }

  return (
    <div className="card max-w-xl">
      <h2 className="font-semibold text-gray-900 text-sm mb-2">Trico Gate Pass Enter</h2>
      <p className="text-xs text-gray-500 mb-4">Shortcut from CDN data, or fill manually below.</p>
      <div className="grid grid-cols-2 gap-3 mb-4">
        <Field label="Username">
          <select value={username} onChange={e => setUsername(e.target.value)} className="input">
            <option value="">Select...</option>
            {creds.map(c => <option key={c.id} value={c.username || c.identity_name}>{c.username || c.identity_name}</option>)}
          </select>
        </Field>
        <Field label="Number of Gate Passes"><input type="number" min="1" value={count} onChange={e => setCount(e.target.value)} className="input"/></Field>
      </div>
      <button onClick={trigger} disabled={busy} className="btn-primary flex items-center gap-2">
        {busy ? <Loader size={14} className="animate-spin"/> : <Truck size={14}/>}Gate Pass Enter
      </button>
      {msg && <p className="text-xs text-amber-600 mt-3 flex items-center gap-1"><AlertTriangle size={13}/>{msg}</p>}
    </div>
  )
}

// ── Data Updates ───────────────────────────────────────────────────────────
function DataUpdates() {
  return (
    <div className="card max-w-xl">
      <h2 className="font-semibold text-gray-900 text-sm mb-2">Data Updates</h2>
      <p className="text-xs text-gray-500 mb-4">To manually correct any CUSDEC/CDN/Barcode/Boat Note row (fix a typo, update a status, etc.), use the Database admin page — same tables this Automation tab reads from.</p>
      <a href="/admin/database" className="btn-primary inline-flex items-center gap-2"><RefreshCw size={14}/>Open Database</a>
    </div>
  )
}

// ── Status Checks (Boat Note Check / Export Release Check) ──────────
// Both hit the real public (no-login) lookup on each site directly — see
// src/pages/api/boat-note-check.ts and export-release-check.ts for how the
// request/response shape was confirmed against the live pages. Each offers
// a Manual Trigger (check one picked item) and an Auto Trigger (loop every
// item that still needs checking) — a passed Boat Note check turns that CDN
// blue; a passed Export Release turns the CUSDEC (and its already-blue CDNs)
// green. Export Release only ever runs against CDNs/CUSDECs that already
// passed Boat Note.
// Shared by both check panels — plain-minutes interval editor + "last ran"
// readout for the scheduled cron (cron-check-pending.ts), which is what
// actually applies this interval; this control only reads/writes the number.
function SchedulerControl({ panel, label }: { panel: 'boat_note' | 'export_release' | 'vessel_trigger'; label: string }) {
  const [minutes, setMinutes] = useState<string>('')
  const [lastRunAt, setLastRunAt] = useState<string | null>(null)
  const [enabled, setEnabled] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savedMsg, setSavedMsg] = useState('')
  const [toggling, setToggling] = useState(false)

  async function load(silent = false) {
    const res = await fetch('/api/automation-runs', { headers: await authHeader() })
    const d = await res.json()
    const row = (d.runs || []).find((r: any) => r.panel === panel)
    if (!row) return
    // Only the initial (non-silent) load syncs the minutes input — a
    // background poll shouldn't overwrite digits the user is mid-typing.
    if (!silent) setMinutes(String(row.interval_minutes))
    setLastRunAt(row.last_run_at)
    setEnabled(row.enabled !== false)
  }
  useEffect(() => {
    load()
    // "Last ran" is now genuinely live (the hourly GitHub Actions ping keeps
    // bumping it) — poll so it updates here without a page refresh.
    const t = setInterval(() => load(true), 15000)
    return () => clearInterval(t)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    setSaving(true); setSavedMsg('')
    try {
      const res = await fetch('/api/automation-runs', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ panel, interval_minutes: Number(minutes) }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      setSavedMsg('✓ Saved')
    } catch (e: any) {
      setSavedMsg(`✗ ${e.message}`)
    } finally {
      setSaving(false)
    }
  }

  // Persistent on/off switch — the cron itself already runs independent of
  // any browser session, so "persists across refresh" is automatic here;
  // this is just whether cron-check-pending.ts is allowed to act on this
  // panel or should skip it entirely until switched back on.
  async function toggleEnabled() {
    const next = !enabled
    setToggling(true)
    try {
      const res = await fetch('/api/automation-runs', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ panel, enabled: next }),
      })
      if (res.ok) setEnabled(next)
    } finally {
      setToggling(false)
    }
  }

  return (
    <div>
      <div className="flex items-center gap-2 text-xs flex-wrap">
        <button onClick={toggleEnabled} disabled={toggling}
          className={`flex items-center gap-1.5 px-2 py-1 rounded-full font-medium disabled:opacity-50 ${
            enabled ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-gray-100 text-gray-500 border border-gray-200'
          }`}>
          <span className={`w-1.5 h-1.5 rounded-full ${enabled ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`}/>
          {enabled ? 'Live · Active' : 'Paused'}
        </button>
        <Clock size={13} className="text-gray-400"/>
        <span className="text-gray-500">{label} every</span>
        <input type="number" min={1} value={minutes} onChange={e => setMinutes(e.target.value)}
          className="input text-xs w-16 py-1"/>
        <span className="text-gray-500">min</span>
        <button onClick={save} disabled={saving} className="text-blue-600 hover:underline disabled:opacity-50">Save</button>
        {savedMsg && <span className={savedMsg.startsWith('✓') ? 'text-green-600' : 'text-red-600'}>{savedMsg}</span>}
        {lastRunAt && <span className="text-gray-400">· last ran {new Date(lastRunAt).toLocaleString('en-GB')}</span>}
      </div>
      <p className="text-[11px] text-gray-400 mt-1">This project's Vercel plan (Hobby) only fires the scheduler once/day — a shorter interval here just means it won't skip a day early once you upgrade to Pro; it can't run more than once a day until then.</p>
    </div>
  )
}

// Orphaned Data Monitor — surfaces records that can never be auto-checked
// (missing the one field the lookup needs) without cluttering the main
// pending queue above; collapsed by default since this is an audit view,
// not something that needs attention every time the panel opens.
function OrphanedDataMonitor({ label, count, items }: { label: string; count: number; items: { id: string; title: string; subtitle?: string }[] }) {
  const [open, setOpen] = useState(false)
  if (count === 0) return null
  return (
    <div className="mt-3 border-t border-gray-100 pt-2">
      <button onClick={() => setOpen(o => !o)} className="flex items-center gap-1.5 text-xs text-amber-600 hover:underline">
        <AlertTriangle size={12}/> {label} ({count}) {open ? '▲' : '▼'}
      </button>
      {open && (
        <div className="mt-2 space-y-1 max-h-40 overflow-y-auto">
          {items.map(it => (
            <div key={it.id} className="text-[11px] border border-amber-100 bg-amber-50 rounded p-1.5">
              <p className="font-medium text-amber-800">{it.title}</p>
              {it.subtitle && <p className="text-amber-600 truncate">{it.subtitle}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function useTriggerTimestamp(field: 'boatNote' | 'exportRelease') {
  const [info, setInfo] = useState<{ time: string; cusdec?: string; user?: string } | null>(null)
  useEffect(() => {
    authHeader().then(h =>
      fetch('/api/trigger-timestamps', { headers: h })
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d) setInfo(d[field] || null) })
        .catch(() => {})
    )
  }, [field])
  function fmt(iso: string | null | undefined) {
    if (!iso) return null
    try { return new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Colombo', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) } catch { return iso }
  }
  return info ? fmt(info.time) : null
}

function BoatNoteCheckPanel() {
  const lastTriggered = useTriggerTimestamp('boatNote')
  const [cdns, setCdns] = useState<CdnRec[]>([])
  const [cusdecs, setCusdecs] = useState<CusdecRec[]>([])
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [busy, setBusy] = useState(false)
  const [autoBusy, setAutoBusy] = useState(false)
  const [autoProgress, setAutoProgress] = useState('')
  const [error, setError] = useState('')
  const [result, setResult] = useState<{ containerNo: string; vessel: string; level: string; status: string; passed: boolean } | null>(null)
  // Ad-hoc check — a container number typed by hand, not picked from the
  // list on the left. Useful to test-check something that isn't (or isn't
  // yet) a CDN row in the database — no cdnId is sent, so nothing here ever
  // gets written to the database.
  const [adhocContainer, setAdhocContainer] = useState('')
  const [adhocBusy, setAdhocBusy] = useState(false)
  const [adhocError, setAdhocError] = useState('')
  const [adhocResult, setAdhocResult] = useState<{ containerNo: string; vessel: string; level: string; status: string; passed: boolean } | null>(null)

  async function load() {
    const [cr, dr] = await Promise.all([
      fetch('/api/list-records?table=cusdec&limit=500').then(r => r.json()),
      fetch('/api/list-records?table=cdn&limit=500').then(r => r.json()),
    ])
    setCusdecs(cr.records || [])
    setCdns(dr.records || [])
  }
  useEffect(() => {
    load()
    // Live — a container the hourly cron ping just passed (or an admin
    // action from elsewhere) shows blue here without a manual refresh. Only
    // the cusdec/cdn lists refresh; the search box, selection, and ad-hoc
    // form below are untouched by this.
    const t = setInterval(load, 15000)
    return () => clearInterval(t)
  }, [])

  // A CDN only counts as ready for auto-checking once its parent CUSDEC's
  // CAP is complete (every expected CDN has actually been uploaded) — same
  // rule ExportReleaseCheckPanel/isBoatNotePassed use. CAP not known at all
  // (blank/non-numeric) doesn't block it — there's nothing to wait for.
  // Manual Trigger (single-CDN, below) ignores this entirely by design.
  function isCapComplete(cdn: CdnRec): boolean {
    const cusdec = cusdecs.find(c => c.code === cdn.code && c.number === cdn.cusdec_number)
    const cap = parseInt(cusdec?.cap || '', 10)
    if (!cap || Number.isNaN(cap)) return true
    const own = cdns.filter(d => d.code === cdn.code && d.cusdec_number === cdn.cusdec_number)
    return own.length >= cap
  }

  const filtered = cdns.filter(c => !search || c.container_no?.toLowerCase().includes(search.toLowerCase()) || c.shipper?.toLowerCase().includes(search.toLowerCase()))
  const selected = cdns.find(c => c.id === selectedId) || null

  async function runOne(cdn: CdnRec) {
    const res = await fetch('/api/boat-note-check', {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
      body: JSON.stringify({ containerNo: cdn.container_no, cdnId: cdn.id }),
    })
    const d = await res.json()
    if (!res.ok) throw new Error(d.error)
    return d
  }

  async function manualTrigger() {
    if (!selected) return
    setBusy(true); setError(''); setResult(null)
    try {
      const d = await runOne(selected)
      setResult(d)
      if (d.passed) await load()
    } catch (e: any) { setError(e.message) }
    finally { setBusy(false) }
  }

  async function runAdhoc() {
    if (!adhocContainer.trim()) return
    setAdhocBusy(true); setAdhocError(''); setAdhocResult(null)
    try {
      const res = await fetch('/api/boat-note-check', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ containerNo: adhocContainer.trim() }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      setAdhocResult(d)
    } catch (e: any) { setAdhocError(e.message) }
    finally { setAdhocBusy(false) }
  }

  async function autoTrigger() {
    const pending = cdns.filter(c => !c.boat_note_passed && c.container_no && isCapComplete(c))
    if (!pending.length) { setAutoProgress('Nothing pending — every CAP-complete CDN already checked.'); return }
    setAutoBusy(true); setError('')
    let passedCount = 0
    for (let i = 0; i < pending.length; i++) {
      setAutoProgress(`Checking ${i + 1}/${pending.length} — ${pending[i].container_no}...`)
      try {
        const d = await runOne(pending[i])
        if (d.passed) passedCount++
      } catch { /* keep going through the rest of the batch */ }
      await new Promise(r => setTimeout(r, 400))
    }
    await load()
    setAutoProgress(`Done — ${passedCount}/${pending.length} newly passed.`)
    setAutoBusy(false)
  }

  function levelColorFor(level?: string) {
    return level === 'success' ? 'bg-green-50 border-green-200 text-green-700'
      : level === 'danger' ? 'bg-red-50 border-red-200 text-red-700'
      : 'bg-amber-50 border-amber-200 text-amber-700'
  }
  const levelColor = levelColorFor(result?.level)

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      <div className="card">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h2 className="font-semibold text-gray-900 text-sm">Select CDN</h2>
          <button onClick={autoTrigger} disabled={autoBusy} className="btn-secondary flex items-center gap-2 text-xs">
            {autoBusy ? <Loader size={13} className="animate-spin"/> : <Zap size={13}/>}Auto Trigger (all pending)
          </button>
        </div>
        <div className="mb-3"><SchedulerControl panel="boat_note" label="Auto-check"/></div>
        {autoProgress && <p className="text-xs text-gray-500 mb-2">{autoProgress}</p>}
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search container or shipper..." className="input mb-3"/>
        <div className="space-y-1 max-h-96 overflow-y-auto">
          {filtered.map(c => (
            <button key={c.id} onClick={() => setSelectedId(c.id)}
              className={`w-full text-left p-2.5 rounded-lg border-l-4 border text-xs ${
                selectedId === c.id ? 'bg-blue-50 border-blue-300' : 'border-gray-100 hover:bg-gray-50'
              } ${c.boat_note_passed ? '!border-l-blue-500' : '!border-l-transparent'}`}>
              <p className="font-bold text-gray-800">{c.container_no || '—'} {c.boat_note_passed && <span className="text-blue-600 font-normal">· passed</span>}</p>
              <p className="text-gray-600 truncate">{c.shipper?.slice(0, 40)}</p>
            </button>
          ))}
          {filtered.length === 0 && <p className="text-xs text-gray-400 text-center py-6">No CDNs found</p>}
        </div>
        <OrphanedDataMonitor
          label="Empty Data (no Container No.)"
          count={cdns.filter(c => !c.container_no).length}
          items={cdns.filter(c => !c.container_no).map(c => ({ id: c.id, title: c.cdn_no || '(no CDN No.)', subtitle: c.shipper }))}
        />
      </div>

      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-gray-900 text-sm">Manual Trigger</h2>
          {lastTriggered && (
            <span className="text-[11px] text-green-700 bg-green-50 border border-green-200 rounded-md px-2 py-0.5 flex items-center gap-1">
              <Clock size={10}/> Last: {lastTriggered}
            </span>
          )}
        </div>
        {!selected ? (
          <p className="text-xs text-gray-400 text-center py-12">Select a CDN to check</p>
        ) : (
          <>
            <p className="text-xs text-gray-500 mb-3">Container: <span className="font-mono font-semibold text-gray-800">{selected.container_no}</span></p>
            <button onClick={manualTrigger} disabled={busy} className="btn-primary flex items-center gap-2">
              {busy ? <Loader size={14} className="animate-spin"/> : <Search size={14}/>}Check Status
            </button>
            {error && <p className="text-xs text-red-600 mt-3 flex items-center gap-1"><AlertTriangle size={13}/>{error}</p>}
            {result && (
              <div className={`mt-4 border rounded-lg p-3 text-sm ${levelColor}`}>
                <p><span className="font-semibold">Container:</span> {result.containerNo}</p>
                {result.vessel && <p><span className="font-semibold">Vessel / Voyage:</span> {result.vessel}</p>}
                <p className="mt-1">{result.status}</p>
              </div>
            )}
          </>
        )}

        <div className="mt-6 pt-5 border-t border-gray-100">
          <h3 className="font-semibold text-gray-900 text-sm mb-1">Check any container number</h3>
          <p className="text-xs text-gray-400 mb-3">Not tied to a CDN in the database — nothing here gets saved, just checked.</p>
          <div className="flex gap-2">
            <input value={adhocContainer} onChange={e => setAdhocContainer(e.target.value)} placeholder="Container number..." className="input flex-1"/>
            <button onClick={runAdhoc} disabled={adhocBusy || !adhocContainer.trim()} className="btn-secondary flex items-center gap-2 flex-shrink-0">
              {adhocBusy ? <Loader size={14} className="animate-spin"/> : <Search size={14}/>}Check
            </button>
          </div>
          {adhocError && <p className="text-xs text-red-600 mt-3 flex items-center gap-1"><AlertTriangle size={13}/>{adhocError}</p>}
          {adhocResult && (
            <div className={`mt-3 border rounded-lg p-3 text-sm ${levelColorFor(adhocResult.level)}`}>
              <p><span className="font-semibold">Container:</span> {adhocResult.containerNo}</p>
              {adhocResult.vessel && <p><span className="font-semibold">Vessel / Voyage:</span> {adhocResult.vessel}</p>}
              <p className="mt-1">{adhocResult.status}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function ExportReleaseCheckPanel() {
  const lastTriggered = useTriggerTimestamp('exportRelease')
  const [cusdecs, setCusdecs] = useState<CusdecRec[]>([])
  const [cdns, setCdns] = useState<CdnRec[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [form, setForm] = useState({ officeCode: '', serial: 'E', cusdecNumber: '', cusdecYear: '', consigneeTIN: '' })
  const [busy, setBusy] = useState(false)
  const [autoBusy, setAutoBusy] = useState(false)
  const [autoProgress, setAutoProgress] = useState('')
  const [error, setError] = useState('')
  const [result, setResult] = useState<{ found: boolean; message?: string; text?: string; passed?: boolean | null; releaseDate?: string | null } | null>(null)

  async function load() {
    const [cr, dr] = await Promise.all([
      fetch('/api/list-records?table=cusdec&limit=500').then(r => r.json()),
      fetch('/api/list-records?table=cdn&limit=500').then(r => r.json()),
    ])
    setCusdecs(cr.records || [])
    setCdns(dr.records || [])
  }
  useEffect(() => {
    load()
    // Live — a CUSDEC the hourly cron ping just released shows green here
    // without a manual refresh.
    const t = setInterval(load, 15000)
    return () => clearInterval(t)
  }, [])

  // A CUSDEC only counts as "Boat Note passed" once every CDN row that
  // belongs to it (matched by code+number, same as the Overview page) is
  // itself boat_note_passed — matching the CAP is the give-away that there
  // aren't more containers still waiting to be checked.
  function boatNotePassed(c: CusdecRec): boolean {
    const own = cdns.filter(d => d.code === c.code && d.cusdec_number === c.number)
    if (!own.length) return false
    const cap = parseInt(c.cap || '', 10)
    if (cap && own.length < cap) return false
    return own.every(d => d.boat_note_passed)
  }

  // The list shows every CUSDEC that hasn't been released yet (blue-passed
  // or not) so any of them can be picked for a manual/ad-hoc check — but
  // Auto Trigger only ever runs on the blue (boat-note-passed) ones.
  const visibleCusdecs = cusdecs.filter(c => !c.export_release_passed)
  const eligible = visibleCusdecs.filter(boatNotePassed)
  const selected = visibleCusdecs.find(c => c.id === selectedId) || null

  // The CUSDEC's own tin_vat column (filled in when it was extracted/imported)
  // is the authoritative source — shipper_profiles.tin is only a fallback for
  // records that don't have one yet.
  async function resolveTin(c: CusdecRec): Promise<string> {
    if (c.tin_vat) return c.tin_vat
    const shipperName = (c.exporter || '').split('\n')[0].trim()
    try {
      const pr = await fetch(`/api/shipper-profile?shipper=${encodeURIComponent(shipperName)}`)
      return (await pr.json()).profile?.tin || ''
    } catch { return '' }
  }

  async function pickCusdec(id: string) {
    setSelectedId(id)
    const c = visibleCusdecs.find(x => x.id === id)
    if (!c) return
    const tin = await resolveTin(c)
    setForm({ officeCode: c.code || '', serial: 'E', cusdecNumber: cleanCusdecNumber(c.number), cusdecYear: yearOf(c.date), consigneeTIN: tin })
  }

  async function runOne(c: CusdecRec, tinOverride?: string) {
    const tin = tinOverride || await resolveTin(c)
    if (!tin) throw new Error(`No Company TIN found for CUSDEC E ${c.number} (not on the record or in the saved shipper profile) — enter it once manually first`)
    const res = await fetch('/api/export-release-check', {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
      body: JSON.stringify({ officeCode: c.code, serial: 'E', cusdecNumber: cleanCusdecNumber(c.number), cusdecYear: yearOf(c.date), consigneeTIN: tin, cusdecId: c.id }),
    })
    const d = await res.json()
    if (!res.ok) throw new Error(d.error)
    return d
  }

  // Works with or without a CUSDEC selected from the list on the left — if
  // nothing's selected this is a pure ad-hoc check against whatever was
  // typed into the form (cusdecId omitted, so export-release-check.ts never
  // touches the database for it).
  async function manualTrigger() {
    setBusy(true); setError(''); setResult(null)
    try {
      // Manual trigger uses whatever TIN is currently in the form (so a
      // just-typed correction is respected), and remembers it for next time
      // — only when it's tied to a real CUSDEC record.
      if (form.consigneeTIN && selected) {
        const shipperName = (selected.exporter || '').split('\n')[0].trim()
        authHeader().then(h => fetch('/api/shipper-profile', {
          method: 'POST', headers: { 'Content-Type': 'application/json', ...h },
          body: JSON.stringify({ shipper: shipperName, tin: form.consigneeTIN }),
        })).catch(() => {})
      }
      const res = await fetch('/api/export-release-check', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ ...form, cusdecId: selected?.id }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      setResult(d)
      if (d.passed && selected) await load()
    } catch (e: any) { setError(e.message) }
    finally { setBusy(false) }
  }

  async function autoTrigger() {
    const pending = eligible.filter(c => !c.export_release_passed)
    if (!pending.length) { setAutoProgress('Nothing pending — every eligible CUSDEC already checked.'); return }
    setAutoBusy(true); setError('')
    let passedCount = 0
    for (let i = 0; i < pending.length; i++) {
      setAutoProgress(`Checking ${i + 1}/${pending.length} — E ${pending[i].number}...`)
      try {
        const d = await runOne(pending[i])
        if (d.passed) passedCount++
      } catch { /* keep going through the rest of the batch */ }
      await new Promise(r => setTimeout(r, 400))
    }
    await load()
    setAutoProgress(`Done — ${passedCount}/${pending.length} newly passed.`)
    setAutoBusy(false)
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      <div className="card">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h2 className="font-semibold text-gray-900 text-sm">Select CUSDEC</h2>
          <button onClick={autoTrigger} disabled={autoBusy} className="btn-secondary flex items-center gap-2 text-xs">
            {autoBusy ? <Loader size={13} className="animate-spin"/> : <Zap size={13}/>}Auto Trigger (all pending)
          </button>
        </div>
        <div className="mb-3"><SchedulerControl panel="export_release" label="Auto-check"/></div>
        {autoProgress && <p className="text-xs text-gray-500 mb-2">{autoProgress}</p>}
        <p className="text-xs text-gray-400 mb-2">Blue-bordered = Boat Note passed, ready for Auto Trigger. Others can still be checked manually below.</p>
        <div className="space-y-1 max-h-96 overflow-y-auto">
          {visibleCusdecs.map(c => (
            <button key={c.id} onClick={() => pickCusdec(c.id)}
              className={`w-full text-left p-2.5 rounded-lg border-l-4 border text-xs ${
                selectedId === c.id ? 'bg-blue-50 border-blue-300' : 'border-gray-100 hover:bg-gray-50'
              } ${boatNotePassed(c) ? '!border-l-blue-400' : '!border-l-transparent'}`}>
              <p className="font-bold text-gray-800">E {c.number} {boatNotePassed(c) && <span className="text-blue-600 font-normal">· boat note passed</span>}</p>
              <p className="text-gray-600 truncate">{c.exporter?.slice(0, 40)}</p>
            </button>
          ))}
          {visibleCusdecs.length === 0 && <p className="text-xs text-gray-400 text-center py-6">No CUSDEC pending release</p>}
        </div>
        <OrphanedDataMonitor
          label="Non-Matched (no Company TIN on record)"
          count={eligible.filter(c => !c.tin_vat).length}
          items={eligible.filter(c => !c.tin_vat).map(c => ({ id: c.id, title: `E ${c.number}`, subtitle: c.exporter }))}
        />
      </div>

      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-gray-900 text-sm">Manual Trigger</h2>
          {lastTriggered && (
            <span className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-0.5 flex items-center gap-1">
              <Clock size={10}/> Last: {lastTriggered}
            </span>
          )}
        </div>
        <p className="text-xs text-gray-400 mb-3">
          {selected ? <>Checking E {selected.number} — <button onClick={() => { setSelectedId(''); setForm({ officeCode: '', serial: 'E', cusdecNumber: '', cusdecYear: '', consigneeTIN: '' }) }} className="text-blue-600 hover:underline">clear selection</button></>
            : 'No CUSDEC selected — type any values below to check ad-hoc (nothing gets saved to the database).'}
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-3">
          <Field label="Office Code"><input value={form.officeCode} onChange={e => setForm(f => ({ ...f, officeCode: e.target.value }))} className="input"/></Field>
          <Field label="Serial"><input value={form.serial} onChange={e => setForm(f => ({ ...f, serial: e.target.value }))} className="input"/></Field>
          <Field label="Cusdec Number"><input value={form.cusdecNumber} onChange={e => setForm(f => ({ ...f, cusdecNumber: e.target.value }))} className="input"/></Field>
          <Field label="Cusdec Year"><input value={form.cusdecYear} onChange={e => setForm(f => ({ ...f, cusdecYear: e.target.value }))} className="input"/></Field>
          <Field label="Company TIN"><input value={form.consigneeTIN} onChange={e => setForm(f => ({ ...f, consigneeTIN: e.target.value }))} className="input"/></Field>
        </div>
        <button onClick={manualTrigger} disabled={busy || !form.officeCode || !form.cusdecNumber || !form.cusdecYear || !form.consigneeTIN}
          className="btn-primary flex items-center gap-2">
          {busy ? <Loader size={14} className="animate-spin"/> : <Search size={14}/>}Check Status
        </button>
        {error && <p className="text-xs text-red-600 mt-3 flex items-center gap-1"><AlertTriangle size={13}/>{error}</p>}
        {result && !result.found && (
          <p className="text-xs text-amber-600 mt-3 flex items-center gap-1"><AlertTriangle size={13}/>{result.message}</p>
        )}
        {result?.found && (
          <>
            <p className={`text-xs font-semibold mt-3 ${result.passed ? 'text-green-600' : 'text-amber-600'}`}>
              {result.passed ? '✓ Export Release passed' : result.passed === false ? '✗ Not passed yet' : '⚠ Could not determine pass/fail — check the raw text below'}
            </p>
            <pre className="mt-2 border border-gray-200 rounded-lg p-3 text-xs bg-gray-50 whitespace-pre-wrap max-h-72 overflow-y-auto">{result.text}</pre>
          </>
        )}
      </div>
    </div>
  )
}

// ── Vessel Triggers ────────────────────────────────────────────────────────
interface VesselRow { id: string; terminal: string; vessel: string; voyage: string; opening_time: string; closing_time: string; etb: string; last_update: string }

function VesselTriggerPanel() {
  const [items, setItems] = useState<VesselRow[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [status, setStatus] = useState('')
  // The mount-only poll interval below closes over `load` as it was at mount
  // time — without this ref it would keep re-fetching with search='' forever
  // once the interval is set up, silently wiping out an active search result
  // every 15s. The ref always has the current value; `search` itself still
  // drives the input as normal.
  const searchRef = useRef(search)
  useEffect(() => { searchRef.current = search }, [search])

  async function load(silent = false) {
    if (!silent) setLoading(true)
    try {
      const params = new URLSearchParams()
      if (searchRef.current) params.set('search', searchRef.current)
      const res = await fetch(`/api/vessel-triggers?${params.toString()}`, { headers: await authHeader() })
      const d = await res.json()
      if (res.ok) setItems(d.items || [])
    } finally { if (!silent) setLoading(false) }
  }
  useEffect(() => {
    load()
    // Live — reflects a sync that just ran (manual or the hourly cron ping)
    // without a manual refresh.
    const t = setInterval(() => load(true), 15000)
    return () => clearInterval(t)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function triggerNow() {
    setSyncing(true); setStatus('')
    try {
      const res = await fetch('/api/vessel-trigger-sync', { method: 'POST', headers: await authHeader() })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      setStatus(`✓ Synced — ${d.fetched} fetched, ${d.inserted} new, ${d.updated} updated, ${d.unchanged} unchanged`)
      load()
    } catch (e: any) {
      setStatus(`✗ ${e.message}`)
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h2 className="font-semibold text-gray-900 text-sm">Vessel Schedule (Terminal / Vessel / Voyage / Opening / Closing / ETB)</h2>
        <button onClick={triggerNow} disabled={syncing} className="btn-secondary flex items-center gap-2 text-xs">
          {syncing ? <Loader size={13} className="animate-spin"/> : <Zap size={13}/>}Trigger Now
        </button>
      </div>
      <div className="mb-3"><SchedulerControl panel="vessel_trigger" label="Sync"/></div>
      {status && <p className={`text-xs mb-3 font-medium ${status.startsWith('✓') ? 'text-green-600' : 'text-red-600'}`}>{status}</p>}
      <div className="flex items-center gap-2 mb-3">
        <input value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => e.key === 'Enter' && load()}
          placeholder="Search vessel, voyage, or terminal..." className="input"/>
        <button onClick={() => load()} className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs text-white flex-shrink-0" style={{ background: '#1B3A5C' }}>
          <Search size={12}/> Search
        </button>
      </div>
      {loading ? (
        <div className="flex justify-center py-8"><Loader size={18} className="animate-spin text-gray-400"/></div>
      ) : items.length === 0 ? (
        <p className="text-xs text-gray-400 text-center py-6">No vessel schedule data yet — click Trigger Now to sync</p>
      ) : (
        <div className="overflow-x-auto max-h-[28rem] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 sticky top-0"><tr>
              {['Terminal', 'Vessel', 'Voyage', 'Opening', 'Closing', 'ETB', 'Last Updated'].map(h => (
                <th key={h} className="text-left px-2 py-1.5 text-gray-500 font-medium">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {items.map(r => (
                <tr key={r.id} className="border-t border-gray-50">
                  <td className="px-2 py-1.5 text-gray-800">{r.terminal}</td>
                  <td className="px-2 py-1.5 text-gray-800 font-medium">{r.vessel}</td>
                  <td className="px-2 py-1.5 text-gray-600">{r.voyage}</td>
                  <td className="px-2 py-1.5 text-gray-600">{r.opening_time}</td>
                  <td className="px-2 py-1.5 text-gray-600">{r.closing_time}</td>
                  <td className="px-2 py-1.5 text-gray-600">{r.etb}</td>
                  <td className="px-2 py-1.5 text-gray-400">{r.last_update}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Conflict Review Panel ─────────────────────────────────────────────────
interface ConflictDoc { id: string; file_name: string; drive_url?: string; doc_type?: string; reason?: string; extracted_data?: Record<string, string> }
interface Conflict { id: string; old_doc_id: string; new_doc_id: string; picked_by: string; picked_by_name: string; doc_type: string; ref_key: string; resolved: boolean; resolution?: string; created_at: string; old_doc?: ConflictDoc; new_doc?: ConflictDoc }

function ConflictReviewPanel() {
  const [conflicts, setConflicts] = useState<Conflict[]>([])
  const [loading, setLoading] = useState(false)
  const [showResolved, setShowResolved] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [msg, setMsg] = useState('')

  async function load() {
    setLoading(true); setMsg('')
    try {
      const r = await fetch(`/api/document-conflicts?resolved=${showResolved}`, { headers: await authHeader() })
      if (r.ok) { const d = await r.json(); setConflicts(d.conflicts || []) }
      else { const d = await r.json(); setMsg(`✗ ${d.error}`) }
    } catch (e: any) { setMsg(`✗ ${e.message}`) }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [showResolved])

  async function resolve(conflictId: string, resolution: 'keep_old' | 'use_new' | 'both') {
    setBusyId(conflictId); setMsg('')
    try {
      const r = await fetch('/api/document-conflicts', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ conflict_id: conflictId, resolution }),
      })
      if (r.ok) { setMsg('✓ Resolved'); load() }
      else { const d = await r.json(); setMsg(`✗ ${d.error}`) }
    } catch (e: any) { setMsg(`✗ ${e.message}`) }
    finally { setBusyId(null) }
  }

  const typeColor: Record<string, string> = { cusdec: '#1B3A5C', cdn: '#22A87A', barcode: '#f59e0b', boat_note: '#3b82f6', party_copy: '#8b5cf6', bill: '#ef4444' }

  return (
    <div className="max-w-4xl">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="font-semibold text-gray-900 flex items-center gap-2"><GitMerge size={16}/>Conflict Review</h2>
          <p className="text-xs text-gray-500 mt-0.5">When a new document version is uploaded for an already-picked reference, it appears here for admin review.</p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer">
            <input type="checkbox" checked={showResolved} onChange={e => setShowResolved(e.target.checked)}/>
            Show resolved
          </label>
          <button onClick={load} className="btn-secondary text-xs flex items-center gap-1"><RefreshCw size={12}/>Refresh</button>
        </div>
      </div>

      {msg && <p className={`text-sm mb-4 font-medium ${msg.startsWith('✓') ? 'text-green-600' : 'text-red-600'}`}>{msg}</p>}

      {loading ? (
        <div className="flex justify-center py-12"><Loader size={20} className="animate-spin text-gray-400"/></div>
      ) : conflicts.length === 0 ? (
        <div className="card text-center py-10 text-gray-400">
          <GitMerge size={28} className="mx-auto mb-2 text-gray-200"/>
          <p className="text-sm">{showResolved ? 'No resolved conflicts' : 'No pending conflicts — all clear!'}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {conflicts.map(c => {
            const busy = busyId === c.id
            const color = typeColor[c.doc_type] || '#6b7280'
            return (
              <div key={c.id} className="card border-l-4" style={{ borderLeftColor: color }}>
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <p className="text-sm font-semibold text-gray-800 flex items-center gap-2">
                      <span className="text-[11px] font-normal px-2 py-0.5 rounded-full text-white" style={{ background: color }}>
                        {c.doc_type?.toUpperCase() || 'DOC'}
                      </span>
                      {c.ref_key || 'Unknown reference'}
                    </p>
                    <p className="text-xs text-gray-500 mt-1">
                      Picked by <span className="font-medium text-gray-700">{c.picked_by_name || 'unknown user'}</span>
                      {' · '}
                      {new Date(c.created_at).toLocaleString('en-GB', { timeZone: 'Asia/Colombo', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                  {c.resolved && (
                    <span className="text-[11px] px-2 py-1 rounded-full bg-green-100 text-green-700 font-medium">
                      {c.resolution?.replace('_', ' ')} ✓
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div className="bg-gray-50 rounded-xl p-3">
                    <p className="text-[11px] font-bold text-gray-500 mb-1">OLD (Picked)</p>
                    <p className="text-xs text-gray-700 truncate">{c.old_doc?.file_name || c.old_doc_id}</p>
                    {c.old_doc?.drive_url && (
                      <a href={c.old_doc.drive_url} target="_blank" rel="noopener noreferrer"
                        className="text-[11px] text-blue-600 flex items-center gap-1 mt-1 hover:underline">
                        <ExternalLink size={10}/>View PDF
                      </a>
                    )}
                    {c.old_doc?.extracted_data && (
                      <div className="mt-1.5 space-y-0.5">
                        {Object.entries(c.old_doc.extracted_data).slice(0, 4).map(([k, v]) => (
                          <p key={k} className="text-[10px] text-gray-400">{k}: <span className="text-gray-600">{v}</span></p>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="bg-orange-50 rounded-xl p-3 border border-orange-100">
                    <p className="text-[11px] font-bold text-orange-500 mb-1">NEW (Updated)</p>
                    <p className="text-xs text-gray-700 truncate">{c.new_doc?.file_name || c.new_doc_id}</p>
                    {c.new_doc?.drive_url && (
                      <a href={c.new_doc.drive_url} target="_blank" rel="noopener noreferrer"
                        className="text-[11px] text-blue-600 flex items-center gap-1 mt-1 hover:underline">
                        <ExternalLink size={10}/>View PDF
                      </a>
                    )}
                    {c.new_doc?.extracted_data && (
                      <div className="mt-1.5 space-y-0.5">
                        {Object.entries(c.new_doc.extracted_data).slice(0, 4).map(([k, v]) => (
                          <p key={k} className="text-[10px] text-gray-400">{k}: <span className="text-gray-600">{v}</span></p>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {!c.resolved && (
                  <div className="flex gap-2">
                    <button onClick={() => resolve(c.id, 'keep_old')} disabled={busy}
                      className="flex-1 py-2 rounded-lg text-xs font-medium border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40">
                      {busy ? <Loader size={12} className="animate-spin inline"/> : null} Keep Old
                    </button>
                    <button onClick={() => resolve(c.id, 'use_new')} disabled={busy}
                      className="flex-1 py-2 rounded-lg text-xs font-medium text-white disabled:opacity-40"
                      style={{ background: '#22A87A' }}>
                      Use New Version
                    </button>
                    <button onClick={() => resolve(c.id, 'both')} disabled={busy}
                      className="flex-1 py-2 rounded-lg text-xs font-medium text-white disabled:opacity-40"
                      style={{ background: '#1B3A5C' }}>
                      Keep Both
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── CDN Approval Panel (admin) ─────────────────────────────────────────────
// CDNs uploaded are held in pending_admin_approval = true until admin approves
// here. Only approved CDNs count toward the CUSDEC's CAP.
interface PendingCdn { id: string; code: string; cusdec_number: string; container_no: string; vessel: string; voyage: string; seal_no: string; cdn_no: string; uploaded_at: string }
function CdnApprovalPanel() {
  const [cdns, setCdns] = useState<PendingCdn[]>([])
  const [loading, setLoading] = useState(false)
  const [approvingId, setApprovingId] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    try {
      const res = await fetch('/api/cdn-approval', { headers: await authHeader() })
      const d = await res.json()
      if (res.ok) setCdns(d.cdns || [])
    } finally { setLoading(false) }
  }
  useEffect(() => { load() }, []) // eslint-disable-line

  async function approve(id: string) {
    setApprovingId(id)
    try {
      const res = await fetch('/api/cdn-approval', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ cdn_id: id }),
      })
      if (res.ok) setCdns(prev => prev.filter(c => c.id !== id))
    } finally { setApprovingId(null) }
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="font-semibold text-gray-900 text-sm flex items-center gap-2"><CheckSquare size={15} className="text-blue-600"/>CDN Approval</h2>
          <p className="text-xs text-gray-400 mt-0.5">Approve uploaded CDNs to count them toward the CUSDEC&apos;s CAP. Unapproved CDNs do not count.</p>
        </div>
        <button onClick={load} disabled={loading} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs border border-gray-200 hover:bg-gray-50 disabled:opacity-50">
          {loading ? <Loader size={12} className="animate-spin"/> : <RefreshCw size={12}/>} Refresh
        </button>
      </div>
      {loading && cdns.length === 0 ? (
        <div className="flex justify-center py-8"><Loader size={18} className="animate-spin text-gray-400"/></div>
      ) : cdns.length === 0 ? (
        <p className="text-xs text-gray-400 text-center py-8">No CDNs pending approval</p>
      ) : (
        <div className="space-y-2">
          {cdns.map(c => (
            <div key={c.id} className="flex items-center justify-between gap-3 border border-amber-100 bg-amber-50 rounded-lg p-3 text-xs">
              <div className="min-w-0 space-y-0.5">
                <p className="font-semibold text-gray-900">Container: {c.container_no || '—'} · CDN: {c.cdn_no || '—'}</p>
                <p className="text-gray-500">CUSDEC: {c.cusdec_number || '—'} · Code: {c.code || '—'}</p>
                <p className="text-gray-400">Vessel: {c.vessel || '—'} / {c.voyage || '—'} · Seal: {c.seal_no || '—'}</p>
                <p className="text-gray-400">Uploaded: {c.uploaded_at ? new Date(c.uploaded_at).toLocaleString('en-GB') : '—'}</p>
              </div>
              <button onClick={() => approve(c.id)} disabled={approvingId === c.id}
                className="flex-shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-white disabled:opacity-50" style={{ background: '#22A87A' }}>
                {approvingId === c.id ? <Loader size={12} className="animate-spin"/> : <CheckSquare size={12}/>}
                Approve
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── 4. System Logic & Integration Notes ───────────────────────────────────
interface SystemNote { id: string; title: string; content: string; updated_at: string }
function SystemNotes() {
  const [notes, setNotes] = useState<SystemNote[]>([])
  const [editId, setEditId] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')

  async function load() {
    const res = await fetch('/api/system-notes', { headers: await authHeader() })
    const d = await res.json()
    if (res.ok) setNotes(d.notes || [])
  }
  // Live — a note someone else saved shows up here without a refresh; an
  // in-progress edit (title/content/editId below) is untouched by this since
  // it's separate state from the notes list itself.
  useEffect(() => {
    load()
    const t = setInterval(load, 30000)
    return () => clearInterval(t)
  }, [])

  async function save() {
    if (!title.trim()) return
    await fetch('/api/system-notes', {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
      body: JSON.stringify({ id: editId, title, content }),
    })
    setTitle(''); setContent(''); setEditId(null)
    load()
  }
  function edit(n: SystemNote) { setEditId(n.id); setTitle(n.title); setContent(n.content || '') }
  async function remove(id: string) {
    if (!confirm('Delete this note?')) return
    await fetch(`/api/system-notes?id=${id}`, { method: 'DELETE', headers: await authHeader() })
    if (editId === id) { setEditId(null); setTitle(''); setContent('') }
    load()
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      <div className="card">
        <h2 className="font-semibold text-gray-900 text-sm mb-3">{editId ? 'Edit Note' : 'New Note'}</h2>
        <div className="space-y-3">
          <Field label="Title"><input value={title} onChange={e => setTitle(e.target.value)} className="input"/></Field>
          <Field label="Details"><textarea value={content} onChange={e => setContent(e.target.value)} rows={10} className="input"/></Field>
        </div>
        <div className="flex gap-2 mt-4">
          <button onClick={save} className="btn-primary flex items-center gap-2"><Save size={14}/>{editId ? 'Update' : 'Add'} Note</button>
          {editId && <button onClick={() => { setEditId(null); setTitle(''); setContent('') }} className="btn-secondary">Cancel</button>}
        </div>
      </div>
      <div className="card">
        <h2 className="font-semibold text-gray-900 text-sm mb-3">Saved Notes</h2>
        <div className="space-y-2 max-h-[32rem] overflow-y-auto">
          {notes.map(n => (
            <div key={n.id} className="border border-gray-100 rounded-lg p-3">
              <div className="flex items-center justify-between">
                <p className="font-semibold text-sm text-gray-800">{n.title}</p>
                <div className="flex gap-2">
                  <button onClick={() => edit(n)} className="text-gray-400 hover:text-blue-600 text-xs">Edit</button>
                  <button onClick={() => remove(n.id)} className="text-gray-300 hover:text-red-500"><Trash2 size={13}/></button>
                </div>
              </div>
              {n.content && <p className="text-xs text-gray-500 mt-1 whitespace-pre-wrap">{n.content}</p>}
            </div>
          ))}
          {notes.length === 0 && <p className="text-xs text-gray-400 text-center py-6">No notes yet</p>}
        </div>
      </div>
    </div>
  )
}

export default function AutomationPage() {
  return <AutomationContent/>
}
AutomationPage.getLayout = (page: React.ReactElement) => <AdminLayout>{page}</AdminLayout>
