import { useState, useRef, useCallback, useEffect } from 'react'
import AdminLayout from '@/components/admin/AdminLayout'
import {
  Upload, FileText, CheckCircle, XCircle, AlertCircle,
  Eye, EyeOff, RotateCcw, ChevronLeft, ChevronRight,
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
  cusdec:   '📋 CUSDEC — Goods Declaration',
  cdn:      '🚛 CDN — Cargo Dispatch Note (Exp 3b)',
  barcode:  '🔖 Gate Pass Slip (Barcode)',
  boatnote: '⚓ Boat Note / Shipping Note (Exp 3a)',
  unknown:  '❓ Unknown Document',
}

const DOC_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  cusdec:   { bg: 'bg-blue-50',   text: 'text-blue-800',   border: 'border-blue-200' },
  cdn:      { bg: 'bg-green-50',  text: 'text-green-800',  border: 'border-green-200' },
  barcode:  { bg: 'bg-yellow-50', text: 'text-yellow-800', border: 'border-yellow-200' },
  boatnote: { bg: 'bg-purple-50', text: 'text-purple-800', border: 'border-purple-200' },
  unknown:  { bg: 'bg-gray-50',   text: 'text-gray-700',   border: 'border-gray-200' },
}

// ─── PDF → Canvas rendering ───────────────────────────────────────────────────
async function renderPdfToCanvas(
  file: File,
  canvas: HTMLCanvasElement,
  scale = 1.8
): Promise<void> {
  // Load pdfjs from CDN for reliable client-side rendering
  const win = window as any
  if (!win.__pdfjsLoaded) {
    await new Promise<void>((resolve, reject) => {
      const s = document.createElement('script')
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js'
      s.onload = () => resolve()
      s.onerror = () => reject(new Error('Failed to load pdf.js'))
      document.head.appendChild(s)
    })
    win.pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
    win.__pdfjsLoaded = true
  }

  const ab = await file.arrayBuffer()
  const pdf = await win.pdfjsLib.getDocument({ data: ab }).promise
  const page = await pdf.getPage(1)
  const viewport = page.getViewport({ scale })
  canvas.width = viewport.width
  canvas.height = viewport.height
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  await page.render({ canvasContext: ctx, viewport }).promise
}

