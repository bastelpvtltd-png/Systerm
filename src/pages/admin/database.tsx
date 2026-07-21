import { useState, useEffect, useCallback, useRef } from 'react'
import AdminLayout, { usePermission } from '@/components/admin/AdminLayout'
import { authHeader } from '@/lib/supabase'
import {
  Database, RefreshCw, Trash2, Save, Loader, AlertTriangle,
  ArrowUp, ArrowDown, ArrowUpDown, HardDrive, ChevronDown, ChevronUp,
  Archive, Download, Mail, ExternalLink,
} from 'lucide-react'
import EmailPdfModal from '@/components/admin/EmailPdfModal'

function formatBytes(bytes: number): string {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

interface StorageStats {
  drive: { totalUsedBytes: number; totalLimitBytes: number | null; folders: { docType: string; folderName: string; bytes: number; fileCount: number }[] } | { error: string }
  supabase: { tables: { key: string; label: string; rowCount: number | null }[] } | { error: string }
}

// Two clearly separate sections (Drive storage vs. Supabase data) rather
// than one merged number — they measure different things (file bytes vs.
// row counts) and mixing them into a single total would be meaningless.
function StorageStatsPanel() {
  const [stats, setStats] = useState<StorageStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    authHeader().then(h => fetch('/api/storage-stats', { headers: h }))
      .then(r => r.json()).then(setStats).catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return <div className="card mb-4 flex items-center justify-center py-6"><Loader size={18} className="animate-spin text-gray-400"/></div>
  }
  if (!stats) return null

  const drive = 'error' in stats.drive ? null : stats.drive
  const driveError = 'error' in stats.drive ? stats.drive.error : null
  const supabase = 'error' in stats.supabase ? null : stats.supabase
  const supabaseError = 'error' in stats.supabase ? stats.supabase.error : null
  const usedPct = drive && drive.totalLimitBytes ? Math.min(100, (drive.totalUsedBytes / drive.totalLimitBytes) * 100) : null

  return (
    <div className="card mb-4">
      <button onClick={() => setExpanded(x => !x)} className="w-full flex items-center justify-between">
        <h2 className="font-semibold text-gray-900 text-sm flex items-center gap-2"><HardDrive size={16}/>Storage</h2>
        {expanded ? <ChevronUp size={16} className="text-gray-400"/> : <ChevronDown size={16} className="text-gray-400"/>}
      </button>

      {expanded && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mt-4">
          {/* Google Drive */}
          <div>
            <h3 className="text-xs font-semibold text-gray-700 mb-2">Google Drive</h3>
            {driveError ? (
              <p className="text-xs text-red-500 flex items-center gap-1"><AlertTriangle size={12}/>{driveError}</p>
            ) : drive ? (
              <>
                <p className="text-xs text-gray-600 mb-1.5">
                  {formatBytes(drive.totalUsedBytes)}{drive.totalLimitBytes ? ` / ${formatBytes(drive.totalLimitBytes)}` : ' used (unlimited plan)'}
                </p>
                {usedPct !== null && (
                  <div className="w-full h-1.5 bg-gray-100 rounded-full mb-3 overflow-hidden">
                    <div className="h-full bg-blue-500 rounded-full" style={{ width: `${usedPct}%` }}/>
                  </div>
                )}
                <div className="space-y-1">
                  {drive.folders.map(f => (
                    <div key={f.docType} className="flex items-center justify-between text-xs">
                      <span className="text-gray-500">{f.folderName}</span>
                      <span className="text-gray-700 font-medium">{formatBytes(f.bytes)} <span className="text-gray-400 font-normal">({f.fileCount})</span></span>
                    </div>
                  ))}
                </div>
              </>
            ) : null}
          </div>

          {/* Supabase */}
          <div>
            <h3 className="text-xs font-semibold text-gray-700 mb-2">Supabase Database</h3>
            {supabaseError ? (
              <p className="text-xs text-red-500 flex items-center gap-1"><AlertTriangle size={12}/>{supabaseError}</p>
            ) : supabase ? (
              <div className="space-y-1">
                {supabase.tables.map(t => (
                  <div key={t.key} className="flex items-center justify-between text-xs">
                    <span className="text-gray-500">{t.label}</span>
                    <span className="text-gray-700 font-medium">{t.rowCount === null ? '—' : `${t.rowCount} row${t.rowCount === 1 ? '' : 's'}`}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  )
}

// Date-range export/cleanup for CUSDEC — filters (date range on either
// created_at or payment_complete_at, then shipper/reference/CUSDEC number,
// cascading in that order) build a zip of the 3 data sheets (CUSDEC/CDN/
// Barcode) plus every matched shipment's PDFs in its own Documents/<number>
// folder. Generating never deletes anything — cleanup is a separate,
// explicit, admin-only action after the zip is safely in hand.
function CusdecExportPanel() {
  const [expanded, setExpanded] = useState(false)
  const [dateField, setDateField] = useState<'created_at' | 'payment_complete_at'>('created_at')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [shipper, setShipper] = useState('')
  const [reference, setReference] = useState('')
  const [code, setCode] = useState('')
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<{ count: number; zipUrl: string; fileName: string; rangeLabel: string; matchedIds: string[] } | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleted, setDeleted] = useState(false)
  const [emailAttachments, setEmailAttachments] = useState<{ filename: string; url: string }[] | null>(null)

  async function generate() {
    if (!startDate || !endDate) { setError('Start and end date required'); return }
    setGenerating(true); setError(''); setResult(null); setDeleted(false)
    try {
      const res = await fetch('/api/database-export', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ startDate, endDate, dateField, shipper: shipper || undefined, reference: reference || undefined, code: code || undefined }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Export failed')
      if (!d.count) { setError('No matching CUSDECs for these filters'); return }
      setResult(d)
    } catch (e: any) { setError(e.message) }
    finally { setGenerating(false) }
  }

  async function deleteMatched() {
    if (!result) return
    if (!confirm(`Permanently delete ${result.count} CUSDEC row${result.count === 1 ? '' : 's'} and every linked CDN/Barcode/Boat Note row + Drive PDF? The zip you just generated is the only copy left afterward. This cannot be undone.`)) return
    setDeleting(true)
    try {
      const res = await fetch('/api/database-export', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ action: 'delete', ids: result.matchedIds }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Delete failed')
      setDeleted(true)
    } catch (e: any) { setError(e.message) }
    finally { setDeleting(false) }
  }

  return (
    <div className="card mb-4">
      <button onClick={() => setExpanded(x => !x)} className="w-full flex items-center justify-between">
        <h2 className="font-semibold text-gray-900 text-sm flex items-center gap-2"><Archive size={16}/>Date-Range Export (ZIP)</h2>
        {expanded ? <ChevronUp size={16} className="text-gray-400"/> : <ChevronDown size={16} className="text-gray-400"/>}
      </button>

      {expanded && (
        <div className="mt-4 space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Date field</label>
              <select value={dateField} onChange={e => setDateField(e.target.value as any)} className="input text-sm w-full">
                <option value="created_at">Created At</option>
                <option value="payment_complete_at">Payment Done Date</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">From</label>
              <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="input text-sm w-full"/>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">To</label>
              <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="input text-sm w-full"/>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Shipper (optional)</label>
              <input value={shipper} onChange={e => setShipper(e.target.value)} placeholder="First line of exporter" className="input text-sm w-full"/>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Reference (optional)</label>
              <input value={reference} onChange={e => setReference(e.target.value)} className="input text-sm w-full"/>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">CUSDEC Number (optional)</label>
              <input value={code} onChange={e => setCode(e.target.value)} className="input text-sm w-full"/>
            </div>
          </div>
          <p className="text-[11px] text-gray-400">Shipper/Reference/CUSDEC Number narrow further within the date range — leave all three blank to include every shipper in range.</p>

          <button onClick={generate} disabled={generating} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50" style={{ background: '#1B3A5C' }}>
            {generating ? <Loader size={14} className="animate-spin"/> : <Archive size={14}/>} Filter and Generate
          </button>

          {error && <p className="text-xs text-red-600 flex items-center gap-1"><AlertTriangle size={12}/>{error}</p>}

          {result && !deleted && (
            <div className="border border-gray-100 rounded-lg p-3 bg-gray-50/60">
              <p className="text-sm text-gray-800 font-medium mb-2">{result.fileName} — {result.count} CUSDEC{result.count === 1 ? '' : 's'}</p>
              <div className="flex items-center gap-2 flex-wrap">
                <a href={result.zipUrl} target="_blank" rel="noreferrer"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-white" style={{ background: '#1B3A5C' }}>
                  <Download size={12}/>Download
                </a>
                <button onClick={() => setEmailAttachments([{ filename: result.fileName, url: result.zipUrl }])}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-white" style={{ background: '#22A87A' }}>
                  <Mail size={12}/>Email
                </button>
                <a href={result.zipUrl} target="_blank" rel="noreferrer" className="text-xs text-blue-600 hover:underline flex items-center gap-1"><ExternalLink size={11}/>Open in Drive</a>
                <button onClick={deleteMatched} disabled={deleting}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-red-600 border border-red-200 hover:bg-red-50 disabled:opacity-50 ml-auto">
                  {deleting ? <Loader size={12} className="animate-spin"/> : <Trash2 size={12}/>} Delete these from the database
                </button>
              </div>
              <p className="text-[11px] text-gray-400 mt-2">The zip is already saved to Drive's "Export Archives" folder — safe to download/email whenever. Only click delete once you've confirmed the zip actually has what you need.</p>
            </div>
          )}
          {deleted && (
            <p className="text-xs text-green-700 bg-green-50 border border-green-100 rounded-lg px-3 py-2">Deleted {result?.count} CUSDEC{result?.count === 1 ? '' : 's'} and all linked data. The zip in Drive is unaffected.</p>
          )}
        </div>
      )}

      {emailAttachments && (
        <EmailPdfModal attachments={emailAttachments} documentReason={`Database Export — ${result?.rangeLabel}`} onClose={() => setEmailAttachments(null)}/>
      )}
    </div>
  )
}

const TABLES = [
  { key: 'cusdec', label: 'CUSDEC' },
  { key: 'cdn', label: 'CDN' },
  { key: 'barcode', label: 'Barcode' },
  { key: 'boat_notes', label: 'Boat Notes' },
  { key: 'uploaded_documents', label: 'Uploaded Documents' },
  { key: 'pdf_templates', label: 'PDF Templates' },
  { key: 'messages', label: 'Messages' },
  { key: 'profiles', label: 'Users (Profiles)' },
  { key: 'temporary_shipments', label: 'Shipment Entry' },
]

type Row = Record<string, any>

function isJsonValue(v: any) {
  return v !== null && typeof v === 'object'
}

// getLayout (see _app.tsx) keeps AdminLayout mounted across navigations
// instead of remounting the sidebar on every tab click.
export default function DatabasePage() {
  return <DatabaseContent/>
}
DatabasePage.getLayout = (page: React.ReactElement) => <AdminLayout>{page}</AdminLayout>

const ROW_COLORS = [
  { value: '', label: 'None', dot: 'bg-gray-200' },
  { value: 'green', label: 'Green', dot: 'bg-green-500' },
  { value: 'blue', label: 'Blue', dot: 'bg-blue-500' },
]
const ROW_COLOR_BG: Record<string, string> = { green: 'bg-green-50', blue: 'bg-blue-50' }

function DatabaseContent() {
  const { has, isAdmin } = usePermission()
  const visibleTables = TABLES.filter(t => has(`section:database.${t.key}`))
  const canDelete = has('section:database.delete')
  const [table, setTable] = useState('cusdec')
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [drafts, setDrafts] = useState<Record<string, Row>>({}) // row id -> edited copy
  const [savingId, setSavingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deletingAll, setDeletingAll] = useState(false)
  const [columns, setColumns] = useState<string[]>([])
  const [sortCol, setSortCol] = useState('created_at')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  // CUSDEC's own color picks, keyed by "code|number" — looked up when viewing
  // the CDN table so a CDN row can inherit its parent CUSDEC's color without
  // storing the color a second time on the cdn row itself.
  const [cusdecColors, setCusdecColors] = useState<Record<string, string>>({})

  // Tracks whether there are any unsaved cell edits right now, without
  // making the polling effect below depend on (and re-create its interval
  // on) every keystroke — the poll checks this ref instead of the `drafts`
  // state directly.
  const draftsRef = useRef(drafts)
  useEffect(() => { draftsRef.current = drafts }, [drafts])

  const load = useCallback(async (silent = false) => {
    if (!silent) { setLoading(true); setError(''); setDrafts({}) }
    try {
      const res = await fetch(`/api/admin-data?table=${table}`, { headers: await authHeader() })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Load failed')
      setRows(d.rows || [])
      setColumns(d.columns?.length ? d.columns : (d.rows?.length ? Object.keys(d.rows[0]) : []))
    } catch (e: any) {
      if (!silent) setError(e.message)
    } finally {
      if (!silent) setLoading(false)
    }
  }, [table])

  useEffect(() => {
    load()
    // Live — but skips entirely while any cell is mid-edit (unsaved draft),
    // since a refresh would otherwise silently wipe it out from under the
    // user. Once every draft is saved or discarded, polling resumes.
    const t = setInterval(() => {
      if (Object.keys(draftsRef.current).length === 0) load(true)
    }, 15000)
    return () => clearInterval(t)
  }, [load])

  // Jump to the first table this account is actually allowed to see
  useEffect(() => {
    if (visibleTables.length && !visibleTables.some(t => t.key === table)) setTable(visibleTables[0].key)
  }, [visibleTables, table])

  // On the CUSDEC tab the color lives right on `rows`; on the CDN tab (or any
  // other) fetch just the CUSDEC color map so CDN rows can show their parent's
  // color automatically.
  useEffect(() => {
    if (table === 'cusdec' || !has('section:database.cusdec')) return
    let cancelled = false
    async function loadColors() {
      try {
        const res = await fetch('/api/admin-data?table=cusdec', { headers: await authHeader() })
        const d = await res.json()
        if (cancelled || !res.ok) return
        const map: Record<string, string> = {}
        for (const r of (d.rows || [])) if (r.row_color) map[`${r.code}|${r.number}`] = r.row_color
        setCusdecColors(map)
      } catch {}
    }
    loadColors()
    const t = setInterval(loadColors, 15000)
    return () => { cancelled = true; clearInterval(t) }
  }, [table]) // eslint-disable-line react-hooks/exhaustive-deps

  async function setRowColor(rowId: string, color: string) {
    try {
      const res = await fetch('/api/admin-data', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ table: 'cusdec', id: rowId, updates: { row_color: color || null } }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Save failed')
      setRows(prev => prev.map(r => r.id === rowId ? { ...r, row_color: color || null } : r))
    } catch (e: any) {
      alert('Color update failed: ' + e.message)
    }
  }

  function draftFor(row: Row): Row {
    return drafts[row.id] || row
  }

  const visibleColumns = columns.filter(col => col !== 'row_color')

  const sortedRows = [...rows].sort((a, b) => {
    const av = a[sortCol], bv = b[sortCol]
    if (av == null && bv == null) return 0
    if (av == null) return 1
    if (bv == null) return -1
    const an = Number(av), bn = Number(bv)
    const cmp = !Number.isNaN(an) && !Number.isNaN(bn) ? an - bn : String(av).localeCompare(String(bv))
    return sortDir === 'asc' ? cmp : -cmp
  })

  function setCell(rowId: string, col: string, value: any) {
    setDrafts(prev => ({ ...prev, [rowId]: { ...(prev[rowId] || rows.find(r => r.id === rowId)), [col]: value } }))
  }

  async function saveRow(rowId: string) {
    const draft = drafts[rowId]
    if (!draft) return
    setSavingId(rowId)
    try {
      const { id, created_at, ...updates } = draft
      const res = await fetch('/api/admin-data', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ table, id: rowId, updates }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Save failed')
      setRows(prev => prev.map(r => r.id === rowId ? draft : r))
      setDrafts(prev => { const n = { ...prev }; delete n[rowId]; return n })
    } catch (e: any) {
      alert('Save failed: ' + e.message)
    } finally {
      setSavingId(null)
    }
  }

  async function deleteRow(rowId: string) {
    if (!confirm('Meka permanent-ma delete wenawa (PDF file eka Drive eken ekkath ain wenawa) — undo karanna bæ. Confirm karanawada?')) return
    setDeletingId(rowId)
    try {
      const res = await fetch(`/api/admin-data?table=${table}&id=${rowId}`, { method: 'DELETE', headers: await authHeader() })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Delete failed')
      setRows(prev => prev.filter(r => r.id !== rowId))
    } catch (e: any) {
      alert('Delete failed: ' + e.message)
    } finally {
      setDeletingId(null)
    }
  }

  async function deleteAll() {
    if (!confirm(`"${table}" table eke row ${rows.length}ma permanent-ma delete wenawa (adala PDF files okkoma Drive eken ekkath ain wenawa) — undo karanna bæ. Confirm karanawada?`)) return
    setDeletingAll(true)
    try {
      const res = await fetch(`/api/admin-data?table=${table}&all=true`, { method: 'DELETE', headers: await authHeader() })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Delete failed')
      setRows([])
    } catch (e: any) {
      alert('Delete all failed: ' + e.message)
    } finally {
      setDeletingAll(false)
    }
  }

  return (
      <div className="p-6">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><Database size={22}/> Database</h1>
            <p className="text-gray-500 text-sm mt-0.5">View · Edit · Delete — table wise</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => load()} className="flex items-center gap-1.5 px-3 py-2 text-xs rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50">
              <RefreshCw size={13}/> Refresh
            </button>
            {canDelete && (
              <button onClick={deleteAll} disabled={deletingAll || !rows.length}
                className="flex items-center gap-1.5 px-3 py-2 text-xs rounded-lg border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-40">
                {deletingAll ? <Loader size={13} className="animate-spin"/> : <Trash2 size={13}/>}
                Delete All ({rows.length})
              </button>
            )}
          </div>
        </div>

        <StorageStatsPanel/>

        {table === 'cusdec' && isAdmin && <CusdecExportPanel/>}

        {/* Table tabs */}
        <div className="flex gap-1.5 mb-4 flex-wrap">
          {visibleTables.map(t => (
            <button key={t.key} onClick={() => setTable(t.key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                table === t.key ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
              }`}>
              {t.label}
            </button>
          ))}
        </div>

        {error && (
          <div className="mb-4 flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
            <AlertTriangle size={14}/> {error}
          </div>
        )}

        <div className="card overflow-auto" style={{ maxHeight: '85vh' }}>
          {loading ? (
            <div className="flex justify-center py-16"><Loader size={22} className="animate-spin text-gray-400"/></div>
          ) : columns.length === 0 ? (
            <div className="text-center py-16 text-gray-400 text-sm">No columns found for "{table}"</div>
          ) : (
            <table className="w-full text-xs border-collapse">
              <thead className="sticky top-0 bg-gray-50 z-10">
                <tr>
                  {visibleColumns.map(col => (
                    <th key={col} onClick={() => setSortCol(prev => {
                        if (prev === col) { setSortDir(d => d === 'asc' ? 'desc' : 'asc'); return prev }
                        setSortDir('asc'); return col
                      })}
                      title="Click to sort by this column"
                      className="text-left px-3 py-2 text-gray-500 font-medium whitespace-nowrap border-b border-gray-100 cursor-pointer select-none hover:text-gray-800">
                      <span className="flex items-center gap-1">
                        {col}
                        {sortCol === col ? (sortDir === 'asc' ? <ArrowUp size={11}/> : <ArrowDown size={11}/>) : <ArrowUpDown size={11} className="text-gray-300"/>}
                      </span>
                    </th>
                  ))}
                  <th className="w-24 border-b border-gray-100"></th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr><td colSpan={visibleColumns.length + 1} className="text-center py-10 text-gray-400">No rows in "{table}" yet</td></tr>
                )}
                {sortedRows.map(row => {
                  const draft = draftFor(row)
                  const dirty = !!drafts[row.id]
                  const statusColor = row.export_release_passed ? 'border-l-4 border-l-green-500' : row.boat_note_passed ? 'border-l-4 border-l-blue-500' : ''
                  const manualColor = table === 'cusdec' ? (row.row_color || '') : (cusdecColors[`${row.code}|${row.cusdec_number}`] || '')
                  const colorBg = ROW_COLOR_BG[manualColor] || ''
                  return (
                    <tr key={row.id} className={`border-b border-gray-50 ${dirty ? 'bg-amber-50' : colorBg || 'hover:bg-gray-50'} ${statusColor}`}>
                      {visibleColumns.map(col => {
                        const val = draft[col]
                        const readOnly = col === 'id' || col === 'created_at'
                        if (isJsonValue(val)) {
                          return (
                            <td key={col} className="px-3 py-1.5 align-top">
                              <textarea
                                value={JSON.stringify(val, null, 2)}
                                onChange={e => {
                                  try { setCell(row.id, col, JSON.parse(e.target.value)) }
                                  catch { /* ignore until valid JSON */ }
                                }}
                                rows={3}
                                className="w-56 text-[10px] font-mono bg-transparent border border-gray-100 rounded px-1.5 py-1 focus:outline-none focus:border-gray-300"
                              />
                            </td>
                          )
                        }
                        // A single-line <input> can't hold a line break at all — editing a
                        // multi-line value in one and saving it back flattens/loses the
                        // wrapping. A <textarea> keeps \n through display, edit, and save.
                        const strVal = val == null ? '' : String(val)
                        return (
                          <td key={col} className="px-3 py-1.5 align-top">
                            <textarea
                              value={strVal}
                              disabled={readOnly}
                              onChange={e => setCell(row.id, col, e.target.value)}
                              rows={Math.min(6, Math.max(1, strVal.split('\n').length))}
                              className={`min-w-[140px] max-w-[260px] max-h-32 overflow-y-auto bg-transparent border-b outline-none py-0.5 resize-none leading-tight whitespace-pre-wrap ${
                                readOnly ? 'text-gray-400 border-transparent' : 'text-gray-800 border-transparent hover:border-gray-200 focus:border-gray-400'
                              }`}
                            />
                          </td>
                        )
                      })}
                      <td className="px-2 py-1.5 whitespace-nowrap">
                        <div className="flex items-center gap-1">
                          {table === 'cusdec' && (
                            <select value={row.row_color || ''} onChange={e => setRowColor(row.id, e.target.value)}
                              title="Row color (also applied to this CUSDEC's CDN rows)"
                              className="text-[10px] border border-gray-200 rounded px-1 py-1 bg-white text-gray-600">
                              {ROW_COLORS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                            </select>
                          )}
                          {dirty && (
                            <button onClick={() => saveRow(row.id)} disabled={savingId === row.id}
                              title="Save changes"
                              className="w-7 h-7 rounded-md bg-green-600 text-white flex items-center justify-center hover:bg-green-700 disabled:opacity-50">
                              {savingId === row.id ? <Loader size={13} className="animate-spin"/> : <Save size={13}/>}
                            </button>
                          )}
                          {canDelete && (
                            <button onClick={() => deleteRow(row.id)} disabled={deletingId === row.id}
                              title="Delete row"
                              className="w-7 h-7 rounded-md border border-gray-200 text-gray-400 hover:text-red-500 hover:border-red-300 flex items-center justify-center disabled:opacity-50">
                              {deletingId === row.id ? <Loader size={13} className="animate-spin"/> : <Trash2 size={13}/>}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
        <p className="text-xs text-gray-400 mt-2">Showing latest {rows.length} rows (max 300).</p>
      </div>
  )
}
