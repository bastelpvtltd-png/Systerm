import { useState, useRef, useEffect, useCallback } from 'react'
import AdminLayout from '@/components/admin/AdminLayout'
import {
  Upload, FileText, Package, ScanLine, Ship, Copy,
  CheckCircle, Loader, Save, Eye, ExternalLink,
  RefreshCw, AlertTriangle, X, ChevronRight, Receipt
} from 'lucide-react'

type DocType = 'cusdec' | 'cdn' | 'barcode' | 'boat_note' | 'party_copy' | 'bill'
type PdfField = { grid: string; label: string; value: string }
type Panel = 'upload' | 'preview'

interface ErrorLog { time: string; step: string; msg: string }
interface DbRecord {
  id: string; doc_type: string; file_name: string
  drive_url: string; extracted_data: Record<string, string> | null; created_at: string
}

const DOC_TYPES: { key: DocType; label: string; icon: any; color: string; canExtract: boolean }[] = [
  { key: 'cusdec',     label: 'CUSDEC',       icon: FileText, color: '#1B3A5C', canExtract: true  },
  { key: 'cdn',        label: 'CDN',           icon: Package,  color: '#22A87A', canExtract: true  },
  { key: 'barcode',    label: 'Barcode',       icon: ScanLine, color: '#f59e0b', canExtract: false },
  { key: 'boat_note',  label: 'Boat Note',     icon: Ship,     color: '#3b82f6', canExtract: false },
  { key: 'party_copy', label: "Party's Copy",  icon: Copy,     color: '#8b5cf6', canExtract: false },
  { key: 'bill',       label: 'Bill',          icon: Receipt,  color: '#ef4444', canExtract: false },
]

const TYPE_COLORS: Record<string, string> = {
  cusdec: '#1B3A5C', cdn: '#22A87A', barcode: '#f59e0b',
  boat_note: '#3b82f6', party_copy: '#8b5cf6', bill: '#ef4444',
}