// ─── File to base64 ───────────────────────────────────────────────────────────
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve((reader.result as string).split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function DocCheckPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)

  const [loading, setLoading] = useState(false)
  const [pdfReady, setPdfReady] = useState(false)
  const [result, setResult] = useState<DetectResult | null>(null)
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const [editedValues, setEditedValues] = useState<Record<string, string>>({})
  const [included, setIncluded] = useState<Record<string, boolean>>({})
  const [dragOver, setDragOver] = useState(false)
  const [showOverlays, setShowOverlays] = useState(true)
  const [fileName, setFileName] = useState('')

  // Scroll grid to active row
  useEffect(() => {
    if (!activeKey || !gridRef.current) return
    const row = gridRef.current.querySelector(`[data-key="${activeKey}"]`)
    row?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [activeKey])

  const processFile = useCallback(async (file: File) => {
    if (!file || file.type !== 'application/pdf') {
      alert('PDF file ekak danna')
      return
    }
    setLoading(true)
    setResult(null)
    setPdfReady(false)
    setActiveKey(null)
    setFileName(file.name)

    try {
      // Render PDF to canvas
      if (canvasRef.current) {
        try {
          await renderPdfToCanvas(file, canvasRef.current)
          setPdfReady(true)
        } catch (e) {
          console.error('PDF render error:', e)
          // Continue even if render fails
        }
      }

      // Call smart-detect API
      const base64 = await fileToBase64(file)
      const res = await fetch('/api/smart-detect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base64 }),
      })
      const data: DetectResult = await res.json()
      setResult(data)

      // Initialize state
      const inc: Record<string, boolean> = {}
      const ed: Record<string, string> = {}
      data.fields?.forEach(f => {
        inc[f.key] = !!f.value
        ed[f.key] = f.value || ''
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
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) processFile(file)
  }, [processFile])

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) processFile(file)
    e.target.value = ''
  }, [processFile])

  const reset = () => {
    setResult(null)
    setPdfReady(false)
    setActiveKey(null)
    setFileName('')
    if (canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d')
      ctx?.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height)
    }
  }

  const docColor = DOC_COLORS[result?.docType ?? 'unknown'] ?? DOC_COLORS.unknown
  const selectedCount = Object.values(included).filter(Boolean).length
  const fields = result?.fields ?? []

  // Navigate active field
  const navigateField = (dir: 1 | -1) => {
    if (!fields.length) return
    const filledFields = fields.filter(f => editedValues[f.key])
    if (!filledFields.length) return
    const idx = filledFields.findIndex(f => f.key === activeKey)
    const next = filledFields[(idx + dir + filledFields.length) % filledFields.length]
    setActiveKey(next.key)
  }

  return (
    <AdminLayout>
      <div className="p-6 min-h-screen">

        {/* Page header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-brand-navy">Document Check</h1>
            <p className="text-gray-500 text-sm mt-0.5">
              PDF upload karanna — type auto-detect වෙලා fields extract karanawa
            </p>
          </div>
          {result && (
            <button onClick={reset}
              className="flex items-center gap-2 text-sm text-gray-500 hover:text-red-600 transition-colors">
              <RotateCcw size={15}/> Clear &amp; New Upload
            </button>
          )}
        </div>

        {/* ── Upload zone (when no result) ── */}
        {!result && !loading && (
          <div
            onDragOver={e => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-2xl p-20 text-center cursor-pointer transition-all ${
              dragOver
                ? 'border-brand-green bg-green-50 scale-[1.01]'
                : 'border-gray-300 bg-white hover:border-brand-green hover:bg-green-50/30'
            }`}
          >
            <div className="w-16 h-16 rounded-2xl bg-brand-light flex items-center justify-center mx-auto mb-4">
              <Upload size={28} className="text-brand-green"/>
            </div>
            <p className="text-lg font-semibold text-gray-700 mb-1">PDF eka drop karanna</p>
            <p className="text-gray-400 text-sm mb-5">හෝ click කරලා select කරන්න</p>
            <div className="inline-flex items-center gap-2 bg-brand-green text-white px-5 py-2.5 rounded-lg font-medium text-sm">
              <FileText size={16}/> PDF Select
            </div>
            <p className="text-xs text-gray-400 mt-4">
              CUSDEC · CDN (Exp 3b) · Gate Pass / Barcode · Boat Note (Exp 3a)
            </p>
            <input
              ref={fileInputRef}
              type="file" accept=".pdf" className="hidden"
              onChange={handleFileInput}
            />
          </div>
        )}

        {/* ── Loading ── */}
        {loading && (
          <div className="bg-white rounded-2xl p-20 text-center shadow-sm border">
            <div className="w-14 h-14 border-4 border-brand-green border-t-transparent rounded-full animate-spin mx-auto mb-5"/>
            <p className="text-gray-600 font-medium">Document scan කරමින් පවතී...</p>
            <p className="text-gray-400 text-sm mt-1">{fileName}</p>
          </div>
        )}

        {/* ── Result ── */}
        {result && !loading && (
          <div className="space-y-4">

            {/* Doc type badge + controls */}
            <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${docColor.bg} ${docColor.border}`}>
              <span className={`font-semibold text-sm ${docColor.text}`}>
                {DOC_LABELS[result.docType] ?? result.docType}
              </span>
              {result.scanned && (
                <span className="flex items-center gap-1 text-orange-600 text-sm">
                  <AlertCircle size={14}/> Scanned PDF — fields extract neyi
                </span>
              )}
              {result.warning && (
                <span className="text-orange-500 text-xs">{result.warning}</span>
              )}
              <div className="ml-auto flex items-center gap-3">
                {/* Overlay toggle */}
                <button
                  onClick={() => setShowOverlays(p => !p)}
                  className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                    showOverlays
                      ? 'bg-red-50 text-red-700 border-red-200'
                      : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  {showOverlays ? <Eye size={13}/> : <EyeOff size={13}/>}
                  {showOverlays ? 'Hide Boxes' : 'Show Boxes'}
                </button>
                {/* Navigate */}
                <div className="flex items-center gap-1">
                  <button onClick={() => navigateField(-1)}
                    className="p-1.5 rounded border border-gray-200 hover:bg-gray-100 text-gray-500">
                    <ChevronLeft size={14}/>
                  </button>
                  <button onClick={() => navigateField(1)}
                    className="p-1.5 rounded border border-gray-200 hover:bg-gray-100 text-gray-500">
                    <ChevronRight size={14}/>
                  </button>
                </div>
                {/* New upload */}
                <label className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 cursor-pointer text-gray-600">
                  <Upload size={13}/> Wenama PDF
                  <input type="file" accept=".pdf" className="hidden" onChange={handleFileInput}/>
                </label>
              </div>
            </div>

            {/* Two-panel layout */}
            <div className="grid grid-cols-2 gap-4" style={{ minHeight: '70vh' }}>

              {/* ─── LEFT: PDF canvas + overlay ─────────────────────────── */}
              <div className="bg-white rounded-xl shadow-sm border overflow-hidden flex flex-col">
                <div className="px-4 py-2.5 border-b bg-gray-50 flex items-center gap-2">
                  <FileText size={14} className="text-gray-400"/>
                  <span className="text-sm font-medium text-gray-700">PDF Preview</span>
                  {activeKey && (
                    <span className="ml-auto text-xs text-red-600 font-medium bg-red-50 px-2 py-0.5 rounded">
                      {fields.find(f => f.key === activeKey)?.label}
                    </span>
                  )}
                </div>

                <div className="flex-1 overflow-auto relative bg-gray-100">
                  {/* Canvas container */}
                  <div className="relative w-full">
                    <canvas
                      ref={canvasRef}
                      className="block w-full"
                      style={{ display: pdfReady ? 'block' : 'none' }}
                    />

                    {/* Placeholder if PDF not rendered */}
                    {!pdfReady && (
                      <div className="flex items-center justify-center h-96 text-gray-400">
                        <div className="text-center">
                          <FileText size={40} className="mx-auto mb-3 opacity-30"/>
                          <p className="text-sm">PDF preview load වෙමින්...</p>
                        </div>
                      </div>
                    )}

                    {/* Red overlay boxes (percentage-based over canvas) */}
                    {pdfReady && showOverlays && fields.map(f => {
                      if (!f.region) return null
                      const hasValue = !!editedValues[f.key]
                      const isActive = activeKey === f.key
                      const { x, y, w, h } = f.region

                      return (
                        <div
                          key={f.key}
                          data-overlay={f.key}
                          className="absolute cursor-pointer transition-all duration-150"
                          style={{
                            left: `${x}%`,
                            top: `${y}%`,
                            width: `${w}%`,
                            height: `${h}%`,
                            border: `${isActive ? 2.5 : 1.5}px solid ${
                              isActive
                                ? '#dc2626'
                                : hasValue
                                  ? 'rgba(220,38,38,0.55)'
                                  : 'rgba(156,163,175,0.4)'
                            }`,
                            background: isActive
                              ? 'rgba(220,38,38,0.12)'
                              : hasValue
                                ? 'rgba(220,38,38,0.04)'
                                : 'transparent',
                            borderRadius: '3px',
                            zIndex: 10,
                            boxShadow: isActive ? '0 0 0 2px rgba(220,38,38,0.2)' : 'none',
                          }}
                          onClick={() => setActiveKey(f.key === activeKey ? null : f.key)}
                        >
                          {/* Label tooltip on active */}
                          {isActive && (
                            <span
                              className="absolute left-0 text-white text-[10px] font-semibold px-1.5 py-0.5 rounded whitespace-nowrap pointer-events-none"
                              style={{
                                top: '-20px',
                                background: '#dc2626',
                                boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
                                maxWidth: '200px',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                              }}
                            >
                              {f.label}
                            </span>
                          )}
                          {/* Field value preview (small, inside box if space) */}
                          {hasValue && !isActive && h > 5 && (
                            <span
                              className="absolute bottom-0.5 left-1 text-[9px] text-red-700 opacity-70 pointer-events-none overflow-hidden whitespace-nowrap"
                              style={{ maxWidth: '90%' }}
                            >
                              {editedValues[f.key].slice(0, 30)}
                            </span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>

              {/* ─── RIGHT: Fields grid ───────────────────────────────────── */}
              <div className="bg-white rounded-xl shadow-sm border overflow-hidden flex flex-col">
                <div className="px-4 py-2.5 border-b bg-gray-50 flex items-center gap-3">
                  <span className="text-sm font-medium text-gray-700">Extracted Fields</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    selectedCount > 0 ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                  }`}>
                    {selectedCount} / {fields.length} selected
                  </span>
                  {activeKey && (
                    <button
                      onClick={() => setActiveKey(null)}
                      className="ml-auto text-xs text-gray-400 hover:text-gray-700">
                      <XCircle size={14}/>
                    </button>
                  )}
                </div>

                {/* Fields table */}
                <div ref={gridRef} className="flex-1 overflow-auto">
                  {fields.length === 0 ? (
                    <div className="flex items-center justify-center h-full text-gray-400 p-8 text-center">
                      <div>
                        <AlertCircle size={32} className="mx-auto mb-3 opacity-40"/>
                        <p className="text-sm">
                          {result.scanned
                            ? 'Scanned PDF — fields extract කළ නොහැක'
                            : 'Fields extract නොවුණා — document type detect නොවුණා'}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-gray-50 z-10">
                        <tr className="border-b">
                          <th className="w-10 px-3 py-2 text-center">
                            <input
                              type="checkbox"
                              className="accent-brand-green"
                              checked={fields.every(f => included[f.key])}
                              onChange={e => {
                                const all: Record<string, boolean> = {}
                                fields.forEach(f => { all[f.key] = e.target.checked })
                                setIncluded(all)
                              }}
                            />
                          </th>
                          <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide w-2/5">
                            Field
                          </th>
                          <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                            Extracted Value
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {fields.map((f, i) => {
                          const isActive = activeKey === f.key
                          const hasValue = !!editedValues[f.key]

                          return (
                            <tr
                              key={f.key}
                              data-key={f.key}
                              className={`border-b cursor-pointer transition-colors ${
                                isActive
                                  ? 'bg-red-50 border-red-100'
                                  : hasValue
                                    ? 'hover:bg-gray-50'
                                    : 'bg-gray-50/40 hover:bg-gray-50'
                              }`}
                              onClick={() => setActiveKey(f.key === activeKey ? null : f.key)}
                            >
                              {/* Checkbox */}
                              <td className="px-3 py-2.5 text-center" onClick={e => e.stopPropagation()}>
                                <input
                                  type="checkbox"
                                  className="accent-brand-green"
                                  checked={!!included[f.key]}
                                  onChange={e => setIncluded(p => ({ ...p, [f.key]: e.target.checked }))}
                                />
                              </td>

                              {/* Label */}
                              <td className="px-3 py-2.5">
                                <div className={`font-medium text-[13px] ${isActive ? 'text-red-700' : 'text-gray-700'}`}>
                                  {f.label}
                                </div>
                                <div className="text-[10px] text-gray-400 mt-0.5 font-mono">{f.key}</div>
                              </td>

                              {/* Value input */}
                              <td className="px-3 py-2" onClick={e => e.stopPropagation()}>
                                <input
                                  value={editedValues[f.key] ?? ''}
                                  onChange={e => setEditedValues(p => ({ ...p, [f.key]: e.target.value }))}
                                  onFocus={() => setActiveKey(f.key)}
                                  placeholder={hasValue ? '' : '—  (extract නොවුණා)'}
                                  className={`w-full px-2.5 py-1.5 rounded-lg border text-[13px] outline-none transition-colors ${
                                    isActive
                                      ? 'border-red-300 bg-red-50/60 ring-1 ring-red-200'
                                      : hasValue
                                        ? 'border-gray-200 bg-white hover:border-gray-300 focus:border-brand-green focus:ring-1 focus:ring-green-200'
                                        : 'border-gray-100 bg-gray-50 text-gray-400 placeholder-gray-300'
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
                <div className="p-4 border-t bg-gray-50 flex items-center gap-3">
                  <button
                    disabled={selectedCount === 0}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-brand-green text-white hover:bg-brand-teal disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    <CheckCircle size={15}/>
                    Save ({selectedCount} fields)
                  </button>
                  <button
                    onClick={() => {
                      // Select all filled fields
                      const all: Record<string, boolean> = {}
                      fields.forEach(f => { all[f.key] = !!editedValues[f.key] })
                      setIncluded(all)
                    }}
                    className="text-sm text-gray-500 hover:text-brand-green transition-colors"
                  >
                    Select All Filled
                  </button>
                  <button
                    onClick={() => {
                      const all: Record<string, boolean> = {}
                      fields.forEach(f => { all[f.key] = false })
                      setIncluded(all)
                    }}
                    className="text-sm text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    Clear All
                  </button>
                </div>
              </div>

            </div>
          </div>
        )}

      </div>
    </AdminLayout>
  )
}
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             