import { useCallback, useEffect, useRef, useState } from 'react'
import AdminLayout, { usePermission } from '@/components/admin/AdminLayout'
import {
  Upload, FileText, Package, ScanLine, Ship, Copy, Receipt,
  CheckCircle, Loader, Save, ExternalLink, AlertTriangle, X,
  Trash2, Pencil, FileWarning, Eye, RefreshCw,
} from 'lucide-react'

// Separate, reduced-access tab: upload, rename, see the auto-detected type,
// correct it if wrong, save, or delete — no box drawing or extraction-
// template editing (that lives on the full /admin/documents tab, which
// admin keeps for themselves). Who can see this tab is controlled per-user
// via allowed_tabs (AdminLayout + admin/users.tsx).

type DocType = 'cusdec' | 'cdn' | 'barcode' | 'boat_note' | 'party_copy' | 'bill'
type ItemStatus = 'reading' | 'extracting' | 'ready' | 'saving' | 'saved' | 'error'

interface UploadItem {
  id: string
  file: File
  fileName: string
  base64: string
  status: ItemStatus
  detectedType: DocType | ''
  fields: { key: string; value: string }[]
  scanned: boolean
  driveLink: string
  error: string
  pageImages: Record<number, string>
  numPages: number
  variant: 'native' | 'scanned'
}

const DOC_TYPES: { key: DocType; label: string; icon: any; color: string }[] = [
  { key: 'cusdec',     label: 'CUSDEC',       icon: FileText, color: '#1B3A5C' },
  { key: 'cdn',        label: 'CDN',           icon: Package,  color: '#22A87A' },
  { key: 'barcode',    label: 'Barcode',       icon: ScanLine, color: '#f59e0b' },
  { key: 'boat_note',  label: 'Boat Note',     icon: Ship,     color: '#3b82f6' },
  { key: 'party_copy', label: "Party's Copy",  icon: Copy,     color: '#8b5cf6' },
  { key: 'bill',       label: 'Bill',          icon: Receipt,  color: '#ef4444' },
]

const TYPE_COLORS: Record<string, string> = {
  cusdec: '#1B3A5C', cdn: '#22A87A', barcode: '#f59e0b',
  boat_note: '#3b82f6', party_copy: '#8b5cf6', bill: '#ef4444',
}

interface DbRecord {
  id: string; doc_type: string; file_name: string
  drive_url: string; extracted_data: Record<string, string> | null; created_at: string
}

function docDef(key: string) {
  return DOC_TYPES.find(d => d.key === key)
}

