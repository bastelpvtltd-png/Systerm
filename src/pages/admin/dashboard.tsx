import { useEffect, useState } from 'react'
import AdminLayout, { usePermission } from '@/components/admin/AdminLayout'
import { authHeader } from '@/lib/supabase'
import EmailPdfModal, { type EmailAttachment } from '@/components/admin/EmailPdfModal'
import {
  Ship, FileText, Package, Clock, AlertCircle, ChevronDown, Bell, Eye, UserCheck,
  Download, Mail, Undo2, Loader, History, Search, CheckSquare, Square, Trash2, FileCheck,
} from 'lucide-react'

interface PendingGroup<T> { count: number; items: T[] }
// Vessel Trigger detail attached to a CDN Pending/Boat Note Pending
// container — only present when that vessel+voyage was actually found in
// the Vessel Trigger schedule (see dashboard-summary.ts's triggerByKey).
interface VesselContainer { containerNo: string; vessel: string; voyage: string; trigger: { openingTime: string; closingTime: string; etb: string } | null }
interface Summary {
  pendingCusdecPassed: PendingGroup<{ id: string; file_name: string; reason: string; reason_note: string | null; created_at: string }>
  shipmentsPending: PendingGroup<{ id: string; reference: string | null; shipper: string; invoice_number: string; packing_number: string | null; new_invoice: string | null; new_packing: string | null; cap: string | null; invoice_drive_url: string | null; packing_drive_url: string | null; license_drive_url: string | null; created_at: string; locked_by?: string | null; locked_by_name?: string | null }>
  cdnPending: PendingGroup<{ cusdecId: string; number: string; exporter: string; cap: number; cdnCount: number; containers: VesselContainer[] }>
  boatNotePending: PendingGroup<{ cusdecId: string; number: string; exporter: string; cap: number | null; cdnCount: number; passedCount: number; containers: VesselContainer[]; hasBoatNote: boolean; hasPartyCopy: boolean }>
  releasePending: PendingGroup<{ cusdecId: string; number: string; exporter: string }>
  closingPassed: PendingGroup<{ cdnId: string; containerNo: string; cusdecNumber: string; vessel: string; voyage: string; closingTime: string }>
}
const emptyGroup = { count: 0, items: [] }

