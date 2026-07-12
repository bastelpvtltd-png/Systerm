import { useEffect, useState } from 'react'
import AdminLayout, { usePermission } from '@/components/admin/AdminLayout'
import { authHeader } from '@/lib/supabase'
import EmailPdfModal, { type EmailAttachment } from '@/components/admin/EmailPdfModal'
import {
  Ship, FileText, Package, Clock, AlertCircle, ChevronDown, Bell, Eye, UserCheck,
  Download, Mail, Undo2, Loader, History, Search, CheckSquare, Square, Trash2,
} from 'lucide-react'

interface PendingGroup<T> { count: number; items: T[] }
interface Summary {
  pendingCusdecPassed: PendingGroup<{ id: string; file_name: string; reason: string; reason_note: string | null; created_at: string }>
  shipmentsPending: PendingGroup<{ id: string; reference: string; shipper: string; invoice_number: string; packing_number: string; created_at: string }>
  cdnPending: PendingGroup<{ cusdecId: string; number: string; exporter: string; cap: number; cdnCount: number }>
  boatNotePending: PendingGroup<{ cusdecId: string; number: string; exporter: string; cap: number | null; cdnCount: number; passedCount: number }>
  releasePending: PendingGroup<{ cusdecId: string; number: string; exporter: string }>
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

// getLayout (see _app.tsx) keeps AdminLayout mounted across navigations
// instead of remounting the sidebar on every tab click.
export default function AdminDashboard() {
  return <DashboardContent/>
}
AdminDashboard.getLayout = (page: React.ReactElement) => <AdminLayout>{page}</AdminLayout>

function DashboardContent() {
  const [summary, setSummary] = useState<Summary>({
    pendingCusdecPassed: emptyGroup, shipmentsPending: emptyGroup, cdnPending: emptyGroup, boatNotePending: emptyGroup, releasePending: emptyGroup,
  })
  const [expanded, setExpanded] = useState<string | null>(null)
  // Bumped whenever Incoming's Pick succeeds, so My Picked Tasks re-fetches
  // immediately instead of needing a page refresh to show the new task.
  const [pickRefreshKey, setPickRefreshKey] = useState(0)

  useEffect(() => {
    async function load() {
      const res = await fetch('/api/dashboard-summary', { headers: await authHeader() })
      const d = await res.json()
      if (res.ok) {
        setSummary({
          pendingCusdecPassed: d.pendingCusdecPassed || emptyGroup,
          shipmentsPending: d.shipmentsPending || emptyGroup,
          cdnPending: d.cdnPending || emptyGroup,
          boatNotePending: d.boatNotePending || emptyGroup,
          releasePending: d.releasePending || emptyGroup,
        })
      }
    }
    load()
  }, [])

  const { has } = usePermission()

  const stats = [
    { key: 'section:dashboard.total-shipments',  id: 'pendingCusdec', label: 'Pending CUSDEC Passed',  value: summary.pendingCusdecPassed.count, icon: Ship,        color: '#1B3A5C' },
    { key: 'section:dashboard.cusdec-pending',   id: 'shipments',label: 'Shipments Pending (no CUSDEC yet)', value: summary.shipmentsPending.count, icon: FileText,    color: '#f59e0b' },
    { key: 'section:dashboard.cdn-pending',      id: 'cdn',      label: 'CDN Pending (CAP not complete)',    value: summary.cdnPending.count,       icon: Clock,       color: '#8b5cf6' },
    { key: 'section:dashboard.boatnote-pending', id: 'boatnote', label: 'Boat Note Pending',       value: summary.boatNotePending.count,    icon: Package,     color: '#3b82f6' },
    { key: 'section:dashboard.release-pending',  id: 'release',  label: 'Export Release Pending',  value: summary.releasePending.count,     icon: AlertCircle, color: '#ef4444' },
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
            {summary.shipmentsPending.items.length === 0 ? (
              <p className="text-xs text-gray-400 py-4 text-center">None — every open Shipment has a matching CUSDEC</p>
            ) : (
              <div className="space-y-1.5 max-h-96 overflow-y-auto">
                {summary.shipmentsPending.items.map(s => (
                  <div key={s.id} className="flex items-center justify-between text-xs border border-gray-100 rounded-lg p-2.5">
                    <div>
                      <p className="font-medium text-gray-800">{s.shipper} · Inv: {s.invoice_number}</p>
                      <p className="text-gray-400">Ref: {s.reference || '—'} · Packing: {s.packing_number || '—'}</p>
                    </div>
                    <a href={`/admin/drive-files?invoiceNumber=${encodeURIComponent(s.invoice_number)}`} className="text-blue-600 hover:underline flex-shrink-0">View →</a>
                  </div>
                ))}
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
                  <div key={c.cusdecId} className="flex items-center justify-between text-xs border border-gray-100 rounded-lg p-2.5">
                    <div>
                      <p className="font-medium text-gray-800">E {c.number}</p>
                      <p className="text-gray-400 truncate max-w-[240px]">{c.exporter}</p>
                    </div>
                    <span className="font-medium text-purple-700">{c.cdnCount}/{c.cap} CDN</span>
                    <a href={`/admin/drive-files?number=${encodeURIComponent(c.number)}`} className="text-blue-600 hover:underline flex-shrink-0">View →</a>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {expanded === 'boatnote' && (
          <div className="card mb-4">
            <h2 className="font-semibold text-gray-900 mb-3 text-sm">CAP complete, still waiting on Boat Note</h2>
            {summary.boatNotePending.items.length === 0 ? (
              <p className="text-xs text-gray-400 py-4 text-center">None — every CAP-complete CUSDEC has passed Boat Note</p>
            ) : (
              <div className="space-y-1.5 max-h-96 overflow-y-auto">
                {summary.boatNotePending.items.map(c => (
                  <div key={c.cusdecId} className="flex items-center justify-between text-xs border border-gray-100 rounded-lg p-2.5">
                    <div>
                      <p className="font-medium text-gray-800">E {c.number}</p>
                      <p className="text-gray-400 truncate max-w-[240px]">{c.exporter}</p>
                    </div>
                    <span className="font-medium text-blue-700">{c.passedCount}/{c.cdnCount} passed</span>
                    <a href={`/admin/drive-files?number=${encodeURIComponent(c.number)}`} className="text-blue-600 hover:underline flex-shrink-0">View →</a>
                  </div>
                ))}
              </div>
            )}
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
                    <a href={`/admin/drive-files?number=${encodeURIComponent(c.number)}`} className="text-blue-600 hover:underline flex-shrink-0">View →</a>
                  </div>
                ))}
              </div>
            )}
          </div>
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
  const [selected, setSelected] = useState<Record<string, boolean>>({})

  async function load() {
    setLoading(true)
    try {
      const res = await fetch('/api/user-tasks', { headers: await authHeader() })
      const d = await res.json()
      if (res.ok) setTasks(d.tasks || [])
    } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [refreshKey])

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
  function confirmReasonDelete(reason?: string | null): boolean {
    if (!reason) return true
    return confirm(`This document (reason: ${reason}) will be permanently removed after this. Continue with Mail/Download?`)
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
    const proceeding = selectedTasks.filter(t => confirmReasonDelete(t.document_uploads?.reason))
    const ids = new Set(proceeding.map(t => t.id))
    for (const t of proceeding) {
      if (!t.document_uploads?.drive_url) continue
      logAction(t.document_uploads.id, 'download')
      if (t.document_uploads.reason) deleteReasonDoc(t.document_uploads.id)
      window.open(t.document_uploads.drive_url, '_blank')
    }
    setTasks(prev => prev.filter(t => !ids.has(t.id)))
    setSelected({})
  }

  function mailSelected() {
    const proceeding = selectedTasks.filter(t => confirmReasonDelete(t.document_uploads?.reason))
    const ids = new Set(proceeding.map(t => t.id))
    const attachments = proceeding
      .filter(t => t.document_uploads?.drive_url)
      .map(t => {
        logAction(t.document_uploads.id, 'mail')
        if (t.document_uploads.reason) deleteReasonDoc(t.document_uploads.id)
        return { filename: t.document_uploads.file_name, url: t.document_uploads.drive_url }
      })
    if (attachments.length) setEmailAttachments(attachments)
    setTasks(prev => prev.filter(t => !ids.has(t.id)))
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
                      if (!confirmReasonDelete(t.document_uploads.reason)) return
                      logAction(t.document_uploads.id, 'download')
                      if (t.document_uploads.reason) deleteReasonDoc(t.document_uploads.id)
                      window.open(t.document_uploads.drive_url, '_blank')
                      setTasks(prev => prev.filter(x => x.id !== t.id))
                    }} className="flex items-center gap-1 px-2 py-1.5 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50">
                      <Download size={12}/>
                    </button>
                    <button onClick={() => {
                      if (!confirmReasonDelete(t.document_uploads.reason)) return
                      logAction(t.document_uploads.id, 'mail')
                      if (t.document_uploads.reason) deleteReasonDoc(t.document_uploads.id)
                      setEmailAttachments([{ filename: t.document_uploads.file_name, url: t.document_uploads.drive_url }])
                      setTasks(prev => prev.filter(x => x.id !== t.id))
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
      {emailAttachments && <EmailPdfModal attachments={emailAttachments} onClose={() => setEmailAttachments(null)}/>}
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
            {clearing ? <Loader size={12} className="animate-spin"/> : <Trash2 size={12}/>} Clear ({selectedIds.length})
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
