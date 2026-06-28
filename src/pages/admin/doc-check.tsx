import { useState, useRef, useCallback, useEffect } from 'react'
import AdminLayout from '@/components/admin/AdminLayout'
import {
  Upload, FileText, CheckCircle, XCircle, AlertCircle,
  Eye, EyeOff, RotateCcw, ChevronLeft, ChevronRight, Save,
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────
interface Field {
  key: string
  label: string
  value: string
  region: { x: number; y: number; w: number; h: number }
}

interface DetectResult {
  docType: string
  fields: Field[]
  rawText: string
  scanned: boolean
  warning?: string
}

// ─── Constants ────────────────────────────────────────────────────────────────
const DOC_LABELS: Record<string, string> = {
  cusdec:    'CUSDEC — Goods Declaration',
  cdn:       'CDN — Cargo Dispatch Note (Exp 3b)',
  barcode:   'Gate Pass Slip (Barcode)',
  boatnote:  'Boat Note / Shipping Note (Exp 3a)',
  partycopy: "Party's Copy (CUSDEC + Short Shipment)",
  unknown:   'Unknown Document',
}

const DOC_COLORS: Record<string, { accent: string; light: string; border: string }> = {
  cusdec:    { accent: '#3B6EDE', light: '#EEF3FE', border: '#BFCFFA' },
  cdn:       { accent: '#22A87A', light: '#E8FAF4', border: '#A3E4CF' },
  barcode:   { accent: '#D97706', light: '#FEF9EE', border: '#FCDDA0' },
  boatnote:  { accent: '#7C3AED', light: '#F5F0FF', border: '#D0BCFA' },
  partycopy: { accent: '#DB2777', light: '#FEF0F6', border: '#FACCE5' },
  unknown:   { accent: '#6B7280', light: '#F3F4F6', border: '#D1D5DB' },
}

// ─── Load pdf.js from CDN ─────────────────────────────────────────────────────
async function loadPdfJs(): Promise<any> {
  const win = window as any
  if (win.__pdfjsLib) return win.__pdfjsLib
  await new Promise<void>((resolve, reject) => {
    const s = document.createElement('script')
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js'
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('pdf.js load failed'))
    document.head.appendChild(s)
  })
  win.pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
  win.__pdfjsLib = win.pdfjsLib
  return win.__pdfjsLib
}

// ─── Render one page to canvas ────────────────────────────────────────────────
async function renderPage(
  pdfDoc: any,
  pageNum: number,
  canvas: HTMLCanvasElement,
  scale = 1.8,
) {
  const page     = await pdfDoc.getPage(pageNum)
  const viewport = page.getViewport({ scale })
  canvas.width   = viewport.width
  canvas.height  = viewport.height
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  await page.render({ canvasContext: ctx, viewport }).promise
}