function statusLabel(it: UploadItem) {
  switch (it.status) {
    case 'reading':    return 'Reading...'
    case 'extracting': return 'Detecting type...'
    case 'ready':      return it.scanned ? 'Scanned — select type' : 'Ready to save'
    case 'saving':     return 'Saving...'
    case 'saved':      return 'Saved'
    case 'error':      return it.error || 'Error'
  }
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve((reader.result as string).split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

// usePermission() must run inside AdminLayout's Provider — calling it in the
// component that creates <AdminLayout> reads the context from above the
// Provider and always gets the default (has: () => false).
export default function DocumentsUploadPage() {
  return <AdminLayout><DocumentsUploadContent/></AdminLayout>
}

function DocumentsUploadContent() {
  const { has } = usePermission()
  const canUpload = has('section:documents-upload.upload')
  const canSeeUploaded = has('section:documents-upload.uploaded')
  const canPreview = has('section:documents-upload.preview')
  const [panel, setPanel] = useState<'upload' | 'preview'>('upload')
  const [items, setItems] = useState<UploadItem[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [viewPage, setViewPage] = useState(0)
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  // "All Documents" preview — same underlying upload/save flow, just showing
  // what's already been saved to Drive+DB (by anyone), not this session's list.
  const [records, setRecords] = useState<DbRecord[]>([])
  const [loadingRecs, setLoadingRecs] = useState(false)
  const [selectedRec, setSelectedRec] = useState<DbRecord | null>(null)
  const [filterType, setFilterType] = useState('all')
  const [recPage, setRecPage] = useState(0)
  const [recPageImages, setRecPageImages] = useState<Record<string, Record<number, string>>>({})
  const [recNumPages, setRecNumPages] = useState(1)
  const [recLoadingImg, setRecLoadingImg] = useState(false)

  const loadRecords = useCallback(async () => {
    setLoadingRecs(true)
    try {
      const url = filterType === 'all' ? '/api/list-documents' : `/api/list-documents?doc_type=${filterType}`
      const res = await fetch(url)
      if (res.ok) { const d = await res.json(); setRecords(d.records || []) }
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoadingRecs(false)
    }
  }, [filterType])

  useEffect(() => { if (panel === 'preview') loadRecords() }, [panel, loadRecords])
  useEffect(() => { setRecPage(0) }, [selectedRec?.id])
  useEffect(() => {
    if (!selectedRec || !selectedRec.drive_url) return
    if (recPageImages[selectedRec.id]?.[recPage]) return
    setRecLoadingImg(true)
    fetch('/api/render-drive-page', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ driveUrl: selectedRec.drive_url, page: recPage }),
    })
      .then(r => r.json())
      .then(d => {
        if (d.png) {
          setRecPageImages(prev => ({ ...prev, [selectedRec.id]: { ...(prev[selectedRec.id] || {}), [recPage]: d.png } }))
          setRecNumPages(d.numPages || 1)
        }
      })
      .catch(() => {})
      .finally(() => setRecLoadingImg(false))
  }, [selectedRec?.id, selectedRec?.drive_url, recPage])

  function updateItem(id: string, patch: Partial<UploadItem>) {
    setItems(prev => prev.map(it => it.id === id ? { ...it, ...patch } : it))
  }

  async function handleFiles(fileList: FileList | null) {
    if (!fileList || !fileList.length) return
    const pdfFiles = Array.from(fileList).filter(f => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'))
    const newItems: UploadItem[] = pdfFiles.map(file => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      file, fileName: file.name, base64: '', status: 'reading',
      detectedType: '', fields: [], scanned: false, driveLink: '', error: '',
      pageImages: {}, numPages: 1, variant: 'native',
    }))
    if (!newItems.length) return
    setItems(prev => [...prev, ...newItems])

    for (const item of newItems) {
      try {
        const base64 = await fileToBase64(item.file)
        updateItem(item.id, { base64, status: 'extracting' })
        const res = await fetch('/api/extract-pdf', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ base64 }),
        })
        const json = await res.json()
        if (!res.ok) throw new Error(json.error || 'Extraction failed')
        updateItem(item.id, {
          status: 'ready',
          detectedType: (json.detectedDocType as DocType) || '',
          fields: json.fields || [],
          scanned: !!json.scanned,
          variant: json.variant === 'scanned' ? 'scanned' : 'native',
        })
      } catch (e: any) {
        updateItem(item.id, { status: 'error', error: e.message })
        setError(e.message)
      }
    }
  }

  function removeItem(id: string) {
    setItems(prev => prev.filter(it => it.id !== id))
    if (selectedId === id) setSelectedId(null)
  }

  function startRename(item: UploadItem, e?: React.MouseEvent) {
    e?.stopPropagation()
    setRenamingId(item.id)
    setRenameValue(item.fileName)
  }
  function commitRename(id: string) {
    updateItem(id, { fileName: renameValue.trim() || 'document.pdf' })
    setRenamingId(null)
  }

  async function saveOne(item: UploadItem) {
    const docType = item.detectedType || 'cusdec'
    updateItem(item.id, { status: 'saving' })
    try {
      let link = ''
      try {
        const dr = await fetch('/api/upload-to-drive', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ base64: item.base64, fileName: item.fileName, mimeType: 'application/pdf', docType }),
        })
        const dd = await dr.json()
        if (dr.ok && dd.driveLink) link = dd.driveLink
      } catch {}

      const sr = await fetch('/api/save-document', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          doc_type: docType, file_name: item.fileName, file_url: '', drive_url: link,
          extracted_data: item.fields.length ? Object.fromEntries(item.fields.map(f => [`grid_${f.key}`, f.value])) : null,
        }),
      })
      const sd = await sr.json()
      if (!sr.ok) throw new Error(sd.error || 'Save failed')

      if (item.fields.length) {
        try {
          const data = Object.fromEntries(item.fields.map(f => [f.key, f.value]))
          await fetch('/api/save-to-table', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ doc_type: docType, data, drive_url: link }),
          })
        } catch {}
      }

      updateItem(item.id, { status: 'saved', driveLink: link })
    } catch (e: any) {
      updateItem(item.id, { status: 'error', error: e.message })
      setError(e.message)
    }
  }

  const selectedItem = items.find(it => it.id === selectedId) || null

  useEffect(() => { setViewPage(0) }, [selectedId])

  useEffect(() => {
    if (!selectedItem || selectedItem.pageImages[viewPage] || !selectedItem.base64) return
    const id = selectedItem.id
    fetch('/api/render-page', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ base64: selectedItem.base64, page: viewPage }),
    })
      .then(r => r.json())
      .then(d => {
        if (d.png) updateItem(id, {
          pageImages: { ...(items.find(it => it.id === id)?.pageImages || {}), [viewPage]: d.png },
          numPages: d.numPages || 1,
        })
      })
      .catch(() => {})
  }, [selectedItem?.id, viewPage])

  const readyCount = items.filter(it => it.status === 'ready').length

  return (
    <>
      <div className="p-6 max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-gray-900">Documents</h1>
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-blue-100 text-blue-700">Upload</span>
          </div>
          {canPreview && (
            <div className="flex bg-gray-100 rounded-lg p-0.5">
              {(['upload', 'preview'] as const).map(p => (
                <button key={p} onClick={() => setPanel(p)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors capitalize ${
                    panel === p ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                  }`}>{p}</button>
              ))}
            </div>
          )}
        </div>
        <p className="text-gray-500 text-sm mb-5">Upload a PDF, check its detected type, rename or remove it, then save.</p>

        {error && (
          <div className="mb-4 flex items-center justify-between bg-red-50 border border-red-100 rounded-lg px-3 py-2">
            <span className="text-xs text-red-600 flex items-center gap-1.5"><AlertTriangle size={13}/>{error}</span>
            <button onClick={() => setError('')}><X size={14} className="text-red-400"/></button>
          </div>
        )}

        {panel === 'upload' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {canUpload && (
          <div className={canSeeUploaded ? 'lg:col-span-2 card' : 'lg:col-span-3 card'}>
            <h2 className="font-semibold text-gray-900 text-sm mb-3">Upload PDFs</h2>
            <div
              onClick={() => fileRef.current?.click()}
              onDragOver={e => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={e => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files) }}
              className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors ${
                dragOver ? 'border-blue-400 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'
              }`}>
              <div className="flex flex-col items-center gap-3">
                <Upload size={28} className="text-gray-300"/>
                <div>
                  <p className="text-sm font-medium text-gray-600">Click or drag PDFs here</p>
                  <p className="text-xs text-gray-400 mt-0.5">Multiple files supported — type auto-detected per file</p>
                </div>
              </div>
            </div>
            <input ref={fileRef} type="file" accept=".pdf" multiple className="hidden"
              onChange={e => { handleFiles(e.target.files); e.target.value = '' }}/>
            {items.length > 0 && (
              <p className="text-xs text-gray-400 mt-3">{items.length} file{items.length !== 1 ? 's' : ''} · {readyCount} ready</p>
            )}
          </div>
          )}

          {canSeeUploaded && (
          <div className={canUpload ? 'card' : 'lg:col-span-3 card'}>
            <h2 className="font-semibold text-gray-900 text-sm mb-3">Uploaded ({items.length})</h2>
            {items.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-14 text-center">
                <FileText size={30} className="text-gray-200 mb-2"/>
                <p className="text-xs text-gray-400">No files yet</p>
              </div>
            ) : (
              <div className="space-y-1.5 max-h-[520px] overflow-y-auto">
                {items.map(it => {
                  const def = it.detectedType ? docDef(it.detectedType) : null
                  const Icon = def?.icon || FileWarning
                  const color = def?.color || '#9ca3af'
                  const openable = it.status !== 'reading' && it.status !== 'extracting'
                  return (
                    <div key={it.id}
                      onClick={() => openable && setSelectedId(it.id)}
                      className={`flex items-center gap-2 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                        selectedId === it.id ? 'border-2' : 'border-gray-100 hover:bg-gray-50'
                      }`}
                      style={selectedId === it.id ? { borderColor: color, backgroundColor: `${color}10` } : {}}>
                      <div className="w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0" style={{ background: `${color}20` }}>
                        {it.status === 'reading' || it.status === 'extracting' || it.status === 'saving'
                          ? <Loader size={13} className="animate-spin" style={{ color }}/>
                          : it.status === 'error'
                            ? <AlertTriangle size={13} className="text-red-500"/>
                            : it.status === 'saved'
                              ? <CheckCircle size={13} className="text-green-500"/>
                              : <Icon size={13} style={{ color }}/>}
                      </div>
                      <div className="flex-1 min-w-0">
                        {renamingId === it.id ? (
                          <input autoFocus value={renameValue}
                            onClick={e => e.stopPropagation()}
                            onChange={e => setRenameValue(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') commitRename(it.id); if (e.key === 'Escape') setRenamingId(null) }}
                            onBlur={() => commitRename(it.id)}
                            className="w-full text-xs border border-gray-300 rounded px-1.5 py-0.5"/>
                        ) : (
                          <p className="text-xs font-medium text-gray-800 truncate">{it.fileName}</p>
                        )}
                        <p className={`text-xs mt-0.5 truncate ${it.status === 'error' ? 'text-red-500' : 'text-gray-400'}`}>
                          {statusLabel(it)}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button onClick={e => startRename(it, e)} title="Rename" className="text-gray-300 hover:text-gray-600 p-1">
                          <Pencil size={12}/>
                        </button>
                        <button onClick={e => { e.stopPropagation(); openable && setSelectedId(it.id) }} title="View" className="text-gray-300 hover:text-blue-600 p-1">
                          <Eye size={12}/>
                        </button>
                        <button onClick={e => { e.stopPropagation(); removeItem(it.id) }} title="Delete" className="text-gray-300 hover:text-red-500 p-1">
                          <Trash2 size={12}/>
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
          )}
        </div>
        )}

        {/* All Documents preview — same upload/save flow, saved documents from anyone */}
        {panel === 'preview' && canPreview && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="card">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold text-gray-900">All Documents</h2>
                <div className="flex items-center gap-2">
                  <select value={filterType} onChange={e => setFilterType(e.target.value)}
                    className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white text-gray-600">
                    <option value="all">All types</option>
                    {DOC_TYPES.map(d => <option key={d.key} value={d.key}>{d.label}</option>)}
                  </select>
                  <button onClick={loadRecords} className="text-gray-400 hover:text-gray-700">
                    <RefreshCw size={14}/>
                  </button>
                </div>
              </div>

              {loadingRecs ? (
                <div className="flex justify-center py-10"><Loader size={20} className="animate-spin text-gray-400"/></div>
              ) : records.length === 0 ? (
                <div className="text-center py-10 text-gray-400 text-sm">No documents found</div>
              ) : (
                <div className="space-y-1.5 max-h-[500px] overflow-y-auto">
                  {records.map(rec => {
                    const color = TYPE_COLORS[rec.doc_type] || '#6b7280'
                    const Def = docDef(rec.doc_type)
                    const Icon = Def?.icon || FileText
                    return (
                      <button key={rec.id} onClick={() => setSelectedRec(rec)}
                        className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-all text-left ${
                          selectedRec?.id === rec.id ? 'border-2' : 'border-gray-100 hover:border-gray-200 hover:bg-gray-50'
                        }`}
                        style={selectedRec?.id === rec.id ? { borderColor: color, backgroundColor: `${color}10` } : {}}>
                        <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: `${color}20` }}>
                          <Icon size={15} style={{ color }}/>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-800 truncate">{rec.file_name}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-xs px-1.5 py-0.5 rounded font-medium" style={{ background: `${color}20`, color }}>
                              {rec.doc_type.replace('_', ' ').toUpperCase()}
                            </span>
                            <span className="text-xs text-gray-400">{new Date(rec.created_at).toLocaleDateString('en-GB')}</span>
                          </div>
                        </div>
                        {rec.drive_url && <ExternalLink size={13} className="text-gray-300 flex-shrink-0"/>}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            <div className="card">
              {!selectedRec ? (
                <div className="flex flex-col items-center justify-center py-20 text-center">
                  <Eye size={36} className="text-gray-200 mb-3"/>
                  <p className="text-sm text-gray-400">Select a document to preview</p>
                </div>
              ) : (
                <>
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <h2 className="font-semibold text-gray-900 truncate max-w-[260px]">{selectedRec.file_name}</h2>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {selectedRec.doc_type.replace('_', ' ').toUpperCase()} · {new Date(selectedRec.created_at).toLocaleString('en-GB')}
                      </p>
                    </div>
                    {selectedRec.drive_url && (
                      <a href={selectedRec.drive_url} target="_blank" rel="noreferrer"
                        className="flex items-center gap-1.5 text-xs text-white px-3 py-1.5 rounded-lg flex-shrink-0 ml-2"
                        style={{ background: TYPE_COLORS[selectedRec.doc_type] || '#1B3A5C' }}>
                        <ExternalLink size={12}/> Open in Drive
                      </a>
                    )}
                  </div>

                  {selectedRec.drive_url ? (
                    <div className="mb-4">
                      <div className="bg-gray-100 rounded-lg flex items-center justify-center min-h-[300px] overflow-auto">
                        {recLoadingImg && !recPageImages[selectedRec.id]?.[recPage] ? (
                          <Loader size={20} className="animate-spin text-gray-400"/>
                        ) : recPageImages[selectedRec.id]?.[recPage] ? (
                          <img src={`data:image/png;base64,${recPageImages[selectedRec.id][recPage]}`} className="max-w-full rounded" alt="Document page"/>
                        ) : (
                          <span className="text-xs text-gray-400">Could not render this page</span>
                        )}
                      </div>
                      {recNumPages > 1 && (
                        <div className="flex items-center justify-center gap-3 mt-2 text-xs">
                          <button onClick={() => setRecPage(p => Math.max(0, p - 1))} disabled={recPage === 0}
                            className="px-2 py-1 rounded border border-gray-200 disabled:opacity-30 hover:bg-gray-50">← Prev</button>
                          <span className="text-gray-500 font-medium">Page {recPage + 1} / {recNumPages}</span>
                          <button onClick={() => setRecPage(p => Math.min(recNumPages - 1, p + 1))} disabled={recPage >= recNumPages - 1}
                            className="px-2 py-1 rounded border border-gray-200 disabled:opacity-30 hover:bg-gray-50">Next →</button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="text-center py-6 text-gray-400 text-xs mb-2">No file link stored for this record</div>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Simple view/save popup — no box drawing or field editing (that stays on the full Documents tab) */}
      {selectedItem && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-0 sm:p-4"
          onClick={() => setSelectedId(null)}>
          <div className="bg-white sm:rounded-2xl shadow-2xl w-full h-full sm:h-auto sm:max-w-lg sm:max-h-[85vh] flex flex-col"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <div className="min-w-0">
                <h3 className="font-semibold text-gray-900 truncate">{selectedItem.fileName}</h3>
                <p className="text-xs text-gray-400 mt-0.5">{statusLabel(selectedItem)}</p>
              </div>
              <button onClick={() => setSelectedId(null)} className="text-gray-400 hover:text-gray-600 flex-shrink-0">
                <X size={18}/>
              </button>
            </div>

            <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-2">
              <span className="text-xs text-gray-500">Type:</span>
              <select value={selectedItem.detectedType}
                onChange={e => updateItem(selectedItem.id, { detectedType: e.target.value as DocType })}
                className="text-xs font-medium border border-gray-200 rounded-md px-2 py-1 bg-white">
                <option value="">— select —</option>
                {DOC_TYPES.map(d => <option key={d.key} value={d.key}>{d.label}</option>)}
              </select>
              <span
                className={`text-[11px] font-semibold px-2 py-1 rounded-md ${selectedItem.variant === 'scanned' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                {selectedItem.variant === 'scanned' ? '📷 Scanned / OCR' : '📄 Native Text'}
              </span>
              {selectedItem.driveLink && (
                <a href={selectedItem.driveLink} target="_blank" rel="noreferrer"
                  className="ml-auto flex items-center gap-1 text-xs text-blue-600 hover:underline">
                  <ExternalLink size={12}/> View in Drive
                </a>
              )}
            </div>

            <div className="flex-1 overflow-auto bg-gray-100 sm:p-3 flex items-center justify-center min-h-0">
              {selectedItem.pageImages[viewPage] ? (
                <img src={`data:image/png;base64,${selectedItem.pageImages[viewPage]}`} className="w-full h-full sm:w-auto sm:h-auto object-contain sm:rounded sm:shadow" alt="PDF page"/>
              ) : (
                <Loader size={20} className="animate-spin text-gray-400"/>
              )}
            </div>
            {selectedItem.numPages > 1 && (
              <div className="flex items-center justify-center gap-3 py-2 text-xs border-t border-gray-100">
                <button onClick={() => setViewPage(p => Math.max(0, p - 1))} disabled={viewPage === 0}
                  className="px-2 py-1 rounded border border-gray-200 disabled:opacity-30 hover:bg-gray-50">← Prev</button>
                <span className="text-gray-500 font-medium">Page {viewPage + 1} / {selectedItem.numPages}</span>
                <button onClick={() => setViewPage(p => Math.min(selectedItem.numPages - 1, p + 1))} disabled={viewPage >= selectedItem.numPages - 1}
                  className="px-2 py-1 rounded border border-gray-200 disabled:opacity-30 hover:bg-gray-50">Next →</button>
              </div>
            )}

            <div className="flex items-center justify-between px-5 py-4 border-t border-gray-100">
              <button onClick={() => removeItem(selectedItem.id)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-red-600 border border-red-200 hover:bg-red-50">
                <Trash2 size={13}/> Remove
              </button>
              <div className="flex items-center gap-2">
                <button onClick={() => setSelectedId(null)}
                  className="px-3 py-2 rounded-lg text-xs font-medium text-gray-500 hover:bg-gray-100">
                  Close
                </button>
                <button onClick={() => saveOne(selectedItem)} disabled={selectedItem.status === 'saving'}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-white disabled:opacity-50" style={{ background: '#1B3A5C' }}>
                  {selectedItem.status === 'saving' ? <Loader size={13} className="animate-spin"/> : <Save size={13}/>}
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
