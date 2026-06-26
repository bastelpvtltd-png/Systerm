import { useState, useRef, useEffect } from 'react'
import AdminLayout from '@/components/admin/AdminLayout'
import { Upload, FileText, Save, Loader, CheckCircle, Eye, ExternalLink, RefreshCw } from 'lucide-react'

type PdfField = { grid: string; label: string; value: string }

interface SavedRecord {
  id: string
  file_name: string
  drive_url: string
  extracted_data: Record<string, string>
  created_at: string
}

const CUSDEC_FIELDS: { grid: string; label: string }[] = [
  { grid: '2',  label: 'Exporter' },
  { grid: '8',  label: 'Consignee' },
  { grid: '14', label: 'Declarant/Representative' },
  { grid: '15', label: 'Country of Export' },
  { grid: '17', label: 'Country of Destination' },
  { grid: '18', label: 'Vessel/Flight' },
  { grid: '21', label: 'Voyage No./Date' },
  { grid: '22', label: 'Currency & Amount Invoiced' },
  { grid: '23', label: 'Exchange Rate' },
  { grid: '27', label: 'Port of Loading/Discharge' },
  { grid: '29', label: 'Office of Entry/Exit' },
  { grid: '30', label: 'Location of Goods' },
  { grid: '33', label: 'Commodity (HS) Code' },
  { grid: '35', label: 'Gross Mass (Kg)' },
  { grid: '38', label: 'Net Mass (Kg)' },
  { grid: '40', label: 'B/L No.' },
  { grid: '41', label: 'UOM & Qty' },
  { grid: '44', label: 'Additional Info' },
  { grid: 'B1', label: 'Assessment Number' },
  { grid: 'B2', label: 'Receipt Number' },
  { grid: 'B3', label: 'Total Fees (LKR)' },
]

const emptyFields = () => Object.fromEntries(CUSDEC_FIELDS.map(f => [f.grid, '']))

