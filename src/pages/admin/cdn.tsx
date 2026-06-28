import { useState, useRef, useEffect } from 'react'
import AdminLayout from '@/components/admin/AdminLayout'
import {
  Upload, FileText, Save, Loader, CheckCircle,
  Eye, ExternalLink, RefreshCw, X, ChevronRight,
} from 'lucide-react'

// CDN field definitions — matches extractCdn() keys in extractors.ts
const CDN_FIELDS = [
  { key: 'cdn_no',        label: 'CDN No.' },
  { key: 'bl_no',         label: 'B/L No. (SN)' },
  { key: 'slpa_no',       label: 'SLPA No. (10)' },
  { key: 'seal_no',       label: 'Seal No. (11.a)' },
  { key: 'shipper',       label: 'Shipper (1.a)' },
  { key: 'cusdec_no',     label: 'Cusdec Numbers (1.b)' },
  { key: 'consignee',     label: 'Consignee (2.b)' },
  { key: 'voyage_no',     label: 'Voyage No./Date (3.a)' },
  { key: 'vessel',        label: 'Vessel (4)' },
  { key: 'port_discharge',label: 'Port of Discharge (5)' },
  { key: 'lorry_no',      label: 'Lorry/Trailer No. (7)' },
  { key: 'driver_name',   label: 'Name of Driver (12)' },
  { key: 'container_no',  label: 'Container No.' },
  { key: 'gross_mass',    label: 'Gross Weight (Kg)' },
  { key: 'goods',         label: 'Description of Goods (20)' },
] as const

type FieldKey = typeof CDN_FIELDS[number]['key']

const COLOR = '#22A87A'

interface SavedRecord {
  id: string
  file_name: string
  drive_url: string
  extracted_data: Record<string, string> | null
  created_at: string
}

const emptyFields = () =>
  Object.fromEntries(CDN_FIELDS.map(f => [f.key, ''])) as Record<FieldKey, string>

function fileToBase64(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const reader = new FileReader()
    reader.onload  = () => res((reader.result as string).split(',')[1])
    reader.onerror = rej
    reader.readAsDataURL(file)
  })
}