// ─── File → base64 ───────────────────────────────────────────────────────────
function fileToBase64(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader()
    r.onload  = () => res((r.result as string).split(',')[1])
    r.onerror = rej
    r.readAsDataURL(file)
  })
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function DocCheckPage() {
  const canvasRef   = useRef<HTMLCanvasElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const gridRef     = useRef<HTMLDivElement>(null)
  const pdfDocRef   = useRef<any>(null)

  const [loading, setLoading]         = useState(false)
  const [pdfReady, setPdfReady]       = useState(false)
  const [totalPages, setTotalPages]   = useState(1)
  const [currentPage, setCurrentPage] = useState(1)
  const [result, setResult]           = useState<DetectResult | null>(null)
  const [activeKey, setActiveKey]     = useState<string | null>(null)
  const [editedValues, setEditedValues] = useState<Record<string, string>>({})
  const [included, setIncluded]       = useState<Record<string, boolean>>({})
  const [dragOver, setDragOver]       = useState(false)
  const [showOverlays, setShowOverlays] = useState(true)
  const [fileName, setFileName]       = useState('')
  const [saving, setSaving]           = useState(false)
  const [savedMsg, setSavedMsg]       = useState('')

  // Scroll grid to active row
  useEffect(() => {
    if (!activeKey || !gridRef.current) return
    const row = gridRef.current.querySelector(`[data-key="${activeKey}"]`)
    row?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [activeKey])

  // Navigate pages
  const goToPage = useCallback(async (page: number) => {
    if (!pdfDocRef.current || !canvasRef.current) return
    const p = Math.max(1, Math.min(page, totalPages))
    setCurrentPage(p)
    await renderPage(pdfDocRef.current, p, canvasRef.current)
  }, [totalPages])

  const processFile = useCallback(async (file: File) => {
    if (!file || file.type !== 'application/pdf') { alert('PDF file ekak danna'); return }
    setLoading(true)
    setResult(null)
    setPdfReady(false)
    setActiveKey(null)
    setFileName(file.name)
    setSavedMsg('')

    try {
      // ── Render PDF (client-side, CDN pdfjs) ──
      const pdfjsLib = await loadPdfJs()
      const ab  = await file.arrayBuffer()
      const pdf = await pdfjsLib.getDocument({ data: ab }).promise
      pdfDocRef.current = pdf
      setTotalPages(pdf.numPages)
      setCurrentPage(1)
      if (canvasRef.current) {
        await renderPage(pdf, 1, canvasRef.current)
        setPdfReady(true)
      }

      // ── Smart-detect API ──
      const base64 = await fileToBase64(file)
      const res    = await fetch('/api/smart-detect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base64 }),
      })
      const data: DetectResult = await res.json()
      setResult(data)

      const inc: Record<string, boolean> = {}
      const ed:  Record<string, string>  = {}
      data.fields?.forEach(f => {
        inc[f.key] = !!f.value
        ed[f.key]  = f.value || ''
      })
      setIncluded(inc)
      setEditedValues(ed)
    } catch (err: any) {
      alert('Error: ' + err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false)
    const f = e.dataTransfer.files[0]; if (f) processFile(f)
  }, [processFile])

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (f) processFile(f); e.target.value = ''
  }, [processFile])

  const reset = () => {
    setResult(null); setPdfReady(false); setActiveKey(null); setFileName('')
    setSavedMsg(''); pdfDocRef.current = null; setTotalPages(1); setCurrentPage(1)
    if (canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d')
      ctx?.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height)
    }
  }

  async function handleSave() {
    if (!result) return
    setSaving(true)
    try {
      const extracted = Object.fromEntries(
        Object.entries(editedValues)
          .filter(([k]) => included[k])
          .map(([k, v]) => [`grid_${k}`, v])
      )
      const res = await fetch('/api/save-document', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          doc_type: result.docType,
          file_name: fileName,
          file_url: '', drive_url: '',
          extracted_data: extracted,
        }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      setSavedMsg('✓ Saved to database')
    } catch (e: any) {
      setSavedMsg('✗ ' + e.message)
    } finally { setSaving(false) }
  }

  const fields        = result?.fields ?? []
  const selectedCount = Object.values(included).filter(Boolean).length
  const color         = DOC_COLORS[result?.docType ?? 'unknown'] ?? DOC_COLORS.unknown

  return (
    <AdminLayout>
      <div className="p-6 min-h-screen flex flex-col">

        {/* ── Header ── */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Document Check</h1>
            <p className="text-gray-400 text-sm mt-0.5">
              PDF upload karanna — type auto-detect wela fields extract karanawa
            </p>
          </div>
          {result && (
            <button onClick={reset}
              className="flex items-center gap-2 text-sm text-gray-400 hover:text-red-500 transition-colors">
              <RotateCcw size={14}/> New Upload
            </button>
          )}
        </div>

        {/* ── Upload zone ── */}
        {!result && !loading && (
          <div
            onDragOver={e => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`flex-1 border-2 border-dashed rounded-2xl p-20 text-center cursor-pointer transition-all ${
              dragOver ? 'border-green-400 bg-green-50' : 'border-gray-300 bg-white hover:border-green-400 hover:bg-green-50/30'
            }`}
          >
            <div className="w-16 h-16 rounded-2xl bg-green-50 flex items-center justify-center mx-auto mb-4">
              <Upload size={28} className="text-green-600"/>
            </div>
            <p className="text-lg font-semibold text-gray-700 mb-1">PDF eka drop karanna</p>
            <p className="text-gray-400 text-sm mb-5">හෝ click කරලා select කරන්න</p>
            <div className="inline-flex items-center gap-2 bg-green-600 text-white px-5 py-2.5 rounded-lg font-medium text-sm">
              <FileText size={16}/> PDF Select
            </div>
            <p className="text-xs text-gray-300 mt-4">
              CUSDEC · CDN (Exp 3b) · Gate Pass · Boat Note · Party's Copy
            </p>
            <input ref={fileInputRef} type="file" accept=".pdf" className="hidden" onChange={handleFileInput}/>
          </div>
        )}

        {/* ── Loading ── */}
        {loading && (
          <div className="flex-1 bg-white rounded-2xl flex flex-col items-center justify-center border">
            <div className="w-12 h-12 border-4 border-green-500 border-t-transparent rounded-full animate-spin mb-4"/>
            <p className="text-gray-600 font-medium">Scanning document...</p>
            <p className="text-gray-400 text-sm mt-1">{fileName}</p>
          </div>
        )}

        {/* ── Result ── */}
        {result && !loading && (
          <div className="flex flex-col gap-3 flex-1">

            {/* Doc type banner */}
            <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl border text-sm"
              style={{ background: color.light, borderColor: color.border }}>
              <span className="font-bold" style={{ color: color.accent }}>
                {DOC_LABELS[result.docType] ?? result.docType}
              </span>
              {result.scanned && (
                <span className="flex items-center gap-1 text-orange-600 text-xs">
                  <AlertCircle size={13}/> Scanned PDF
                </span>
              )}
              {result.warning && <span className="text-orange-500 text-xs">{result.warning}</span>}

              <div className="ml-auto flex items-center gap-2">
                <button onClick={() => setShowOverlays(p => !p)}
                  className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg border transition-colors ${
                    showOverlays
                      ? 'bg-red-50 text-red-600 border-red-200'
                      : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'
                  }`}>
                  {showOverlays ? <Eye size={12}/> : <EyeOff size={12}/>}
                  {showOverlays ? 'Boxes Hide' : 'Boxes Show'}
                </button>
                <label className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg border border-gray-200 bg-white text-gray-500 cursor-pointer hover:bg-gray-50">
                  <Upload size={12}/> Wenama PDF
                  <input type="file" accept=".pdf" className="hidden" onChange={handleFileInput}/>
                </label>
              </div>
            </div>

            {/* Two-panel */}
            <div className="grid grid-cols-2 gap-4 flex-1" style={{ minHeight: '72vh' }}>

              {/* ─── LEFT: PDF canvas + numbered overlays ─── */}
              <div className="bg-white rounded-xl border flex flex-col overflow-hidden">

                {/* Canvas toolbar */}
                <div className="flex items-center gap-2 px-3 py-2 border-b bg-gray-50 text-xs text-gray-500">
                  <FileText size={13} className="text-gray-400"/>
                  <span className="font-medium text-gray-700 truncate">{fileName}</span>

                  {/* Page navigation */}
                  {totalPages > 1 && (
                    <div className="ml-auto flex items-center gap-1">
                      <button onClick={() => goToPage(currentPage - 1)} disabled={currentPage <= 1}
                        className="p-1 rounded hover:bg-gray-200 disabled:opacity-30">
                        <ChevronLeft size={13}/>
                      </button>
                      <span className="px-2 font-mono">{currentPage} / {totalPages}</span>
                      <button onClick={() => goToPage(currentPage + 1)} disabled={currentPage >= totalPages}
                        className="p-1 rounded hover:bg-gray-200 disabled:opacity-30">
                        <ChevronRight size={13}/>
                      </button>
                    </div>
                  )}

                  {activeKey && (
                    <span className="ml-auto text-red-600 font-semibold bg-red-50 px-2 py-0.5 rounded text-[11px]">
                      #{fields.findIndex(f => f.key === activeKey) + 1} {fields.find(f => f.key === activeKey)?.label}
                    </span>
                  )}
                </div>

                {/* Canvas area */}
                <div className="flex-1 overflow-auto bg-gray-200 relative">
                  <div className="relative inline-block w-full">
                    <canvas
                      ref={canvasRef}
                      className="block w-full shadow-md"
                      style={{ display: pdfReady ? 'block' : 'none' }}
                    />

                    {!pdfReady && (
                      <div className="flex items-center justify-center h-96 text-gray-400">
                        <div className="text-center">
                          <FileText size={36} className="mx-auto mb-2 opacity-30"/>
                          <p className="text-sm">PDF render wenawa...</p>
                        </div>
                      </div>
                    )}

                    {/* ── Numbered overlay boxes ── */}
                    {pdfReady && showOverlays && fields.map((f, idx) => {
                      if (!f.region) return null
                      const isActive  = activeKey === f.key
                      const hasValue  = !!editedValues[f.key]
                      const num       = idx + 1
                      const { x, y, w, h } = f.region
                      const boxColor  = isActive
                        ? '#dc2626'
                        : hasValue
                          ? color.accent
                          : '#9ca3af'

                      return (
                        <div
                          key={f.key}
                          className="absolute cursor-pointer group"
                          style={{
                            left:   `${x}%`,
                            top:    `${y}%`,
                            width:  `${w}%`,
                            height: `${h}%`,
                            border: `${isActive ? 2.5 : 1.5}px solid ${boxColor}`,
                            background: isActive
                              ? 'rgba(220,38,38,0.10)'
                              : hasValue
                                ? `${color.accent}15`
                                : 'rgba(156,163,175,0.06)',
                            borderRadius: '3px',
                            zIndex: isActive ? 20 : 10,
                            boxShadow: isActive ? `0 0 0 2px ${boxColor}40` : 'none',
                            transition: 'all 0.12s',
                          }}
                          onClick={() => setActiveKey(f.key === activeKey ? null : f.key)}
                        >
                          {/* Number badge — always visible */}
                          <span
                            className="absolute text-white font-bold leading-none select-none"
                            style={{
                              top: '-1px',
                              left: '-1px',
                              background: boxColor,
                              fontSize: '9px',
                              padding: '2px 4px',
                              borderRadius: '0 0 4px 0',
                              minWidth: '16px',
                              textAlign: 'center',
                            }}
                          >
                            {num}
                          </span>

                          {/* Value preview inside box */}
                          {hasValue && !isActive && h > 6 && (
                            <span
                              className="absolute bottom-0.5 left-1 pointer-events-none overflow-hidden whitespace-nowrap"
                              style={{
                                fontSize: '8px',
                                color: boxColor,
                                opacity: 0.8,
                                maxWidth: '90%',
                              }}
                            >
                              {editedValues[f.key].slice(0, 35)}
                            </span>
                          )}

                          {/* Tooltip on hover */}
                          <span
                            className="absolute left-0 text-white text-[10px] font-semibold px-1.5 py-0.5 rounded whitespace-nowrap pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity"
                            style={{
                              top: '-22px',
                              background: boxColor,
                              boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
                              maxWidth: '220px',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              zIndex: 30,
                            }}
                          >
                            #{num} {f.label}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>

              {/* ─── RIGHT: Fields grid ─── */}
              <div className="bg-white rounded-xl border flex flex-col overflow-hidden">

                {/* Grid header */}
                <div className="px-4 py-2.5 border-b bg-gray-50 flex items-center gap-2">
                  <span className="text-sm font-semibold text-gray-700">Extracted Fields</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    selectedCount > 0 ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-400'
                  }`}>
                    {selectedCount} / {fields.length} selected
                  </span>
                  {activeKey && (
                    <button onClick={() => setActiveKey(null)} className="ml-auto text-gray-300 hover:text-gray-500">
                      <XCircle size={14}/>
                    </button>
                  )}
                </div>

                {/* Table */}
                <div ref={gridRef} className="flex-1 overflow-auto">
                  {fields.length === 0 ? (
                    <div className="flex items-center justify-center h-full text-gray-400 p-8 text-center">
                      <div>
                        <AlertCircle size={32} className="mx-auto mb-2 opacity-30"/>
                        <p className="text-sm">
                          {result.scanned
                            ? 'Scanned PDF — fields extract karanna ne'
                            : 'Fields extract nune — document type detect nune'}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-gray-50 z-10 border-b">
                        <tr>
                          <th className="w-8 px-2 py-2 text-center">
                            <input type="checkbox" className="accent-green-600"
                              checked={fields.every(f => included[f.key])}
                              onChange={e => {
                                const all: Record<string, boolean> = {}
                                fields.forEach(f => { all[f.key] = e.target.checked })
                                setIncluded(all)
                              }}
                            />
                          </th>
                          <th className="w-8 px-1 py-2 text-center text-xs text-gray-400 font-medium">#</th>
                          <th className="px-3 py-2 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide w-2/5">Field</th>
                          <th className="px-3 py-2 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">Value</th>
                        </tr>
                      </thead>
                      <tbody>
                        {fields.map((f, idx) => {
                          const isActive = activeKey === f.key
                          const hasValue = !!editedValues[f.key]
                          const num      = idx + 1

                          return (
                            <tr
                              key={f.key}
                              data-key={f.key}
                              onClick={() => setActiveKey(f.key === activeKey ? null : f.key)}
                              className={`border-b cursor-pointer transition-colors ${
                                isActive
                                  ? 'bg-red-50'
                                  : hasValue
                                    ? 'hover:bg-gray-50'
                                    : 'bg-gray-50/50 hover:bg-gray-50'
                              }`}
                            >
                              {/* Checkbox */}
                              <td className="px-2 py-2 text-center" onClick={e => e.stopPropagation()}>
                                <input type="checkbox" className="accent-green-600"
                                  checked={!!included[f.key]}
                                  onChange={e => setIncluded(p => ({ ...p, [f.key]: e.target.checked }))}
                                />
                              </td>

                              {/* Number badge */}
                              <td className="px-1 py-2 text-center">
                                <span
                                  className="inline-flex items-center justify-center w-5 h-5 rounded text-white text-[10px] font-bold"
                                  style={{
                                    background: isActive
                                      ? '#dc2626'
                                      : hasValue
                                        ? color.accent
                                        : '#d1d5db',
                                  }}
                                >
                                  {num}
                                </span>
                              </td>

                              {/* Label */}
                              <td className="px-3 py-2">
                                <div className={`font-medium text-[12px] leading-tight ${
                                  isActive ? 'text-red-700' : 'text-gray-700'
                                }`}>
                                  {f.label}
                                </div>
                                <div className="text-[9px] text-gray-300 mt-0.5 font-mono">{f.key}</div>
                              </td>

                              {/* Value input */}
                              <td className="px-2 py-1.5" onClick={e => e.stopPropagation()}>
                                <input
                                  value={editedValues[f.key] ?? ''}
                                  onChange={e => setEditedValues(p => ({ ...p, [f.key]: e.target.value }))}
                                  onFocus={() => setActiveKey(f.key)}
                                  placeholder="—"
                                  className={`w-full px-2 py-1 rounded-lg border text-[12px] outline-none transition-colors ${
                                    isActive
                                      ? 'border-red-300 bg-red-50 ring-1 ring-red-200'
                                      : hasValue
                                        ? 'border-gray-200 bg-white hover:border-gray-300 focus:border-green-400'
                                        : 'border-gray-100 bg-gray-50 text-gray-300 placeholder-gray-300'
                                  }`}
                                />
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  )}
                </div>

                {/* Footer */}
                <div className="p-3 border-t bg-gray-50 flex items-center gap-2 flex-wrap">
                  <button
                    onClick={handleSave}
                    disabled={saving || selectedCount === 0}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-green-600 text-white hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    {saving
                      ? <><div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"/> Saving...</>
                      : <><Save size={14}/> Save ({selectedCount})</>
                    }
                  </button>

                  <button
                    onClick={() => {
                      const all: Record<string, boolean> = {}
                      fields.forEach(f => { all[f.key] = !!editedValues[f.key] })
                      setIncluded(all)
                    }}
                    className="text-xs text-gray-500 hover:text-green-600 transition-colors px-2 py-1.5"
                  >
                    Select Filled
                  </button>
                  <button
                    onClick={() => {
                      const all: Record<string, boolean> = {}
                      fields.forEach(f => { all[f.key] = false })
                      setIncluded(all)
                    }}
                    className="text-xs text-gray-400 hover:text-gray-600 transition-colors px-2 py-1.5"
                  >
                    Clear All
                  </button>

                  {savedMsg && (
                    <span className={`ml-auto text-xs font-medium ${
                      savedMsg.startsWith('✓') ? 'text-green-600' : 'text-red-500'
                    }`}>
                      {savedMsg}
                    </span>
                  )}
                </div>
              </div>

            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  )
}