export default function CusdecPage() {
  const [uploading, setUploading]   = useState(false)
  const [extracting, setExtracting] = useState(false)
  const [saving, setSaving]         = useState(false)
  const [fileName, setFileName]     = useState('')
  const [driveLink, setDriveLink]   = useState('')
  const [fields, setFields]         = useState<Record<string, string>>(emptyFields())
  const [rawText, setRawText]       = useState('')
  const [showRaw, setShowRaw]       = useState(false)
  const [status, setStatus]         = useState('')
  const [statusType, setStatusType] = useState<'ok'|'warn'|'err'>('ok')
  const [saved, setSaved]           = useState(false)
  const [records, setRecords]       = useState<SavedRecord[]>([])
  const [loadingRecs, setLoadingRecs] = useState(false)
  const [activeId, setActiveId]     = useState<string|null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  function setMsg(m: string, t: 'ok'|'warn'|'err' = 'ok') { setStatus(m); setStatusType(t) }

  useEffect(() => { loadRecords() }, [])

  async function loadRecords() {
    setLoadingRecs(true)
    try {
      const res = await fetch('/api/list-documents?doc_type=cusdec')
      if (res.ok) { const d = await res.json(); setRecords(d.records || []) }
    } finally { setLoadingRecs(false) }
  }

  function loadRecord(rec: SavedRecord) {
    setActiveId(rec.id); setFileName(rec.file_name)
    setDriveLink(rec.drive_url || ''); setSaved(true)
    setMsg('✓ Record loaded', 'ok')
    const loaded = emptyFields()
    if (rec.extracted_data) {
      Object.entries(rec.extracted_data).forEach(([k, v]) => {
        const g = k.replace('grid_', '')
        if (g in loaded) loaded[g] = String(v)
      })
    }
    setFields(loaded)
  }

  function clearForm() {
    setFileName(''); setDriveLink(''); setRawText('')
    setFields(emptyFields()); setSaved(false); setStatus(''); setActiveId(null)
  }

  async function handleFile(file: File) {
    clearForm(); setUploading(true); setFileName(file.name)
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

      // Extract
      setExtracting(true); setMsg('Extracting fields...', 'ok')
      const res = await fetch('/api/extract-pdf', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base64, docType: 'cusdec' }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Extraction failed')

      const raw: PdfField[] = json.fields || []
      setRawText(json.rawText || '')

      const merged = emptyFields()
      raw.forEach(f => { if (f.grid in merged) merged[f.grid] = f.value })
      setFields(merged)

      const filled = raw.filter(f => f.value).length
      setMsg(
        filled > 0
          ? `✓ Extracted ${filled}/${raw.length} fields — fill in empty ones`
          : `⚠ 0 fields matched — click "Show Raw Text" to check PDF structure`,
        filled > 5 ? 'ok' : 'warn'
      )
    } catch (e: any) {
      setMsg(`✗ ${e.message}`, 'err')
    } finally { setUploading(false); setExtracting(false) }
  }

  async function handleSave() {
    setSaving(true)
    try {
      const extracted = Object.fromEntries(Object.entries(fields).map(([k, v]) => [`grid_${k}`, v]))
      const res = await fetch('/api/save-document', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          doc_type: 'cusdec', file_name: fileName || 'manual_entry',
          file_url: '', drive_url: driveLink, extracted_data: extracted,
        }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      setSaved(true); setMsg('✓ Saved to database', 'ok')
      await loadRecords()
    } catch (e: any) {
      setMsg(`✗ Save failed: ${e.message}`, 'err')
    } finally { setSaving(false) }
  }

  const filledCount = Object.values(fields).filter(Boolean).length
  const statusColor = statusType === 'err' ? 'text-red-600' : statusType === 'warn' ? 'text-amber-600' : 'text-green-600'

  return (
    <AdminLayout>
      <div className="p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">CUSDEC</h1>
            <p className="text-gray-500 text-sm mt-1">Upload PDF · Auto-extract fields · Edit · Save</p>
          </div>
          <button onClick={clearForm}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200">
            <RefreshCw size={14}/> New Entry
          </button>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">

          {/* Upload + History */}
          <div className="space-y-4">
            <div className="card">
              <h2 className="font-semibold text-gray-900 mb-3 text-sm flex items-center gap-2">
                <Upload size={15} className="text-[#1B3A5C]"/> Upload CUSDEC PDF
              </h2>
              <div
                onClick={() => { if (!uploading && !extracting) fileRef.current?.click() }}
                className={`border-2 border-dashed rounded-xl p-6 text-center transition-colors ${
                  uploading||extracting ? 'border-gray-100 cursor-default' : 'border-gray-200 cursor-pointer hover:border-[#1B3A5C] hover:bg-blue-50'
                }`}>
                {uploading||extracting ? (
                  <div className="flex flex-col items-center gap-2">
                    <Loader size={22} className="animate-spin text-[#1B3A5C]"/>
                    <p className="text-xs text-gray-400">{status||'Processing...'}</p>
                  </div>
                ) : fileName ? (
                  <div className="flex flex-col items-center gap-2">
                    <FileText size={22} className="text-[#1B3A5C]"/>
                    <p className="text-xs font-medium text-gray-700 truncate max-w-[90%]">{fileName}</p>
                    <p className="text-xs text-gray-400">Click to replace</p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2">
                    <Upload size={22} className="text-gray-300"/>
                    <p className="text-xs font-medium text-gray-600">Click to upload PDF</p>
                  </div>
                )}
              </div>
              <input ref={fileRef} type="file" accept=".pdf" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value='' }}/>

              {status && !uploading && !extracting && (
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
                <h2 className="font-semibold text-gray-900 text-sm">Saved CUSDECs</h2>
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
                      className={`w-full text-left p-2 rounded-lg text-xs transition-colors ${
                        activeId===rec.id ? 'bg-blue-50 border border-blue-200' : 'hover:bg-gray-50 border border-transparent'
                      }`}>
                      <p className="font-medium text-gray-700 truncate">{rec.file_name}</p>
                      <p className="text-gray-400">{new Date(rec.created_at).toLocaleDateString('en-GB')}</p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Fields Form */}
          <div className="xl:col-span-2 card">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h2 className="font-semibold text-gray-900">Fields</h2>
                <div className="flex items-center gap-2 mt-1">
                  <div className="w-32 bg-gray-100 rounded-full h-1.5">
                    <div className="h-1.5 rounded-full bg-[#1B3A5C] transition-all"
                      style={{ width: `${(filledCount/CUSDEC_FIELDS.length)*100}%` }}/>
                  </div>
                  <span className="text-xs text-gray-400">{filledCount}/{CUSDEC_FIELDS.length} filled</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {saved && (
                  <span className="flex items-center gap-1 text-xs text-green-600 bg-green-50 px-2 py-1 rounded-lg">
                    <CheckCircle size={11}/> Saved
                  </span>
                )}
                <button onClick={handleSave} disabled={saving}
                  className="flex items-center gap-2 px-4 py-2 text-sm text-white font-medium rounded-lg disabled:opacity-50"
                  style={{ background: '#1B3A5C' }}>
                  {saving ? <Loader size={13} className="animate-spin"/> : <Save size={13}/>}
                  Save to DB
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
              {CUSDEC_FIELDS.map(f => (
                <div key={f.grid} className="flex items-start gap-2 py-2 border-b border-gray-50 last:border-0">
                  <span className="mt-1 inline-block bg-[#1B3A5C] text-white text-xs font-mono px-1.5 py-0.5 rounded min-w-[2rem] text-center flex-shrink-0">
                    {f.grid}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-gray-400">{f.label}</p>
                    <input
                      value={fields[f.grid] || ''}
                      onChange={e => setFields(p => ({ ...p, [f.grid]: e.target.value }))}
                      placeholder="—"
                      className="w-full text-sm text-gray-800 bg-transparent border-b border-transparent hover:border-gray-200 focus:border-[#1B3A5C] focus:outline-none py-0.5"
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

function fileToBase64(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const reader = new FileReader()
    reader.onload  = () => res((reader.result as string).split(',')[1])
    reader.onerror = rej
    reader.readAsDataURL(file)
  })
}