// Small tag shown next to a document wherever it appears (Activity Log, My
// Picked Tasks, Processed History) when it came through Quick Upload's
// reason-tagged flow — "CUSDEC Passed" gets its own color since that's the
// one reason that feeds the Dashboard's Pending CUSDEC Passed count.
function ReasonBadge({ reason, note }: { reason?: string | null; note?: string | null }) {
  if (!reason) return null
  const isCusdec = reason === 'CUSDEC Passed'
  return (
    <span className={`inline-block text-[10px] px-1.5 py-0.5 rounded font-medium ${isCusdec ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
      {reason === 'Other' && note ? note : reason}
    </span>
  )
}

function docTypeLabel(v: string) { return v.split('_').filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(' ') }
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve((reader.result as string).split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

// Shown under a CDN/Boat Note Pending row — one line per container, but
// only the ones whose vessel+voyage was actually matched in the Vessel
// Trigger schedule get their opening/closing/ETB shown. Containers with no
// match (or no vessel/voyage yet) are skipped entirely rather than shown
// with blank fields.
function VesselContainerList({ containers }: { containers: VesselContainer[] }) {
  const matched = containers.filter(c => c.trigger)
  if (!matched.length) return null
  return (
    <div className="mt-2 pt-2 border-t border-gray-50 space-y-1">
      {matched.map(c => (
        <p key={c.containerNo} className="text-gray-500">
          <span className="font-medium text-gray-700">{c.containerNo || '—'}</span> · {c.vessel}/{c.voyage} · Opening: {c.trigger!.openingTime || '—'} · Closing: {c.trigger!.closingTime || '—'} · ETB: {c.trigger!.etb || '—'}
        </p>
      ))}
    </div>
  )
}

// getLayout (see _app.tsx) keeps AdminLayout mounted across navigations
// instead of remounting the sidebar on every tab click.
export default function AdminDashboard() {
  return <DashboardContent/>
}
AdminDashboard.getLayout = (page: React.ReactElement) => <AdminLayout>{page}</AdminLayout>

function DashboardContent() {
  const [summary, setSummary] = useState<Summary>({
    pendingCusdecPassed: emptyGroup, shipmentsPending: emptyGroup, cdnPending: emptyGroup, boatNotePending: emptyGroup, releasePending: emptyGroup, closingPassed: emptyGroup,
  })
  const [expanded, setExpanded] = useState<string | null>(null)
  // Bumped whenever Incoming's Pick succeeds, so My Picked Tasks re-fetches
  // immediately instead of needing a page refresh to show the new task.
  const [pickRefreshKey, setPickRefreshKey] = useState(0)
  const [currentUserId, setCurrentUserId] = useState('')
  const [finalDocsCount, setFinalDocsCount] = useState(0)
  const [pickingShipmentId, setPickingShipmentId] = useState<string | null>(null)
  const [shipmentPickError, setShipmentPickError] = useState('')

  // Boat Note Pending > Pick — select a batch of pending CUSDECs, merge
  // their Boat Note / Party's Copy / CDN PDFs (whichever categories are
  // ticked) into one file each, and send them through the normal
  // notify/pick flow (document-uploads, is_saved_to_db:false so it's
  // cleaned up from Drive once whoever picks it does Mail/Download).
  const [selectedPendingIds, setSelectedPendingIds] = useState<string[]>([])
  const [pickModalOpen, setPickModalOpen] = useState(false)
  const [pickIncludeBoat, setPickIncludeBoat] = useState(true)
  const [pickIncludeParty, setPickIncludeParty] = useState(true)
  const [pickIncludeCdn, setPickIncludeCdn] = useState(true)
  const [pickBusy, setPickBusy] = useState(false)
  const [pickError, setPickError] = useState('')
  const [pickDone, setPickDone] = useState('')

  function togglePendingSelected(id: string) {
    setSelectedPendingIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  async function confirmPick() {
    if (!selectedPendingIds.length) return
    setPickBusy(true); setPickError(''); setPickDone('')
    try {
      const h = await authHeader()
      const mr = await fetch('/api/merge-pending-docs', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...h },
        body: JSON.stringify({ cusdec_ids: selectedPendingIds, includeBoat: pickIncludeBoat, includeParty: pickIncludeParty, includeCdn: pickIncludeCdn }),
      })
      const md = await mr.json()
      if (!mr.ok) throw new Error(md.error || 'Merge failed')

      for (const f of md.files as { fileName: string; base64: string; docType: string }[]) {
        const dr = await fetch('/api/upload-to-drive', {
          method: 'POST', headers: { 'Content-Type': 'application/json', ...h },
          body: JSON.stringify({ base64: f.base64, fileName: f.fileName, mimeType: 'application/pdf', docType: f.docType }),
        })
        const dd = await dr.json()
        if (!dr.ok || !dd.driveLink) throw new Error(dd.error || 'Drive upload failed')
        await fetch('/api/document-uploads', {
          method: 'POST', headers: { 'Content-Type': 'application/json', ...h },
          body: JSON.stringify({
            file_name: f.fileName, drive_url: dd.driveLink, doc_type: f.docType,
            is_saved_to_db: false, notify: true, reason: 'Boat Note Passed',
          }),
        })
      }
      setPickDone(`✓ ${md.files.length} merged file(s) sent — pick them up from My Tasks`)
      setSelectedPendingIds([])
      setPickModalOpen(false)
    } catch (e: any) {
      setPickError(e.message)
    } finally {
      setPickBusy(false)
    }
  }

  async function load(silent = false) {
    const res = await fetch('/api/dashboard-summary', { headers: await authHeader() })
    const d = await res.json()
    if (res.ok) {
      setSummary({
        pendingCusdecPassed: d.pendingCusdecPassed || emptyGroup,
        shipmentsPending: d.shipmentsPending || emptyGroup,
        cdnPending: d.cdnPending || emptyGroup,
        boatNotePending: d.boatNotePending || emptyGroup,
        releasePending: d.releasePending || emptyGroup,
        closingPassed: d.closingPassed || emptyGroup,
      })
    }
  }

  useEffect(() => {
    load()
    // Live — the stat cards and their expanded lists stay current without a
    // page refresh, same polling convention as Incoming/My Picked Tasks below.
    const t = setInterval(() => load(true), 15000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    import('@/lib/supabase').then(({ supabase }) =>
      supabase.auth.getUser().then(({ data }) => setCurrentUserId(data.user?.id || ''))
    )
  }, [])

  async function pickShipment(id: string) {
    setPickingShipmentId(id); setShipmentPickError('')
    try {
      const res = await fetch('/api/pick-shipment', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ shipment_id: id }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      await load(true)
    } catch (e: any) { setShipmentPickError(e.message) }
    finally { setPickingShipmentId(null) }
  }

  async function resolveShipment(id: string) {
    setPickingShipmentId(id); setShipmentPickError('')
    try {
      const res = await fetch('/api/release-shipment', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ shipment_id: id }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      await load(true)
    } catch (e: any) { setShipmentPickError(e.message) }
    finally { setPickingShipmentId(null) }
  }

  const { has } = usePermission()

  const stats = [
    { key: 'section:dashboard.cusdec-pending',   id: 'shipments',label: 'Shipments Pending (no CUSDEC yet)', value: summary.shipmentsPending.count, icon: FileText,    color: '#f59e0b' },
    { key: 'section:dashboard.total-shipments',  id: 'pendingCusdec', label: 'Pending CUSDEC Passed',  value: summary.pendingCusdecPassed.count, icon: Ship,        color: '#1B3A5C' },
    { key: 'section:dashboard.cdn-pending',      id: 'cdn',      label: 'CDN Pending (CAP not complete)',    value: summary.cdnPending.count,       icon: Clock,       color: '#8b5cf6' },
    { key: 'section:dashboard.boatnote-pending', id: 'boatnote', label: 'Boat Note Pending',       value: summary.boatNotePending.count,    icon: Package,     color: '#3b82f6' },
    { key: 'section:dashboard.release-pending',  id: 'release',  label: 'Export Release Pending',  value: summary.releasePending.count,     icon: AlertCircle, color: '#ef4444' },
    { key: 'section:dashboard.closing-passed',   id: 'closingPassed', label: 'Closing Time Passed', value: summary.closingPassed.count,  icon: AlertCircle, color: '#dc2626' },
    { key: 'section:dashboard.final-documents',  id: 'finalDocs', label: 'Pending Final Document', value: finalDocsCount, icon: FileCheck, color: '#22A87A' },
  ].filter(s => has(s.key))

  return (
      <div className="p-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-gray-500 text-sm mt-1">Export Management Overview</p>
        </div>

        {stats.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-4">
            {stats.map(({ id, label, value, icon: Icon, color }) => (
              <button key={id} onClick={() => id !== 'total' && setExpanded(x => x === id ? null : id)}
                className={`card text-left ${id !== 'total' ? 'cursor-pointer hover:shadow-md transition-shadow' : ''}`}>
                <div className="flex items-center justify-between mb-3">
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: color + '20' }}>
                    <Icon size={18} style={{ color }}/>
                  </div>
                  {id !== 'total' && <ChevronDown size={14} className={`text-gray-300 transition-transform ${expanded === id ? 'rotate-180' : ''}`}/>}
                </div>
                <div className="text-2xl font-bold text-gray-900">{value}</div>
                <div className="text-xs text-gray-500 mt-1">{label}</div>
              </button>
            ))}
          </div>
        )}

        {expanded === 'pendingCusdec' && (
          <div className="card mb-4">
            <h2 className="font-semibold text-gray-900 mb-3 text-sm">Reason-tagged uploads awaiting Mail/Download (Quick Upload)</h2>
            <p className="text-xs text-gray-400 mb-3">These are temporary Drive-only uploads (Upload Docs → Quick Upload), not saved to any structured table. Whoever picks one and does Mail or Download removes it from this count.</p>
            {summary.pendingCusdecPassed.items.length === 0 ? (
              <p className="text-xs text-gray-400 py-4 text-center">None pending</p>
            ) : (
              <div className="space-y-1.5 max-h-96 overflow-y-auto">
                {summary.pendingCusdecPassed.items.map(r => (
                  <div key={r.id} className="flex items-center justify-between text-xs border border-gray-100 rounded-lg p-2.5">
                    <div>
                      <p className="font-medium text-gray-800">{r.file_name}</p>
                      <p className="text-gray-400">{new Date(r.created_at).toLocaleString('en-GB')}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {expanded === 'shipments' && (
          <div className="card mb-4">
            <h2 className="font-semibold text-gray-900 mb-3 text-sm">Shipments opened with no CUSDEC uploaded/matched yet</h2>
            <p className="text-xs text-gray-400 mb-3">Pick a shipment to work on it exclusively — it disappears from everyone else's list until you Resolve it or its CUSDEC is saved (which clears it automatically).</p>
            {shipmentPickError && <p className="text-xs text-red-600 mb-3 flex items-center gap-1"><AlertCircle size={12}/>{shipmentPickError}</p>}
            {summary.shipmentsPending.items.length === 0 ? (
              <p className="text-xs text-gray-400 py-4 text-center">None — every open Shipment has a matching CUSDEC</p>
            ) : (
              <div className="space-y-1.5 max-h-96 overflow-y-auto">
                {summary.shipmentsPending.items.map(s => {
                  const docs = [
                    { label: 'Invoice', url: s.invoice_drive_url },
                    { label: 'Packing', url: s.packing_drive_url },
                    { label: 'License', url: s.license_drive_url },
                  ].filter(d => d.url)
                  const pickedByMe = !!s.locked_by && s.locked_by === currentUserId
                  const busy = pickingShipmentId === s.id
                  return (
                    <div key={s.id} className={`text-xs border rounded-lg p-2.5 ${pickedByMe ? 'border-green-200 bg-green-50' : 'border-gray-100'}`}>
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-medium text-gray-800">{s.shipper} · Inv: {s.invoice_number}</p>
                          <p className="text-gray-400">Ref: <b className="text-gray-600">{s.reference || '—'}</b> · Packing: {s.packing_number || '—'}</p>
                          {(s.new_invoice || s.new_packing || s.cap) && (
                            <p className="text-[11px] text-blue-600 mt-0.5">
                              {s.new_invoice && `New Inv: ${s.new_invoice}`}{s.new_invoice && s.new_packing ? ' · ' : ''}
                              {s.new_packing && `New Packing: ${s.new_packing}`}{(s.new_invoice || s.new_packing) && s.cap ? ' · ' : ''}
                              {s.cap && `CAP: ${s.cap}`}
                            </p>
                          )}
                          {pickedByMe && <p className="text-[11px] text-green-600 mt-0.5 flex items-center gap-1"><UserCheck size={11}/>Picked by you — upload the CUSDEC to complete it</p>}
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {pickedByMe ? (
                            <button onClick={() => resolveShipment(s.id)} disabled={busy}
                              className="flex items-center gap-1 text-[11px] px-2 py-1 rounded border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50">
                              {busy ? <Loader size={11} className="animate-spin"/> : <Undo2 size={11}/>} Resolve
                            </button>
                          ) : (
                            <button onClick={() => pickShipment(s.id)} disabled={busy}
                              className="flex items-center gap-1 text-[11px] px-2 py-1 rounded text-white disabled:opacity-50" style={{ background: '#22A87A' }}>
                              {busy ? <Loader size={11} className="animate-spin"/> : <UserCheck size={11}/>} Pick
                            </button>
                          )}
                          <a href={`/admin/shipment-overview?invoiceNumber=${encodeURIComponent(s.invoice_number)}`} className="text-blue-600 hover:underline">View →</a>
                        </div>
                      </div>
                      {docs.length > 0 && (
                        <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                          {docs.map(d => (
                            <a key={d.label} href={d.url!} target="_blank" rel="noreferrer" className="text-blue-500 underline text-[11px]">{d.label} PDF</a>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {expanded === 'cdn' && (
          <div className="card mb-4">
            <h2 className="font-semibold text-gray-900 mb-3 text-sm">CUSDECs whose CAP isn't filled yet</h2>
            {summary.cdnPending.items.length === 0 ? (
              <p className="text-xs text-gray-400 py-4 text-center">None — every CUSDEC's CAP is complete</p>
            ) : (
              <div className="space-y-1.5 max-h-96 overflow-y-auto">
                {summary.cdnPending.items.map(c => (
                  <div key={c.cusdecId} className="text-xs border border-gray-100 rounded-lg p-2.5">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium text-gray-800">E {c.number}</p>
                        <p className="text-gray-400 truncate max-w-[240px]">{c.exporter}</p>
                      </div>
                      <span className="font-medium text-purple-700">{c.cdnCount}/{c.cap} CDN <span className="text-red-500">({c.cap - c.cdnCount} remaining)</span></span>
                      <a href={`/admin/shipment-overview?number=${encodeURIComponent(c.number)}`} className="text-blue-600 hover:underline flex-shrink-0">View →</a>
                    </div>
                    <VesselContainerList containers={c.containers}/>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {expanded === 'boatnote' && (
          <div className="card mb-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-gray-900 text-sm">CAP complete, still waiting on Boat Note</h2>
              {selectedPendingIds.length > 0 && (
                <button onClick={() => { setPickModalOpen(true); setPickError('') }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white" style={{ background: '#3b82f6' }}>
                  <CheckSquare size={13}/>Pick ({selectedPendingIds.length})
                </button>
              )}
            </div>
            {pickDone && <p className="text-xs text-green-600 mb-3">{pickDone}</p>}
            {summary.boatNotePending.items.length === 0 ? (
              <p className="text-xs text-gray-400 py-4 text-center">None — every CAP-complete CUSDEC has passed Boat Note</p>
            ) : (
              <div className="space-y-1.5 max-h-96 overflow-y-auto">
                {summary.boatNotePending.items.map(c => (
                  <div key={c.cusdecId} className="text-xs border border-gray-100 rounded-lg p-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <button onClick={() => togglePendingSelected(c.cusdecId)} className="flex-shrink-0">
                        {selectedPendingIds.includes(c.cusdecId) ? <CheckSquare size={15} className="text-blue-600"/> : <Square size={15} className="text-gray-300"/>}
                      </button>
                      <div className="flex-1">
                        <div className="flex items-center gap-1.5">
                          <p className="font-medium text-gray-800">E {c.number}</p>
                          {c.hasBoatNote && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">B</span>}
                          {c.hasPartyCopy && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-purple-100 text-purple-700">P</span>}
                        </div>
                        <p className="text-gray-400 truncate max-w-[240px]">{c.exporter}</p>
                      </div>
                      <span className="font-medium text-blue-700 flex-shrink-0">{c.passedCount}/{c.cdnCount} passed</span>
                      <a href={`/admin/shipment-overview?number=${encodeURIComponent(c.number)}`} className="text-blue-600 hover:underline flex-shrink-0">View →</a>
                    </div>
                    <VesselContainerList containers={c.containers}/>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {pickModalOpen && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[70] p-4">
            <div className="bg-white rounded-2xl w-full max-w-sm">
              <div className="p-5 border-b">
                <h2 className="font-bold text-gray-900 text-sm">Pick {selectedPendingIds.length} CUSDEC(s)</h2>
              </div>
              <div className="p-5 space-y-2">
                <label className="flex items-center gap-3 p-2.5 rounded-lg border border-gray-100 cursor-pointer hover:bg-gray-50">
                  <input type="checkbox" checked={pickIncludeBoat} onChange={e => setPickIncludeBoat(e.target.checked)} className="w-4 h-4"/>
                  <span className="text-sm text-gray-800">Boat Note</span>
                </label>
                <label className="flex items-center gap-3 p-2.5 rounded-lg border border-gray-100 cursor-pointer hover:bg-gray-50">
                  <input type="checkbox" checked={pickIncludeParty} onChange={e => setPickIncludeParty(e.target.checked)} className="w-4 h-4"/>
                  <span className="text-sm text-gray-800">Party's Copy</span>
                </label>
                <label className="flex items-center gap-3 p-2.5 rounded-lg border border-gray-100 cursor-pointer hover:bg-gray-50">
                  <input type="checkbox" checked={pickIncludeCdn} onChange={e => setPickIncludeCdn(e.target.checked)} className="w-4 h-4"/>
                  <span className="text-sm text-gray-800">CDNs</span>
                </label>
                <p className="text-[11px] text-gray-400">Merges each ticked category across all selected CUSDECs into one PDF, uploads it, and sends it to My Tasks (reason: Boat Note Passed).</p>
                {pickError && <p className="text-xs text-red-600">{pickError}</p>}
              </div>
              <div className="flex gap-3 p-5 border-t">
                <button onClick={() => setPickModalOpen(false)} disabled={pickBusy} className="btn-secondary flex-1 disabled:opacity-50">Cancel</button>
                <button onClick={confirmPick} disabled={pickBusy || (!pickIncludeBoat && !pickIncludeParty && !pickIncludeCdn)}
                  className="btn-primary flex-1 flex items-center justify-center gap-2 disabled:opacity-40">
                  {pickBusy ? <Loader size={14} className="animate-spin"/> : <CheckSquare size={14}/>}Merge &amp; Send
                </button>
              </div>
            </div>
          </div>
        )}

        {expanded === 'release' && (
          <div className="card mb-4">
            <h2 className="font-semibold text-gray-900 mb-3 text-sm">Boat Note passed (blue), waiting on Export Release</h2>
            {summary.releasePending.items.length === 0 ? (
              <p className="text-xs text-gray-400 py-4 text-center">None — every Boat Note-passed CUSDEC has been released</p>
            ) : (
              <div className="space-y-1.5 max-h-96 overflow-y-auto">
                {summary.releasePending.items.map(c => (
                  <div key={c.cusdecId} className="flex items-center justify-between text-xs border border-gray-100 rounded-lg p-2.5">
                    <div>
                      <p className="font-medium text-gray-800">E {c.number}</p>
                      <p className="text-gray-400 truncate max-w-[240px]">{c.exporter}</p>
                    </div>
                    <a href={`/admin/shipment-overview?number=${encodeURIComponent(c.number)}`} className="text-blue-600 hover:underline flex-shrink-0">View →</a>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {expanded === 'closingPassed' && (
          <div className="card mb-4">
            <h2 className="font-semibold text-gray-900 mb-3 text-sm flex items-center gap-2"><AlertCircle size={15} className="text-red-600"/>Vessel closing time has passed — not yet Boat Note/Export Release passed</h2>
            <p className="text-xs text-gray-400 mb-3">Checked against the Vessel Triggers schedule (Automation tab) each time it syncs — matched by Vessel + Voyage together, since the same voyage number can appear against more than one vessel.</p>
            {summary.closingPassed.items.length === 0 ? (
              <p className="text-xs text-gray-400 py-4 text-center">None — no pending container's closing time has passed</p>
            ) : (
              <div className="space-y-1.5 max-h-96 overflow-y-auto">
                {summary.closingPassed.items.map(c => (
                  <div key={c.cdnId} className="flex items-center justify-between text-xs border border-red-100 bg-red-50 rounded-lg p-2.5">
                    <div>
                      <p className="font-medium text-gray-800">{c.containerNo || '—'} <span className="text-gray-400 font-normal">· E {c.cusdecNumber}</span></p>
                      <p className="text-gray-500">{c.vessel} / {c.voyage} · Closing: {c.closingTime}</p>
                    </div>
                    <a href={`/admin/shipment-overview?containerNo=${encodeURIComponent(c.containerNo || '')}`} className="text-blue-600 hover:underline flex-shrink-0">View →</a>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {expanded === 'finalDocs' && (
          <div className="mb-4">
            <PendingFinalDocumentsPanel currentUserId={currentUserId} onCountChange={setFinalDocsCount}/>
          </div>
        )}
        {/* Keeps the stat card's count fresh even while collapsed — this
            component polls internally regardless of whether it's rendered
            expanded, so mount it invisibly when collapsed just for the count. */}
        {expanded !== 'finalDocs' && has('section:dashboard.final-documents') && (
          <div className="hidden"><PendingFinalDocumentsPanel currentUserId={currentUserId} onCountChange={setFinalDocsCount}/></div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-2">
          {has('section:dashboard.incoming') && <IncomingPanel onPicked={() => setPickRefreshKey(k => k + 1)}/>}
          {has('section:dashboard.my-picked-tasks') && <MyPickedTasksPanel refreshKey={pickRefreshKey}/>}
        </div>

        {has('section:dashboard.pick-history') && <PickHistoryPanel/>}
      </div>
  )
}

// ── Incoming (Notify) — every signed-in user sees every still-active
// notification; Pick locks it to just them (see pick-task.ts's atomic claim).
// Multiple can be ticked and picked together in one go.
function IncomingPanel({ onPicked }: { onPicked: () => void }) {
  const [items, setItems] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [pickingId, setPickingId] = useState<string | null>(null)
  const [pickingAll, setPickingAll] = useState(false)
  const [viewing, setViewing] = useState<any | null>(null)
  const [selected, setSelected] = useState<Record<string, boolean>>({})

  async function load(silent = false) {
    if (!silent) setLoading(true)
    try {
      const res = await fetch('/api/dashboard-notifications', { headers: await authHeader() })
      const d = await res.json()
      if (res.ok) setItems(d.notifications || [])
    } finally { if (!silent) setLoading(false) }
  }
  // Live updates: a new upload shows up here within a few seconds without a
  // page refresh — polling rather than a Realtime subscription since it
  // needs zero Supabase publication setup and the spec explicitly allows
  // either. Silent (no loading spinner) so it doesn't flicker every tick.
  useEffect(() => {
    load()
    const t = setInterval(() => load(true), 6000)
    return () => clearInterval(t)
  }, [])

  function toggle(id: string) { setSelected(prev => ({ ...prev, [id]: !prev[id] })) }
  const selectedIds = Object.keys(selected).filter(id => selected[id])
  const allSelected = items.length > 0 && selectedIds.length === items.length
  function toggleAll() { setSelected(allSelected ? {} : Object.fromEntries(items.map(n => [n.id, true]))) }

  async function pickOne(n: any): Promise<boolean> {
    try {
      const res = await fetch('/api/pick-task', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ notification_id: n.id, document_id: n.document_uploads?.id }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      return true
    } catch (e: any) {
      return false
    }
  }

  async function pick(n: any) {
    setPickingId(n.id)
    const ok = await pickOne(n)
    if (ok) { setItems(prev => prev.filter(x => x.id !== n.id)); onPicked() }
    else { alert('Someone else already picked this'); load() }
    setPickingId(null)
  }

  async function pickSelected() {
    setPickingAll(true)
    const toPick = items.filter(n => selected[n.id])
    let anyOk = false
    for (const n of toPick) {
      const ok = await pickOne(n)
      if (ok) { anyOk = true; setItems(prev => prev.filter(x => x.id !== n.id)) }
    }
    setSelected({})
    setPickingAll(false)
    if (anyOk) onPicked()
    load()
  }

  function look(n: any) {
    setViewing(n)
    if (n.document_uploads?.id) {
      authHeader().then(h => fetch('/api/log-document-action', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...h },
        body: JSON.stringify({ document_id: n.document_uploads.id, action: 'look' }),
      })).catch(() => {})
    }
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold text-gray-900 text-sm flex items-center gap-2"><Bell size={16} className="text-amber-500"/>Activity Log</h2>
        {selectedIds.length > 0 && (
          <button onClick={pickSelected} disabled={pickingAll}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs text-white disabled:opacity-50" style={{ background: '#22A87A' }}>
            {pickingAll ? <Loader size={12} className="animate-spin"/> : <UserCheck size={12}/>} Pick Selected ({selectedIds.length})
          </button>
        )}
      </div>
      {loading ? (
        <div className="flex justify-center py-8"><Loader size={18} className="animate-spin text-gray-400"/></div>
      ) : items.length === 0 ? (
        <p className="text-xs text-gray-400 text-center py-6">Nothing waiting</p>
      ) : (
        <div className="space-y-1.5 max-h-80 overflow-y-auto">
          <button onClick={toggleAll} className="flex items-center gap-2 text-xs text-gray-400 hover:text-gray-600 px-0.5 pb-1">
            {allSelected ? <CheckSquare size={14} className="text-green-600"/> : <Square size={14}/>} Select all
          </button>
          {items.map(n => (
            <div key={n.id} className="flex items-center justify-between text-xs border border-gray-100 rounded-lg p-2.5">
              <div className="flex items-center gap-2 min-w-0">
                <button onClick={() => toggle(n.id)} className="flex-shrink-0 text-gray-300 hover:text-green-600">
                  {selected[n.id] ? <CheckSquare size={14} className="text-green-600"/> : <Square size={14}/>}
                </button>
                <div className="min-w-0">
                  <p className="font-medium text-gray-800 truncate flex items-center gap-1.5">
                    {n.document_uploads?.file_name}
                    <ReasonBadge reason={n.document_uploads?.reason} note={n.document_uploads?.reason_note}/>
                  </p>
                  <p className="text-gray-400">{n.uploaded_by_name || 'Someone'} uploaded this</p>
                </div>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <button onClick={() => look(n)} className="flex items-center gap-1 px-2 py-1.5 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50">
                  <Eye size={12}/> Look Only
                </button>
                <button onClick={() => pick(n)} disabled={pickingId === n.id}
                  className="flex items-center gap-1 px-2 py-1.5 rounded-md text-white disabled:opacity-50" style={{ background: '#22A87A' }}>
                  {pickingId === n.id ? <Loader size={12} className="animate-spin"/> : <UserCheck size={12}/>} Pick
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {viewing && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setViewing(null)}>
          <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b">
              <p className="font-semibold text-sm truncate">{viewing.document_uploads?.file_name}</p>
              <button onClick={() => setViewing(null)} className="text-gray-400 hover:text-gray-700">✕</button>
            </div>
            <div className="flex-1 overflow-auto p-2 bg-gray-50">
              {viewing.document_uploads?.drive_url ? (
                <iframe src={viewing.document_uploads.drive_url.replace('/view', '/preview')} className="w-full h-[70vh] rounded-lg border-0"/>
              ) : (
                <p className="text-xs text-gray-400 text-center py-10">No file link available</p>
              )}
            </div>
            <p className="text-[10px] text-gray-400 px-4 py-2 border-t">View only — download and mail aren't available here.</p>
          </div>
        </div>
      )}
    </div>
  )
}

// ── My Picked Tasks — full access (download/mail) to whatever this user
// picked; Resolve/Return hands it back to Incoming for everyone else. Ticks
// let several be downloaded/mailed/returned together in one action.
function MyPickedTasksPanel({ refreshKey }: { refreshKey: number }) {
  const { isAdmin } = usePermission()
  const [tasks, setTasks] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [bulkBusy, setBulkBusy] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [emailAttachments, setEmailAttachments] = useState<EmailAttachment[] | null>(null)
  const [pendingMailActions, setPendingMailActions] = useState<{ taskIds: string[]; docIds: { id: string; ephemeral: boolean }[] } | null>(null)
  const [selected, setSelected] = useState<Record<string, boolean>>({})

  async function load(silent = false) {
    if (!silent) setLoading(true)
    try {
      const res = await fetch('/api/user-tasks', { headers: await authHeader() })
      const d = await res.json()
      if (res.ok) setTasks(d.tasks || [])
    } finally { if (!silent) setLoading(false) }
  }
  useEffect(() => {
    load()
    const t = setInterval(() => load(true), 8000)
    return () => clearInterval(t)
  }, [refreshKey])

  function toggle(id: string) { setSelected(prev => ({ ...prev, [id]: !prev[id] })) }
  const selectedTasks = tasks.filter(t => selected[t.id])
  const allSelected = tasks.length > 0 && selectedTasks.length === tasks.length
  function toggleAll() { setSelected(allSelected ? {} : Object.fromEntries(tasks.map(t => [t.id, true]))) }

  async function returnTask(taskId: string) {
    const res = await fetch('/api/user-tasks', {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
      body: JSON.stringify({ task_id: taskId }),
    })
    const d = await res.json()
    if (!res.ok) throw new Error(d.error)
  }

  async function handleReturn(taskId: string) {
    setBusyId(taskId)
    try {
      await returnTask(taskId)
      setTasks(prev => prev.filter(t => t.id !== taskId))
    } catch (e: any) {
      alert(e.message)
    } finally {
      setBusyId(null)
    }
  }

  async function returnSelected() {
    setBulkBusy(true)
    for (const t of selectedTasks) {
      try { await returnTask(t.id) } catch { /* keep going through the rest */ }
    }
    setSelected({})
    setBulkBusy(false)
    load()
  }

  function logAction(documentId: string, action: 'mail' | 'download') {
    authHeader().then(h => fetch('/api/log-document-action', {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...h },
      body: JSON.stringify({ document_id: documentId, action }),
    })).catch(() => {})
  }

  // Reason-tagged Quick Uploads are meant to be temporary: Mail or Download
  // is the last thing that happens to them, so confirming here both permits
  // the action AND deletes the document (Drive file + every trace of it) —
  // that delete is what takes it out of the Dashboard's Pending CUSDEC
  // Passed count. Declining the confirm blocks the mail/download entirely.
  // One confirm for the whole batch, not one popup per reason-tagged item —
  // if none of the given tasks have a reason, no prompt at all. A reasoned
  // upload that was ALSO Saved (is_saved_to_db) isn't temporary anymore — it
  // has a real structured-table row + Drive file like any normal document,
  // so it's treated exactly like one here (no delete-on-pick, no confirm).
  function isEphemeralReason(doc: any): boolean {
    return !!doc?.reason && !doc?.is_saved_to_db
  }
  function confirmReasonDeleteBatch(tasksToCheck: any[]): boolean {
    const reasoned = tasksToCheck.filter(t => isEphemeralReason(t.document_uploads))
    if (!reasoned.length) return true
    return confirm(`${reasoned.length} of the selected document${reasoned.length === 1 ? '' : 's'} will be permanently removed after this. Continue with Mail/Download?`)
  }
  function confirmReasonDelete(doc?: { reason?: string | null; is_saved_to_db?: boolean } | null): boolean {
    if (!isEphemeralReason(doc)) return true
    return confirm(`This document (reason: ${doc?.reason}) will be permanently removed after this. Continue with Mail/Download?`)
  }
  function deleteReasonDoc(documentId: string) {
    authHeader().then(h => fetch('/api/delete-reason-document', {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...h },
      body: JSON.stringify({ document_id: documentId }),
    })).catch(() => {})
  }

  // Mail or Download — whichever happens first — auto-resolves the task
  // server-side (log-document-action.ts), so it's removed from view here
  // right away instead of waiting for the next full reload.
  function downloadSelected() {
    if (!confirmReasonDeleteBatch(selectedTasks)) return
    const ids = new Set(selectedTasks.map(t => t.id))
    for (const t of selectedTasks) {
      if (!t.document_uploads?.drive_url) continue
      logAction(t.document_uploads.id, 'download')
      if (isEphemeralReason(t.document_uploads)) deleteReasonDoc(t.document_uploads.id)
      window.open(t.document_uploads.drive_url, '_blank')
    }
    setTasks(prev => prev.filter(t => !ids.has(t.id)))
    setSelected({})
  }

  function mailSelected() {
    if (!confirmReasonDeleteBatch(selectedTasks)) return
    const eligible = selectedTasks.filter(t => t.document_uploads?.drive_url)
    if (!eligible.length) return
    const attachments = eligible.map(t => ({ filename: t.document_uploads.file_name, url: t.document_uploads.drive_url }))
    const taskIds = eligible.map(t => t.id)
    const docIds = eligible.map(t => ({ id: t.document_uploads.id, ephemeral: isEphemeralReason(t.document_uploads) }))
    setEmailAttachments(attachments)
    setPendingMailActions({ taskIds, docIds })
    setSelected({})
  }

  async function deleteTasks(ids: string[]) {
    if (!ids.length) return
    if (!confirm(`Delete ${ids.length} picked task record${ids.length === 1 ? '' : 's'}? This only removes the pick record — the document itself is not affected.`)) return
    setDeleting(true)
    try {
      await fetch(`/api/user-tasks?ids=${ids.join(',')}`, { method: 'DELETE', headers: await authHeader() })
      setTasks(prev => prev.filter(t => !ids.includes(t.id)))
      setSelected({})
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold text-gray-900 text-sm flex items-center gap-2"><UserCheck size={16} className="text-green-600"/>My Picked Tasks</h2>
        {selectedTasks.length > 0 && (
          <div className="flex items-center gap-1.5">
            <button onClick={downloadSelected} className="flex items-center gap-1 px-2 py-1.5 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50 text-xs">
              <Download size={12}/> ({selectedTasks.length})
            </button>
            <button onClick={mailSelected} className="flex items-center gap-1 px-2 py-1.5 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50 text-xs">
              <Mail size={12}/> ({selectedTasks.length})
            </button>
            <button onClick={returnSelected} disabled={bulkBusy}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs text-white disabled:opacity-50" style={{ background: '#ef4444' }}>
              {bulkBusy ? <Loader size={12} className="animate-spin"/> : <Undo2 size={12}/>} Resolve Selected
            </button>
            {isAdmin && (
              <button onClick={() => deleteTasks(selectedTasks.map(t => t.id))} disabled={deleting}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs text-white disabled:opacity-50" style={{ background: '#7f1d1d' }}>
                {deleting ? <Loader size={12} className="animate-spin"/> : <Trash2 size={12}/>} Delete Selected
              </button>
            )}
          </div>
        )}
      </div>
      {loading ? (
        <div className="flex justify-center py-8"><Loader size={18} className="animate-spin text-gray-400"/></div>
      ) : tasks.length === 0 ? (
        <p className="text-xs text-gray-400 text-center py-6">You haven't picked anything</p>
      ) : (
        <div className="space-y-1.5 max-h-80 overflow-y-auto">
          <button onClick={toggleAll} className="flex items-center gap-2 text-xs text-gray-400 hover:text-gray-600 px-0.5 pb-1">
            {allSelected ? <CheckSquare size={14} className="text-green-600"/> : <Square size={14}/>} Select all
          </button>
          {tasks.map(t => (
            <div key={t.id} className="flex items-center justify-between text-xs border border-gray-100 rounded-lg p-2.5">
              <div className="flex items-center gap-2 min-w-0">
                <button onClick={() => toggle(t.id)} className="flex-shrink-0 text-gray-300 hover:text-green-600">
                  {selected[t.id] ? <CheckSquare size={14} className="text-green-600"/> : <Square size={14}/>}
                </button>
                <div className="min-w-0">
                  <p className="font-medium text-gray-800 truncate flex items-center gap-1.5">
                    {t.document_uploads?.file_name}
                    <ReasonBadge reason={t.document_uploads?.reason} note={t.document_uploads?.reason_note}/>
                  </p>
                  <p className="text-gray-400">Picked {new Date(t.picked_at).toLocaleString('en-GB')}</p>
                </div>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                {t.document_uploads?.drive_url && (
                  <>
                    <button onClick={() => {
                      if (!confirmReasonDelete(t.document_uploads)) return
                      logAction(t.document_uploads.id, 'download')
                      if (isEphemeralReason(t.document_uploads)) deleteReasonDoc(t.document_uploads.id)
                      window.open(t.document_uploads.drive_url, '_blank')
                      setTasks(prev => prev.filter(x => x.id !== t.id))
                    }} className="flex items-center gap-1 px-2 py-1.5 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50">
                      <Download size={12}/>
                    </button>
                    <button onClick={() => {
                      if (!confirmReasonDelete(t.document_uploads)) return
                      setEmailAttachments([{ filename: t.document_uploads.file_name, url: t.document_uploads.drive_url }])
                      setPendingMailActions({ taskIds: [t.id], docIds: [{ id: t.document_uploads.id, ephemeral: isEphemeralReason(t.document_uploads) }] })
                    }} className="flex items-center gap-1 px-2 py-1.5 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50">
                      <Mail size={12}/>
                    </button>
                  </>
                )}
                <button onClick={() => handleReturn(t.id)} disabled={busyId === t.id}
                  className="flex items-center gap-1 px-2 py-1.5 rounded-md text-white disabled:opacity-50" style={{ background: '#ef4444' }}>
                  {busyId === t.id ? <Loader size={12} className="animate-spin"/> : <Undo2 size={12}/>} Resolve/Return
                </button>
                {isAdmin && (
                  <button onClick={() => deleteTasks([t.id])} disabled={deleting} className="text-gray-300 hover:text-red-500 disabled:opacity-50" title="Delete (admin)">
                    <Trash2 size={14}/>
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {emailAttachments && (
        <EmailPdfModal
          attachments={emailAttachments}
          onClose={() => { setEmailAttachments(null); setPendingMailActions(null) }}
          onSent={() => {
            if (pendingMailActions) {
              const idSet = new Set(pendingMailActions.taskIds)
              for (const doc of pendingMailActions.docIds) {
                logAction(doc.id, 'mail')
                if (doc.ephemeral) deleteReasonDoc(doc.id)
              }
              setTasks(prev => prev.filter(t => !idSet.has(t.id)))
              setPendingMailActions(null)
            }
          }}
        />
      )}
    </div>
  )
}

// ── Admin/Overview "Pick History" audit log ───────────────────────────────
// One document = one row: who uploaded/notified/picked/returned/mailed/
// downloaded it, each cell showing the LATEST who+when (a return-then-
// re-pick cycle updates "Picked" in place rather than adding a new row).
// The full raw event list still exists per document — "View" opens it in a
// popup for the rare case someone needs the entire timeline, not just the
// latest state of each action.
interface HistoryEvent { action: string; user_name: string; action_timestamp: string }
interface DocHistoryRow {
  document_id: string; file_name: string; doc_type: string; uploaded_by_name: string; uploaded_at: string
  reason?: string | null; reason_note?: string | null
  notify: HistoryEvent | null; pick: HistoryEvent | null; return: HistoryEvent | null
  mail: HistoryEvent | null; download: HistoryEvent | null; look: HistoryEvent | null
  history: HistoryEvent[]
}

function EventCell({ e }: { e: HistoryEvent | null }) {
  if (!e) return <span className="text-gray-300">—</span>
  return (
    <div>
      <p className="text-gray-700">{e.user_name || '—'}</p>
      <p className="text-gray-400 text-[10px]">{new Date(e.action_timestamp).toLocaleString('en-GB')}</p>
    </div>
  )
}

// ── Pending Final Document — CO/Phyto/SAFTA/any custom type sent with
// reason "Final Document" (SendModal). Picking is open to anyone, same
// model as Incoming — once picked, only that picker (or an admin, enforced
// server-side) can Reject (deletes the generated file + clears the saved
// link so it can be regenerated from scratch) or Done (uploads the scanned
// signed/stamped final PDF, which replaces the file at that same link).
function PendingFinalDocumentsPanel({ currentUserId, onCountChange }: { currentUserId: string; onCountChange?: (n: number) => void }) {
  const [tasks, setTasks] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  async function load(silent = false) {
    if (!silent) setLoading(true)
    try {
      const res = await fetch('/api/final-document-tasks', { headers: await authHeader() })
      const d = await res.json()
      if (res.ok) { setTasks(d.tasks || []); onCountChange?.((d.tasks || []).length) }
    } finally { if (!silent) setLoading(false) }
  }
  useEffect(() => {
    load()
    const t = setInterval(() => load(true), 15000)
    return () => clearInterval(t)
  }, [])

  async function act(taskId: string, body: Record<string, unknown>) {
    setBusyId(taskId)
    try {
      const res = await fetch('/api/final-document-tasks', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ task_id: taskId, ...body }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      await load()
    } catch (e: any) { alert(e.message) }
    finally { setBusyId(null) }
  }

  async function reject(taskId: string) {
    if (!confirm('Reject this document? The generated file will be deleted — it can be generated again from scratch after this.')) return
    await act(taskId, { action: 'reject' })
  }

  async function doneWithFile(task: any, file: File) {
    setBusyId(task.id)
    try {
      const base64 = await fileToBase64(file)
      const h = await authHeader()
      const upRes = await fetch('/api/upload-to-drive', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...h },
        body: JSON.stringify({ base64, fileName: file.name, mimeType: file.type || 'application/pdf', docType: task.document_type }),
      })
      const upData = await upRes.json()
      if (!upRes.ok || !upData.driveLink) throw new Error(upData.error || 'Upload failed')
      const res = await fetch('/api/final-document-tasks', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...h },
        body: JSON.stringify({ action: 'done', task_id: task.id, drive_url: upData.driveLink, file_name: file.name }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      await load()
    } catch (e: any) { alert(e.message) }
    finally { setBusyId(null) }
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold text-gray-900 text-sm flex items-center gap-2">
          <FileCheck size={15} className="text-green-600"/> Pending Final Document
          {tasks.length > 0 && <span className="text-[11px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full font-bold">{tasks.length}</span>}
        </h2>
        {loading && <Loader size={13} className="animate-spin text-gray-400"/>}
      </div>
      {tasks.length === 0 ? (
        <p className="text-xs text-gray-400 text-center py-6">No pending final documents</p>
      ) : (
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {tasks.map(t => {
            const pickedByMe = t.status === 'picked' && t.picked_by === currentUserId
            const pickedByOther = t.status === 'picked' && t.picked_by !== currentUserId
            const busy = busyId === t.id
            return (
              <div key={t.id} className="border border-gray-100 rounded-lg p-2.5">
                <div className="flex items-center justify-between mb-1.5 gap-2">
                  <span className="text-xs font-semibold text-gray-800">CUSDEC {t.cusdec_number || '—'} · {docTypeLabel(t.document_type)}</span>
                  <a href={t.drive_url} target="_blank" rel="noreferrer" className="text-[11px] text-blue-600 hover:underline flex-shrink-0">View</a>
                </div>
                {t.status === 'pending' && (
                  <button onClick={() => act(t.id, { action: 'pick' })} disabled={busy}
                    className="btn-secondary text-xs w-full flex items-center justify-center gap-1.5 disabled:opacity-50">
                    {busy ? <Loader size={12} className="animate-spin"/> : <UserCheck size={12}/>} Update
                  </button>
                )}
                {pickedByOther && <p className="text-[11px] text-gray-400">Picked by {t.picked_by_name || '—'}</p>}
                {pickedByMe && (
                  <div className="flex gap-1.5">
                    <button onClick={() => reject(t.id)} disabled={busy}
                      className="flex-1 text-xs py-1.5 rounded-md border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-50">
                      Reject
                    </button>
                    <label className={`flex-1 text-xs py-1.5 rounded-md text-white text-center font-medium ${busy ? 'bg-gray-300' : 'bg-green-600 hover:bg-green-700 cursor-pointer'}`}>
                      {busy ? 'Working…' : 'Done — Upload Scan'}
                      <input type="file" accept="application/pdf" className="hidden" disabled={busy}
                        onChange={e => { const f = e.target.files?.[0]; if (f) doneWithFile(t, f); e.target.value = '' }}/>
                    </label>
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

function PickHistoryPanel() {
  const { has } = usePermission()
  const canDelete = has('section:pick-history.delete')
  const [items, setItems] = useState<DocHistoryRow[]>([])
  const [loading, setLoading] = useState(false)
  const [fileName, setFileName] = useState('')
  const [user, setUser] = useState('')
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [reason, setReason] = useState('')
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [clearing, setClearing] = useState(false)
  const [viewing, setViewing] = useState<DocHistoryRow | null>(null)

  async function load(silent = false, targetPage = page) {
    if (!silent) setLoading(true)
    try {
      const params = new URLSearchParams()
      if (fileName) params.set('fileName', fileName)
      if (user) params.set('user', user)
      if (reason) params.set('reason', reason)
      params.set('page', String(targetPage))
      const res = await fetch(`/api/pick-history?${params.toString()}`, { headers: await authHeader() })
      const d = await res.json()
      if (res.ok) { setItems(d.items || []); setTotalPages(d.totalPages || 1) }
    } finally { if (!silent) setLoading(false) }
  }
  useEffect(() => { load(false, 1); setPage(1) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  // Live updates — same polling approach as Incoming, so a new pick/return/
  // mail/download shows up here without a manual Search click.
  useEffect(() => {
    const t = setInterval(() => load(true), 8000)
    return () => clearInterval(t)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function goToPage(p: number) {
    const clamped = Math.max(1, Math.min(totalPages, p))
    setPage(clamped)
    load(false, clamped)
  }

  async function remove(documentId: string) {
    if (!confirm('Delete this Processed History entry? This only clears the history log — the uploaded file and its data are not affected.')) return
    const res = await fetch(`/api/pick-history?document_id=${documentId}`, { method: 'DELETE', headers: await authHeader() })
    if (res.ok) setItems(prev => prev.filter(i => i.document_id !== documentId))
    else { const d = await res.json().catch(() => ({})); alert(d.error || 'Delete failed') }
  }

  function toggle(id: string) { setSelected(prev => ({ ...prev, [id]: !prev[id] })) }
  const selectedIds = Object.keys(selected).filter(id => selected[id])
  const allSelected = items.length > 0 && selectedIds.length === items.length
  function toggleAll() { setSelected(allSelected ? {} : Object.fromEntries(items.map(i => [i.document_id, true]))) }

  // Admin-only bulk purge — only ever removes pick_history_log rows (and
  // their audit copy in deleted_records, same as the single-delete path).
  // The uploaded file, its Drive copy, and the extracted data in the
  // doc-type table are never touched — strictly the audit trail.
  async function clearSelected() {
    if (!confirm(`Delete ${selectedIds.length} Processed History entr${selectedIds.length === 1 ? 'y' : 'ies'}? This only clears the history log — uploaded files and extracted data are not affected.`)) return
    setClearing(true)
    for (const id of selectedIds) {
      try { await fetch(`/api/pick-history?document_id=${id}`, { method: 'DELETE', headers: await authHeader() }) } catch {}
    }
    setSelected({})
    setClearing(false)
    load()
  }

  return (
    <div className="card mt-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold text-gray-900 text-sm flex items-center gap-2"><History size={16} className="text-gray-500"/>Processed History</h2>
        {canDelete && selectedIds.length > 0 && (
          <button onClick={clearSelected} disabled={clearing}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs text-white disabled:opacity-50" style={{ background: '#ef4444' }}>
            {clearing ? <Loader size={12} className="animate-spin"/> : <Trash2 size={12}/>} Delete Selected ({selectedIds.length})
          </button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <input value={fileName} onChange={e => setFileName(e.target.value)} placeholder="File name..." className="input max-w-[160px]"/>
        <input value={user} onChange={e => setUser(e.target.value)} placeholder="User..." className="input max-w-[140px]"/>
        <select value={reason} onChange={e => setReason(e.target.value)} className="input max-w-[150px]">
          <option value="">All reasons</option>
          <option value="CUSDEC Passed">CUSDEC Passed</option>
          <option value="Container Moved">Container Moved</option>
          <option value="Boat Note Passed">Boat Note Passed</option>
          <option value="Final Document">Final Document</option>
          <option value="Other">Other</option>
        </select>
        <button onClick={() => { setPage(1); load(false, 1) }} className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs text-white" style={{ background: '#1B3A5C' }}>
          <Search size={12}/> Search
        </button>
      </div>
      {loading ? (
        <div className="flex justify-center py-8"><Loader size={18} className="animate-spin text-gray-400"/></div>
      ) : items.length === 0 ? (
        <p className="text-xs text-gray-400 text-center py-6">No history yet</p>
      ) : (
        <>
        <div className="overflow-x-auto max-h-[28rem] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 sticky top-0"><tr>
              {(canDelete ? [''] : []).concat(['File', 'Uploaded', 'Notified', 'Picked', 'Mailed', 'Downloaded']).concat(['']).map((h, i) => (
                <th key={h || `h${i}`} className="text-left px-2 py-1.5 text-gray-500 font-medium whitespace-nowrap">
                  {canDelete && i === 0 ? (
                    <button onClick={toggleAll} className="text-gray-400 hover:text-gray-600">
                      {allSelected ? <CheckSquare size={13} className="text-green-600"/> : <Square size={13}/>}
                    </button>
                  ) : h}
                </th>
              ))}
            </tr></thead>
            <tbody>
              {items.map(row => (
                <tr key={row.document_id} className="border-t border-gray-50 align-top">
                  {canDelete && (
                    <td className="px-2 py-1.5">
                      <button onClick={() => toggle(row.document_id)} className="text-gray-300 hover:text-green-600">
                        {selected[row.document_id] ? <CheckSquare size={13} className="text-green-600"/> : <Square size={13}/>}
                      </button>
                    </td>
                  )}
                  <td className="px-2 py-1.5 text-gray-800 max-w-[160px]">
                    <span className="truncate block">{row.file_name || '—'}</span>
                    <ReasonBadge reason={row.reason} note={row.reason_note}/>
                  </td>
                  <td className="px-2 py-1.5"><EventCell e={{ action: 'upload', user_name: row.uploaded_by_name, action_timestamp: row.uploaded_at }}/></td>
                  <td className="px-2 py-1.5"><EventCell e={row.notify}/></td>
                  <td className="px-2 py-1.5">
                    <EventCell e={row.pick}/>
                    {row.return && row.return.action_timestamp > (row.pick?.action_timestamp || '') && (
                      <p className="text-amber-500 text-[10px] mt-0.5">Returned — back in pool</p>
                    )}
                  </td>
                  <td className="px-2 py-1.5"><EventCell e={row.mail}/></td>
                  <td className="px-2 py-1.5"><EventCell e={row.download}/></td>
                  <td className="px-2 py-1.5 whitespace-nowrap">
                    <div className="flex items-center gap-1.5">
                      <button onClick={() => setViewing(row)} className="text-gray-400 hover:text-gray-600" title="View full history"><Eye size={13}/></button>
                      {canDelete && (
                        <button onClick={() => remove(row.document_id)} className="text-red-400 hover:text-red-600" title="Delete">
                          <Trash2 size={12}/>
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-3 mt-3 text-xs text-gray-500">
            <button onClick={() => goToPage(page - 1)} disabled={page <= 1} className="disabled:opacity-30 hover:text-gray-800">Prev</button>
            <span>Page {page} / {totalPages}</span>
            <button onClick={() => goToPage(page + 1)} disabled={page >= totalPages} className="disabled:opacity-30 hover:text-gray-800">Next</button>
          </div>
        )}
        </>
      )}

      {viewing && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setViewing(null)}>
          <div className="bg-white rounded-2xl w-full max-w-md max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b">
              <p className="font-semibold text-sm truncate">{viewing.file_name}</p>
              <button onClick={() => setViewing(null)} className="text-gray-400 hover:text-gray-700">✕</button>
            </div>
            <div className="p-4 overflow-y-auto flex-1 space-y-2">
              <div className="text-xs border border-gray-100 rounded-lg p-2.5">
                <p className="font-medium text-gray-700 capitalize">upload</p>
                <p className="text-gray-500">{viewing.uploaded_by_name || '—'}</p>
                <p className="text-gray-400">{new Date(viewing.uploaded_at).toLocaleString('en-GB')}</p>
              </div>
              {viewing.history.map((e, i) => (
                <div key={i} className="text-xs border border-gray-100 rounded-lg p-2.5">
                  <p className="font-medium text-gray-700 capitalize">{e.action}</p>
                  <p className="text-gray-500">{e.user_name || '—'}</p>
                  <p className="text-gray-400">{new Date(e.action_timestamp).toLocaleString('en-GB')}</p>
                </div>
              ))}
              {viewing.history.length === 0 && <p className="text-xs text-gray-400 text-center py-4">No further activity yet</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