export default function CdnPage() {
  const [uploading, setUploading]   = useState(false)
  const [extracting, setExtracting] = useState(false)
  const [saving, setSaving]         = useState(false)
  const [fileName, setFileName]     = useState('')
  const [driveLink, setDriveLink]   = useState('')
  const [fields, setFields]         = useState<Record<FieldKey, string>>(emptyFields())
  const [rawText, setRawText]       = useState('')
  const [showRaw, setShowRaw]       = useState(false)
  const [status, setStatus]         = useState('')
  const [statusType, setStatusType] = useState<'ok' | 'warn' | 'err'>('ok')
  const [saved, setSaved]           = useState(false)
  const [records, setRecords]       = useState<SavedRecord[]>([])
  const [loadingRecs, setLoadingRecs] = useState(false)
  const [activeId, setActiveId]     = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const setMsg = (m: string, t: 'ok' | 'warn' | 'err' = 'ok') => { setStatus(m); setStatusType(t) }

  useEffect(() => { loadRecords() }, [])

  async function loadRecords() {
    setLoadingRecs(true)
    try {
      const res = await fetch('/api/list-documents?doc_type=cdn')
      if (res.ok) { const d = await res.json(); setRecords(d.records || []) }
    } finally { setLoadingRecs(false) }
  }

  function loadRecord(rec: SavedRecord) {
    setActiveId(rec.id)
    setFileName(rec.file_name)
    setDriveLink(rec.drive_url || '')
    setSaved(true)
    setMsg('✓ Record loaded', 'ok')
    const loaded = emptyFields()
    if (rec.extracted_data) {
      Object.entries(rec.extracted_data).forEach(([k, v]) => {
        const key = k.replace('grid_', '') as FieldKey
        if (key in loaded) loaded[key] = String(v)
      })
    }
    setFields(loaded)
  }

  function clearForm() {
    setFileName(''); setDriveLink(''); setRawText('')
    setFields(emptyFields()); setSaved(false); setStatus(''); setActiveId(null)
  }

  async function handleFile(file: File) {
    clearForm()
    setUploading(true)
    setFileName(file.name)
    setMsg('Uploading...', 'ok')

    try {
      const base64 = await fileToBase64(file)

      // Upload to storage
      try {
        const dr = await fetch('/api/upload-to-drive', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ base64, fileName: file.name, mimeType: 'application/pdf' }),
        })
        const dd = await dr.json()
        if (dr.ok && dd.driveLink) { setDriveLink(dd.driveLink); setMsg('✓ Uploaded', 'ok') }
        else setMsg(`⚠ Storage: ${dd.error || 'failed'}`, 'warn')
      } catch { setMsg('⚠ Storage failed — continuing', 'warn') }

      // Extract using smart-detect with forceType='cdn'
      setExtracting(true)
      setMsg('Extracting fields...', 'ok')

      const res  = await fetch('/api/smart-detect', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base64, forceType: 'cdn' }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Extraction failed')

      if (json.scanned) {
        setMsg('⚠ Scanned PDF — text not extractable. Fill fields manually.', 'warn')
      } else {
        setRawText(json.rawText || '')
        const merged = emptyFields()
        ;(json.fields || []).forEach((f: { key: string; value: string }) => {
          if (f.key in merged) merged[f.key as FieldKey] = f.value
        })
        setFields(merged)
        const filled = (json.fields || []).filter((f: any) => f.value).length
        setMsg(
          filled > 0
            ? `✓ Extracted ${filled}/${json.fields.length} fields`
            : '⚠ 0 fields matched — fill manually or check raw text',
          filled > 3 ? 'ok' : 'warn',
        )
      }
    } catch (e: any) {
      setMsg(`✗ ${e.message}`, 'err')
    } finally {
      setUploading(false)
      setExtracting(false)
    }
  }

  async function handleSave() {
    setSaving(true)
    try {
      const extracted = Object.fromEntries(
        Object.entries(fields).map(([k, v]) => [`grid_${k}`, v])
      )
      const res = await fetch('/api/save-document', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          doc_type: 'cdn',
          file_name: fileName || 'manual_entry',
          file_url: '', drive_url: driveLink,
          extracted_data: extracted,
        }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      setSaved(true)
      setMsg('✓ Saved to database', 'ok')
      await loadRecords()
    } catch (e: any) {
      setMsg(`✗ Save failed: ${e.message}`, 'err')
    } finally { setSaving(false) }
  }

  const isProcessing  = uploading || extracting
  const filledCount   = Object.values(fields).filter(Boolean).length
  const statusColor   = statusType === 'err' ? 'text-red-600' : statusType === 'warn' ? 'text-amber-600' : 'text-green-600'

  return (
    <AdminLayout>
      <div className="p-6">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">CDN</h1>
            <p className="text-gray-500 text-sm mt-1">Cargo Dispatch Note (Exp 3b) · Upload PDF · Auto-extract · Edit · Save</p>
          </div>
          <button onClick={clearForm}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200">
            <RefreshCw size={14}/> New Entry
          </button>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">

          {/* ── Left: Upload + History ──────────────────────────────── */}
          <div className="space-y-4">

            {/* Upload card */}
            <div className="card">
              <h2 className="font-semibold text-gray-900 mb-3 text-sm flex items-center gap-2">
                <Upload size={15} style={{ color: COLOR }}/> Upload CDN PDF
              </h2>

              <div
                onClick={() => { if (!isProcessing) fileRef.current?.click() }}
                className={`border-2 border-dashed rounded-xl p-6 text-center transition-colors ${
                  isProcessing
                    ? 'border-gray-100 cursor-default'
                    : 'border-gray-200 cursor-pointer hover:bg-green-50'
                }`}
                style={isProcessing ? {} : { borderColor: `${COLOR}60` }}
              >
                {isProcessing ? (
                  <div className="flex flex-col items-center gap-2">
                    <Loader size={22} className="animate-spin" style={{ color: COLOR }}/>
                    <p className="text-xs text-gray-400">{status || 'Processing...'}</p>
                  </div>
                ) : fileName ? (
                  <div className="flex flex-col items-center gap-2">
                    <FileText size={22} style={{ color: COLOR }}/>
                    <p className="text-xs font-medium text-gray-700 truncate max-w-[90%]">{fileName}</p>
                    {saved
                      ? <p className="text-xs text-green-600 flex items-center gap-1"><CheckCircle size={11}/> Saved</p>
                      : <p className="text-xs text-gray-400">Click to replace</p>
                    }
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2">
                    <Upload size={22} className="text-gray-300"/>
                    <p className="text-xs font-medium text-gray-600">Click to upload CDN PDF</p>
                    <p className="text-xs text-gray-400">Fields auto-extracted</p>
                  </div>
                )}
              </div>

              <input ref={fileRef} type="file" accept=".pdf" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = '' }}/>

              {status && !isProcessing && (
                <p className={`text-xs mt-2 font-medium ${statusColor}`}>{status}</p>
              )}

              {driveLink && (
                <a href={driveLink} target="_blank" rel="noreferrer"
                  className="mt-2 flex items-center gap-1 text-xs text-blue-600 bg-blue-50 px-2 py-1.5 rounded-lg hover:bg-blue-100">
                  <ExternalLink size={11}/> View file
                </a>
              )}

              {rawText && (
                <>
                  <button onClick={() => setShowRaw(v => !v)}
                    className="mt-2 w-full flex items-center justify-center gap-1 text-xs text-gray-500 border border-gray-200 px-2 py-1.5 rounded-lg hover:bg-gray-50">
                    <Eye size={11}/> {showRaw ? 'Hide' : 'Show'} Raw Text
                    <ChevronRight size={11} className={`transition-transform ${showRaw ? 'rotate-90' : ''}`}/>
                  </button>
                  {showRaw && (
                    <pre className="mt-2 text-xs bg-gray-50 rounded-lg p-2 overflow-auto max-h-52 text-gray-600 whitespace-pre-wrap">{rawText}</pre>
                  )}
                </>
              )}
            </div>

            {/* History */}
            <div className="card">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-semibold text-gray-900 text-sm">Saved CDNs</h2>
                <button onClick={loadRecords} className="text-gray-400 hover:text-gray-600"><RefreshCw size={13}/></button>
              </div>
              {loadingRecs ? (
                <div className="flex justify-center py-4"><Loader size={16} className="animate-spin text-gray-400"/></div>
              ) : records.length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-4">No records yet</p>
              ) : (
                <div className="space-y-1 max-h-60 overflow-y-auto">
                  {records.map(rec => (
                    <button key={rec.id} onClick={() => loadRecord(rec)}
                      className={`w-full text-left p-2 rounded-lg text-xs transition-colors border ${
                        activeId === rec.id
                          ? 'bg-green-50 border-green-200'
                          : 'hover:bg-gray-50 border-transparent'
                      }`}>
                      <p className="font-medium text-gray-700 truncate">{rec.file_name}</p>
                      <p className="text-gray-400 mt-0.5">
                        {rec.extracted_data?.grid_cdn_no || '—'} ·{' '}
                        {new Date(rec.created_at).toLocaleDateString('en-GB')}
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* ── Right: Fields Form ──────────────────────────────────── */}
          <div className="xl:col-span-2 card">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="font-semibold text-gray-900">CDN Fields</h2>
                <div className="flex items-center gap-2 mt-1">
                  <div className="w-32 bg-gray-100 rounded-full h-1.5">
                    <div className="h-1.5 rounded-full transition-all"
                      style={{ width: `${(filledCount / CDN_FIELDS.length) * 100}%`, background: COLOR }}/>
                  </div>
                  <span className="text-xs text-gray-400">{filledCount}/{CDN_FIELDS.length} filled</span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {saved && (
                  <span className="flex items-center gap-1 text-xs text-green-600 bg-green-50 px-2 py-1 rounded-lg">
                    <CheckCircle size={11}/> Saved
                  </span>
                )}
                <button onClick={clearForm}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50">
                  <X size={12}/> Clear
                </button>
                <button onClick={handleSave} disabled={saving}
                  className="flex items-center gap-2 px-4 py-2 text-sm text-white font-medium rounded-lg disabled:opacity-50"
                  style={{ background: COLOR }}>
                  {saving ? <Loader size={13} className="animate-spin"/> : <Save size={13}/>}
                  Save to DB
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
              {CDN_FIELDS.map(f => (
                <div key={f.key} className="flex items-start gap-3 py-2.5 border-b border-gray-50 last:border-0">
                  <span className="mt-1 inline-block text-white text-xs font-mono px-1.5 py-0.5 rounded min-w-[1.75rem] text-center flex-shrink-0"
                    style={{ background: COLOR }}>
                    ●
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-gray-400">{f.label}</p>
                    <input
                      value={fields[f.key] || ''}
                      onChange={e => setFields(p => ({ ...p, [f.key]: e.target.value }))}
                      placeholder="—"
                      className="w-full text-sm text-gray-800 bg-transparent border-b border-transparent hover:border-gray-200 focus:outline-none py-0.5"
                      style={{ '--tw-border-opacity': '1' } as any}
                      onFocus={e => (e.target.style.borderBottomColor = COLOR)}
                      onBlur={e => (e.target.style.borderBottomColor = '')}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

        </div>
      </div>
    </AdminLayout>
  )
}
