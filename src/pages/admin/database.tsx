import { useState, useEffect, useCallback } from 'react'
import AdminLayout, { usePermission } from '@/components/admin/AdminLayout'
import {
  Database, RefreshCw, Trash2, Save, Loader, AlertTriangle, X,
} from 'lucide-react'

const TABLES = [
  { key: 'cusdec', label: 'CUSDEC' },
  { key: 'cdn', label: 'CDN' },
  { key: 'barcode', label: 'Barcode' },
  { key: 'boat_notes', label: 'Boat Notes' },
  { key: 'uploaded_documents', label: 'Uploaded Documents' },
  { key: 'pdf_templates', label: 'PDF Templates' },
  { key: 'messages', label: 'Messages' },
  { key: 'profiles', label: 'Users (Profiles)' },
]

type Row = Record<string, any>

function isJsonValue(v: any) {
  return v !== null && typeof v === 'object'
}

// usePermission() must run inside AdminLayout's Provider — calling it in the
// component that creates <AdminLayout> reads the context from above the
// Provider and always gets the default (has: () => false).
export default function DatabasePage() {
  return <AdminLayout><DatabaseContent/></AdminLayout>
}

function DatabaseContent() {
  const { has } = usePermission()
  const visibleTables = TABLES.filter(t => has(`section:database.${t.key}`))
  const [table, setTable] = useState('cusdec')
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [drafts, setDrafts] = useState<Record<string, Row>>({}) // row id -> edited copy
  const [savingId, setSavingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deletingAll, setDeletingAll] = useState(false)
  const [columns, setColumns] = useState<string[]>([])

  const load = useCallback(async () => {
    setLoading(true); setError(''); setDrafts({})
    try {
      const res = await fetch(`/api/admin-data?table=${table}`)
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Load failed')
      setRows(d.rows || [])
      setColumns(d.columns?.length ? d.columns : (d.rows?.length ? Object.keys(d.rows[0]) : []))
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [table])

  useEffect(() => { load() }, [load])

  // Jump to the first table this account is actually allowed to see
  useEffect(() => {
    if (visibleTables.length && !visibleTables.some(t => t.key === table)) setTable(visibleTables[0].key)
  }, [visibleTables, table])

  function draftFor(row: Row): Row {
    return drafts[row.id] || row
  }

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
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
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
    if (!confirm('Meka permanent delete ekak — confirm karanna?')) return
    setDeletingId(rowId)
    try {
      const res = await fetch(`/api/admin-data?table=${table}&id=${rowId}`, { method: 'DELETE' })
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
    if (!confirm(`"${table}" table eke row ${rows.length}ma permanent delete wenawa — confirm karanna?`)) return
    if (!confirm('Real confirm — meka undo karanna bæ. Ain karannada?')) return
    setDeletingAll(true)
    try {
      const res = await fetch(`/api/admin-data?table=${table}&all=true`, { method: 'DELETE' })
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
            <button onClick={load} className="flex items-center gap-1.5 px-3 py-2 text-xs rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50">
              <RefreshCw size={13}/> Refresh
            </button>
            <button onClick={deleteAll} disabled={deletingAll || !rows.length}
              className="flex items-center gap-1.5 px-3 py-2 text-xs rounded-lg border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-40">
              {deletingAll ? <Loader size={13} className="animate-spin"/> : <Trash2 size={13}/>}
              Delete All ({rows.length})
            </button>
          </div>
        </div>

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

        <div className="card overflow-auto" style={{ maxHeight: '70vh' }}>
          {loading ? (
            <div className="flex justify-center py-16"><Loader size={22} className="animate-spin text-gray-400"/></div>
          ) : columns.length === 0 ? (
            <div className="text-center py-16 text-gray-400 text-sm">No columns found for "{table}"</div>
          ) : (
            <table className="w-full text-xs border-collapse">
              <thead className="sticky top-0 bg-gray-50 z-10">
                <tr>
                  {columns.map(col => (
                    <th key={col} className="text-left px-3 py-2 text-gray-500 font-medium whitespace-nowrap border-b border-gray-100">{col}</th>
                  ))}
                  <th className="w-24 border-b border-gray-100"></th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr><td colSpan={columns.length + 1} className="text-center py-10 text-gray-400">No rows in "{table}" yet</td></tr>
                )}
                {rows.map(row => {
                  const draft = draftFor(row)
                  const dirty = !!drafts[row.id]
                  return (
                    <tr key={row.id} className={`border-b border-gray-50 ${dirty ? 'bg-amber-50' : 'hover:bg-gray-50'}`}>
                      {columns.map(col => {
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
                          {dirty && (
                            <button onClick={() => saveRow(row.id)} disabled={savingId === row.id}
                              title="Save changes"
                              className="w-7 h-7 rounded-md bg-green-600 text-white flex items-center justify-center hover:bg-green-700 disabled:opacity-50">
                              {savingId === row.id ? <Loader size={13} className="animate-spin"/> : <Save size={13}/>}
                            </button>
                          )}
                          <button onClick={() => deleteRow(row.id)} disabled={deletingId === row.id}
                            title="Delete row"
                            className="w-7 h-7 rounded-md border border-gray-200 text-gray-400 hover:text-red-500 hover:border-red-300 flex items-center justify-center disabled:opacity-50">
                            {deletingId === row.id ? <Loader size={13} className="animate-spin"/> : <Trash2 size={13}/>}
                          </button>
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