export default function DocumentsPage() {
  const [panel, setPanel]           = useState<Panel>('upload')
  const [activeType, setActiveType] = useState<DocType>('cusdec')
  const [uploading, setUploading]   = useState(false)
  const [extracting, setExtracting] = useState(false)
  const [saving, setSaving]         = useState(false)
  const [fields, setFields]         = useState<PdfField[]>([])
  const [rawText, setRawText]       = useState('')
  const [showRaw, setShowRaw]       = useState(false)
  const [fileName, setFileName]     = useState('')
  const [driveLink, setDriveLink]   = useState('')
  const [savedOk, setSavedOk]       = useState(false)
  const [statusMsg, setStatusMsg]   = useState('')
  const [errors, setErrors]         = useState<ErrorLog[]>([])
  const [showErrors, setShowErrors] = useState(false)
  // Preview state
  const [records, setRecords]       = useState<DbRecord[]>([])
  const [loadingRecs, setLoadingRecs] = useState(false)
  const [selectedRec, setSelectedRec] = useState<DbRecord | null>(null)
  const [filterType, setFilterType] = useState<string>('all')

  const fileRef = useRef<HTMLInputElement>(null)
  const activeDef = DOC_TYPES.find(d => d.key === activeType)!

  function logError(step: string, msg: string) {
    setErrors(prev => [{ time: new Date().toLocaleTimeString(), step, msg }, ...prev.slice(0, 49)])
  }

  function clearUpload() {
    setFields([]); setRawText(''); setFileName('')
    setDriveLink(''); setSavedOk(false); setStatusMsg('')
  }

  // Load preview records
  const loadRecords = useCallback(async () => {
    setLoadingRecs(true)
    try {
      const url = filterType === 'all'
        ? '/api/list-documents'
        : `/api/list-documents?doc_type=${filterType}`
      const res = await fetch(url)
      if (res.ok) { const d = await res.json(); setRecords(d.records || []) }
      else logError('list-documents', await res.text())
    } catch (e: any) {
      logError('list-documents', e.message)
    } finally { setLoadingRecs(false) }
  }, [filterType])

  useEffect(() => { if (panel === 'preview') loadRecords() }, [panel, loadRecords])

  async function handleFile(file: File) {
    clearUpload()
    setUploading(true)
    setFileName(file.name)
    setStatusMsg('Uploading...')

    try {
      const base64 = await fileToBase64(file)

      // 1. Upload to Drive/Storage
      let link = ''
      try {
        const dr = await fetch('/api/upload-to-drive', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ base64, fileName: file.name, mimeType: 'application/pdf' }),
        })
        const dd = await dr.json()
        if (dr.ok && dd.driveLink) {
          link = dd.driveLink
          setDriveLink(link)
          setStatusMsg('✓ Uploaded to storage')
        } else {
          const errMsg = dd.error || 'Upload failed'
          logError('upload-to-drive', errMsg)
          setStatusMsg(`⚠ Storage: ${errMsg}`)
        }
      } catch (e: any) {
        logError('upload-to-drive', e.message)
        setStatusMsg('⚠ Storage failed — continuing')
      }

      // 2. Extract if canExtract
      let extracted: PdfField[] = []
      if (activeDef.canExtract) {
        setExtracting(true)
        setStatusMsg('Extracting data...')
        try {
          const res = await fetch('/api/extract-pdf', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ base64, docType: activeType }),
          })
          const json = await res.json()
          if (!res.ok) throw new Error(json.error || 'Extraction failed')
          extracted = json.fields || []
          setRawText(json.rawText || '')
          setFields(extracted)
          const filled = extracted.filter(f => f.value).length
          setStatusMsg(`✓ Extracted ${filled}/${extracted.length} fields`)
          if (filled === 0) logError('extract-pdf', '0 fields matched — check Raw Text for PDF structure')
        } catch (e: any) {
          logError('extract-pdf', e.message)
          setStatusMsg(`✗ Extract failed: ${e.message}`)
        }
        setExtracting(false)
      } else {
        setStatusMsg(link ? '✓ Saved to storage' : '⚠ No storage link — ready to save')
      }

      // 3. Auto-save record to DB
      try {
        const sr = await fetch('/api/save-document', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            doc_type: activeType, file_name: file.name,
            file_url: '', drive_url: link,
            extracted_data: extracted.length
              ? Object.fromEntries(extracted.map(f => [`grid_${f.grid}`, f.value]))
              : null,
          }),
        })
        const sd = await sr.json()
        if (!sr.ok) { logError('save-document (auto)', sd.error); }
        else setSavedOk(true)
      } catch (e: any) { logError('save-document (auto)', e.message) }

    } catch (e: any) {
      logError('handleFile', e.message)
      setStatusMsg(`✗ Error: ${e.message}`)
    } finally { setUploading(false); setExtracting(false) }
  }

  async function handleSave() {
    setSaving(true)
    try {
      const res = await fetch('/api/save-document', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          doc_type: activeType, file_name: fileName || 'manual',
          file_url: '', drive_url: driveLink,
          extracted_data: fields.length
            ? Object.fromEntries(fields.map(f => [`grid_${f.grid}`, f.value]))
            : null,
        }),
      })
      const d = await res.json()
      if (!res.ok) { logError('save-document', d.error); setStatusMsg(`✗ Save failed: ${d.error}`) }
      else { setSavedOk(true); setStatusMsg('✓ Saved to database') }
    } catch (e: any) {
      logError('save-document', e.message)
      setStatusMsg(`✗ ${e.message}`)
    } finally { setSaving(false) }
  }

  function updateField(idx: number, val: string) {
    setFields(prev => prev.map((f, i) => i === idx ? { ...f, value: val } : f))
  }

  const filledCount = fields.filter(f => f.value).length
  const isProcessing = uploading || extracting

  return (
    <AdminLayout>
      <div className="p-6 h-full">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Documents</h1>
            <p className="text-gray-500 text-sm mt-0.5">Upload · Extract · Preview</p>
          </div>
          <div className="flex items-center gap-2">
            {/* Error Log toggle */}
            <button onClick={() => setShowErrors(v => !v)}
              className={`relative flex items-center gap-1.5 px-3 py-2 text-xs rounded-lg border transition-colors ${
                errors.length ? 'border-red-200 text-red-600 bg-red-50 hover:bg-red-100' : 'border-gray-200 text-gray-500 hover:bg-gray-50'
              }`}>
              <AlertTriangle size={13}/>
              Error Log
              {errors.length > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white text-xs rounded-full flex items-center justify-center leading-none">
                  {Math.min(errors.length, 9)}
                </span>
              )}
            </button>
            {/* Panel toggle */}
            <div className="flex bg-gray-100 rounded-lg p-0.5">
              {(['upload','preview'] as Panel[]).map(p => (
                <button key={p} onClick={() => setPanel(p)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors capitalize ${
                    panel === p ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                  }`}>{p}</button>
              ))}
            </div>
          </div>
        </div>

        {/* Error Log Drawer */}
        {showErrors && (
          <div className="mb-4 card border-red-100 bg-red-50">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-red-700 flex items-center gap-1.5">
                <AlertTriangle size={14}/> Error Log ({errors.length})
              </h3>
              <div className="flex gap-2">
                <button onClick={() => setErrors([])} className="text-xs text-red-500 hover:text-red-700">Clear</button>
                <button onClick={() => setShowErrors(false)}><X size={14} className="text-red-400"/></button>
              </div>
            </div>
            {errors.length === 0 ? (
              <p className="text-xs text-red-400">No errors</p>
            ) : (
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {errors.map((e, i) => (
                  <div key={i} className="text-xs bg-white rounded p-2 border border-red-100">
                    <span className="text-red-400 mr-1">[{e.time}]</span>
                    <span className="font-medium text-red-600">{e.step}:</span>{' '}
                    <span className="text-gray-700">{e.msg}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* === UPLOAD PANEL === */}
        {panel === 'upload' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

            {/* Left — Upload zone */}
            <div className="space-y-4">
              {/* Doc Type Tabs */}
              <div className="card p-3">
                <div className="flex flex-wrap gap-1.5">
                  {DOC_TYPES.map(d => {
                    const Icon = d.icon
                    return (
                      <button key={d.key}
                        onClick={() => { setActiveType(d.key); clearUpload() }}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                          activeType === d.key ? 'text-white border-transparent' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                        }`}
                        style={activeType === d.key ? { background: d.color } : {}}>
                        <Icon size={13}/>
                        {d.label}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Upload Zone */}
              <div className="card">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="font-semibold text-gray-900 text-sm flex items-center gap-2">
                    <activeDef.icon size={15} style={{ color: activeDef.color }}/>
                    Upload {activeDef.label}
                  </h2>
                  {fileName && (
                    <button onClick={clearUpload} className="text-gray-400 hover:text-gray-600"><X size={14}/></button>
                  )}
                </div>

                <div
                  onClick={() => { if (!isProcessing) fileRef.current?.click() }}
                  className={`border-2 border-dashed rounded-xl p-7 text-center transition-colors ${
                    isProcessing ? 'border-gray-100 cursor-default' : 'border-gray-200 cursor-pointer hover:bg-gray-50'
                  }`}
                  style={isProcessing ? {} : { borderColor: `${activeDef.color}40` }}>
                  {isProcessing ? (
                    <div className="flex flex-col items-center gap-2">
                      <Loader size={28} className="animate-spin" style={{ color: activeDef.color }}/>
                      <p className="text-xs text-gray-500">{statusMsg || 'Processing...'}</p>
                    </div>
                  ) : savedOk ? (
                    <div className="flex flex-col items-center gap-2">
                      <CheckCircle size={28} className="text-green-500"/>
                      <p className="text-xs font-medium text-gray-700">{fileName}</p>
                      <p className="text-xs text-gray-400">Click to upload another</p>
                    </div>
                  ) : fileName ? (
                    <div className="flex flex-col items-center gap-2">
                      <activeDef.icon size={28} style={{ color: activeDef.color }}/>
                      <p className="text-xs font-medium text-gray-700">{fileName}</p>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-3">
                      <Upload size={28} className="text-gray-300"/>
                      <div>
                        <p className="text-sm font-medium text-gray-600">Click to upload {activeDef.label}</p>
                        <p className="text-xs text-gray-400 mt-0.5">PDF · Auto-extracted & saved to Drive</p>
                      </div>
                    </div>
                  )}
                </div>
                <input ref={fileRef} type="file" accept=".pdf" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = '' }}/>

                {/* Status */}
                {statusMsg && !isProcessing && (
                  <p className={`text-xs mt-2.5 font-medium ${
                    statusMsg.startsWith('✓') ? 'text-green-600' :
                    statusMsg.startsWith('⚠') ? 'text-amber-600' : 'text-red-600'
                  }`}>{statusMsg}</p>
                )}

                {/* Drive link */}
                {driveLink && (
                  <a href={driveLink} target="_blank" rel="noreferrer"
                    className="mt-2.5 flex items-center gap-1.5 text-xs text-blue-600 bg-blue-50 px-3 py-2 rounded-lg hover:bg-blue-100">
                    <ExternalLink size={12}/> View file in storage
                  </a>
                )}

                {/* Save button (for manual re-save after editing) */}
                {fields.length > 0 && (
                  <button onClick={handleSave} disabled={saving}
                    className="mt-3 w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm text-white font-medium disabled:opacity-50"
                    style={{ background: activeDef.color }}>
                    {saving ? <Loader size={14} className="animate-spin"/> : <Save size={14}/>}
                    {savedOk ? 'Re-save to DB' : 'Save to DB'}
                  </button>
                )}
                {!activeDef.canExtract && fileName && !savedOk && (
                  <button onClick={handleSave} disabled={saving}
                    className="mt-3 w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm text-white font-medium disabled:opacity-50"
                    style={{ background: activeDef.color }}>
                    {saving ? <Loader size={14} className="animate-spin"/> : <Save size={14}/>}
                    Save to DB
                  </button>
                )}
              </div>

              {/* Raw Text (if extraction done) */}
              {rawText && (
                <div className="card">
                  <button onClick={() => setShowRaw(v => !v)}
                    className="flex items-center justify-between w-full text-xs text-gray-500">
                    <span className="flex items-center gap-1.5"><Eye size={12}/> Raw PDF Text</span>
                    <ChevronRight size={13} className={`transition-transform ${showRaw ? 'rotate-90' : ''}`}/>
                  </button>
                  {showRaw && (
                    <pre className="mt-2 text-xs bg-gray-50 rounded-lg p-3 overflow-auto max-h-52 text-gray-600 whitespace-pre-wrap">{rawText}</pre>
                  )}
                </div>
              )}
            </div>

            {/* Right — Extracted Fields */}
            <div className="card">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold text-gray-900">
                  {activeDef.canExtract ? 'Extracted Data' : 'Document Info'}
                </h2>
                {fields.length > 0 && (
                  <div className="flex items-center gap-2">
                    <div className="text-xs text-gray-400">{filledCount}/{fields.length} filled</div>
                    <div className="w-16 h-1.5 bg-gray-100 rounded-full">
                      <div className="h-1.5 rounded-full transition-all"
                        style={{ width: `${(filledCount/fields.length)*100}%`, background: activeDef.color }}/>
                    </div>
                  </div>
                )}
              </div>

              {extracting ? (
                <div className="flex flex-col items-center justify-center py-16 gap-3">
                  <Loader size={28} className="animate-spin" style={{ color: activeDef.color }}/>
                  <p className="text-sm text-gray-400">Extracting fields...</p>
                </div>
              ) : fields.length > 0 ? (
                <div className="overflow-auto max-h-[500px]">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-white">
                      <tr className="bg-gray-50">
                        <th className="text-left px-2 py-2 text-gray-500 font-medium w-12">Grid</th>
                        <th className="text-left px-2 py-2 text-gray-500 font-medium w-36">Field</th>
                        <th className="text-left px-2 py-2 text-gray-500 font-medium">Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {fields.map((f, i) => (
                        <tr key={i} className={`border-t border-gray-50 hover:bg-gray-50 ${!f.value ? 'opacity-60' : ''}`}>
                          <td className="px-2 py-1.5">
                            <span className="inline-block text-white text-xs font-mono px-1.5 py-0.5 rounded"
                              style={{ background: activeDef.color }}>{f.grid}</span>
                          </td>
                          <td className="px-2 py-1.5 text-gray-500">{f.label}</td>
                          <td className="px-2 py-1.5">
                            <input value={f.value} onChange={e => updateField(i, e.target.value)}
                              placeholder="—"
                              className="w-full bg-transparent border-b border-transparent hover:border-gray-200 focus:border-current focus:outline-none py-0.5 text-gray-800"
                              style={{ '--tw-ring-color': activeDef.color } as any}/>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <activeDef.icon size={36} className="mb-3 text-gray-200"/>
                  {activeDef.canExtract ? (
                    <>
                      <p className="text-sm text-gray-400">Upload a {activeDef.label} PDF</p>
                      <p className="text-xs text-gray-300 mt-1">Data will be auto-extracted by grid number</p>
                    </>
                  ) : (
                    <>
                      <p className="text-sm text-gray-400">{activeDef.label}</p>
                      <p className="text-xs text-gray-300 mt-1">Upload PDF → auto-saved to storage & DB</p>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* === PREVIEW PANEL === */}
        {panel === 'preview' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

            {/* Left — Records list */}
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
                    const Def = DOC_TYPES.find(d => d.key === rec.doc_type)
                    const Icon = Def?.icon || FileText
                    return (
                      <button key={rec.id} onClick={() => setSelectedRec(rec)}
                        className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-all text-left ${
                          selectedRec?.id === rec.id
                            ? 'border-2 bg-opacity-5'
                            : 'border-gray-100 hover:border-gray-200 hover:bg-gray-50'
                        }`}
                        style={selectedRec?.id === rec.id ? { borderColor: color, backgroundColor: `${color}10` } : {}}>
                        <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                          style={{ background: `${color}20` }}>
                          <Icon size={15} style={{ color }}/>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-800 truncate">{rec.file_name}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-xs px-1.5 py-0.5 rounded font-medium"
                              style={{ background: `${color}20`, color }}>
                              {rec.doc_type.replace('_', ' ').toUpperCase()}
                            </span>
                            <span className="text-xs text-gray-400">
                              {new Date(rec.created_at).toLocaleDateString('en-GB')}
                            </span>
                          </div>
                        </div>
                        {rec.drive_url && <ExternalLink size={13} className="text-gray-300 flex-shrink-0"/>}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Right — Detail view */}
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
                        {selectedRec.doc_type.replace('_', ' ').toUpperCase()} ·{' '}
                        {new Date(selectedRec.created_at).toLocaleString('en-GB')}
                      </p>
                    </div>
                    {selectedRec.drive_url && (
                      <a href={selectedRec.drive_url} target="_blank" rel="noreferrer"
                        className="flex items-center gap-1.5 text-xs text-white px-3 py-1.5 rounded-lg flex-shrink-0 ml-2"
                        style={{ background: TYPE_COLORS[selectedRec.doc_type] || '#1B3A5C' }}>
                        <ExternalLink size={12}/> Open File
                      </a>
                    )}
                  </div>

                  {selectedRec.extracted_data && Object.keys(selectedRec.extracted_data).length > 0 ? (
                    <div className="overflow-auto max-h-[460px]">
                      <table className="w-full text-xs">
                        <thead className="sticky top-0 bg-white">
                          <tr className="bg-gray-50">
                            <th className="text-left px-2 py-2 text-gray-500 font-medium w-14">Grid</th>
                            <th className="text-left px-2 py-2 text-gray-500 font-medium">Value</th>
                          </tr>
                        </thead>
                        <tbody>
                          {Object.entries(selectedRec.extracted_data)
                            .filter(([, v]) => v)
                            .map(([k, v], i) => {
                              const grid = k.replace('grid_', '')
                              const color = TYPE_COLORS[selectedRec.doc_type] || '#6b7280'
                              return (
                                <tr key={i} className="border-t border-gray-50 hover:bg-gray-50">
                                  <td className="px-2 py-1.5">
                                    <span className="inline-block text-white text-xs font-mono px-1.5 py-0.5 rounded"
                                      style={{ background: color }}>{grid}</span>
                                  </td>
                                  <td className="px-2 py-1.5 text-gray-700">{String(v)}</td>
                                </tr>
                              )
                            })}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="text-center py-10 text-gray-400 text-sm">
                      No extracted data — file stored only
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  )
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const reader = new FileReader()
    reader.onload  = () => res((reader.result as string).split(',')[1])
    reader.onerror = rej
    reader.readAsDataURL(file)
  })
}
