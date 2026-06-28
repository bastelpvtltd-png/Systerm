import { useState, useRef, useCallback, useEffect } from 'react'
import AdminLayout from '@/components/admin/AdminLayout'
import {
  Upload, FileText, RotateCcw, ChevronLeft, ChevronRight,
  Grid, Plus, Minus, Check, Save, AlertCircle, Copy,
} from 'lucide-react'

// ─── pdf.js CDN ───────────────────────────────────────────────────────────────
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

async function renderPage(pdfDoc: any, pageNum: number, canvas: HTMLCanvasElement, scale = 1.8) {
  const page     = await pdfDoc.getPage(pageNum)
  const viewport = page.getViewport({ scale })
  canvas.width   = viewport.width
  canvas.height  = viewport.height
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  await page.render({ canvasContext: ctx, viewport }).promise
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function sortedCopy(arr: number[]) { return [...arr].sort((a, b) => a - b) }

interface Cell {
  num: number
  x: number   // % left edge
  y: number   // % top edge
  w: number   // % width
  h: number   // % height
  row: number
  col: number
}

function buildCells(vLines: number[], hLines: number[]): Cell[] {
  const vSorted = sortedCopy(vLines)
  const hSorted = sortedCopy(hLines)
  const colBounds = [0, ...vSorted, 100]
  const rowBounds = [0, ...hSorted, 100]
  const cells: Cell[] = []
  let num = 1
  for (let r = 0; r < rowBounds.length - 1; r++) {
    for (let c = 0; c < colBounds.length - 1; c++) {
      cells.push({
        num, row: r + 1, col: c + 1,
        x: colBounds[c],
        y: rowBounds[r],
        w: colBounds[c + 1] - colBounds[c],
        h: rowBounds[r + 1] - rowBounds[r],
      })
      num++
    }
  }
  return cells
}

// ─── Stage type ───────────────────────────────────────────────────────────────
type Stage = 'idle' | 'loading' | 'adjusting' | 'mapping' | 'saved'

// ─── Component ────────────────────────────────────────────────────────────────
export default function GridMapPage() {
  const canvasRef    = useRef<HTMLCanvasElement>(null)
  const svgRef       = useRef<SVGSVGElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const pdfDocRef    = useRef<any>(null)
  const draggingRef  = useRef<{ type: 'v' | 'h'; idx: number } | null>(null)

  const [stage, setStage]               = useState<Stage>('idle')
  const [fileName, setFileName]         = useState('')
  const [totalPages, setTotalPages]     = useState(1)
  const [currentPage, setCurrentPage]   = useState(1)
  const [dragOver, setDragOver]         = useState(false)

  // Grid lines as % (0–100) of canvas dimensions
  const [vLines, setVLines] = useState<number[]>([25, 50, 75])
  const [hLines, setHLines] = useState<number[]>([16.67, 33.33, 50, 66.67, 83.33])

  // Interaction state
  const [hovLine, setHovLine]   = useState<{ type: 'v' | 'h'; idx: number } | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [hovCell, setHovCell]   = useState<number | null>(null)
  const [selCell, setSelCell]   = useState<number | null>(null)

  // Mapping stage
  const [docType, setDocType]   = useState('')
  const [fieldMap, setFieldMap] = useState<Record<number, string>>({})
  const [saving, setSaving]     = useState(false)
  const [savedId, setSavedId]   = useState('')
  const [saveErr, setSaveErr]   = useState('')

  const cells   = buildCells(vLines, hLines)
  const numCols = vLines.length + 1
  const numRows = hLines.length + 1

  // ── processFile ──────────────────────────────────────────────────────────────
  const processFile = useCallback(async (file: File) => {
    if (!file || file.type !== 'application/pdf') { alert('PDF file ekak denna'); return }
    setStage('loading')
    setFileName(file.name)
    setSelCell(null)
    setSavedId('')
    setSaveErr('')
    try {
      const pdfjsLib = await loadPdfJs()
      const ab  = await file.arrayBuffer()
      const pdf = await pdfjsLib.getDocument({ data: ab }).promise
      pdfDocRef.current = pdf
      setTotalPages(pdf.numPages)
      setCurrentPage(1)
      setStage('adjusting')
      await new Promise(r => setTimeout(r, 60))
      if (canvasRef.current) await renderPage(pdf, 1, canvasRef.current)
    } catch (err: any) {
      alert('Error: ' + err.message)
      setStage('idle')
    }
  }, [])

  const goToPage = useCallback(async (p: number) => {
    if (!pdfDocRef.current || !canvasRef.current) return
    const page = Math.max(1, Math.min(p, totalPages))
    setCurrentPage(page)
    await renderPage(pdfDocRef.current, page, canvasRef.current)
  }, [totalPages])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false)
    const f = e.dataTransfer.files[0]; if (f) processFile(f)
  }, [processFile])

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (f) processFile(f); e.target.value = ''
  }, [processFile])

  const reset = () => {
    setStage('idle'); setFileName(''); pdfDocRef.current = null
    setTotalPages(1); setCurrentPage(1); setSelCell(null)
    setDocType(''); setFieldMap({}); setSavedId(''); setSaveErr('')
  }

  // ── Grid line add / remove ────────────────────────────────────────────────
  function addLine(type: 'v' | 'h') {
    const setter = type === 'v' ? setVLines : setHLines
    setter(prev => {
      const bounds = [0, ...sortedCopy(prev), 100]
      let maxGap = 0, insertAt = 50
      for (let i = 0; i < bounds.length - 1; i++) {
        const gap = bounds[i + 1] - bounds[i]
        if (gap > maxGap) { maxGap = gap; insertAt = (bounds[i] + bounds[i + 1]) / 2 }
      }
      return sortedCopy([...prev, insertAt])
    })
  }

  function removeLine(type: 'v' | 'h') {
    if (type === 'v') setVLines(prev => prev.slice(0, -1))
    else              setHLines(prev => prev.slice(0, -1))
  }

  // ── SVG drag handlers ─────────────────────────────────────────────────────
  const onLineMouseDown = useCallback((e: React.MouseEvent, type: 'v' | 'h', idx: number) => {
    e.preventDefault()
    e.stopPropagation()
    draggingRef.current = { type, idx }
    setIsDragging(true)
  }, [])

  const onSvgMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (!draggingRef.current || !svgRef.current) return
    const rect = svgRef.current.getBoundingClientRect()
    const { type, idx } = draggingRef.current
    if (type === 'v') {
      const pct = Math.max(1, Math.min(99, ((e.clientX - rect.left) / rect.width) * 100))
      setVLines(prev => { const n = [...prev]; n[idx] = pct; return n })
    } else {
      const pct = Math.max(1, Math.min(99, ((e.clientY - rect.top) / rect.height) * 100))
      setHLines(prev => { const n = [...prev]; n[idx] = pct; return n })
    }
  }, [])

  const onSvgMouseUp = useCallback(() => {
    if (!draggingRef.current) return
    draggingRef.current = null
    setIsDragging(false)
    setHovLine(null)
    setVLines(prev => sortedCopy(prev))
    setHLines(prev => sortedCopy(prev))
  }, [])

  // Cell hover: only when not dragging, compute from mouse pos over SVG
  const onSvgCellHover = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (draggingRef.current || !svgRef.current) return
    const rect = svgRef.current.getBoundingClientRect()
    const px   = ((e.clientX - rect.left) / rect.width) * 100
    const py   = ((e.clientY - rect.top)  / rect.height) * 100
    const vSorted = sortedCopy(vLines)
    const hSorted = sortedCopy(hLines)
    const col = vSorted.findIndex(x => px < x)
    const row = hSorted.findIndex(y => py < y)
    const c   = col === -1 ? vSorted.length : col
    const r   = row === -1 ? hSorted.length : row
    setHovCell(r * (vSorted.length + 1) + c + 1)
  }, [vLines, hLines])

  const onSvgClick = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (draggingRef.current) return
    if (!svgRef.current) return
    const rect = svgRef.current.getBoundingClientRect()
    const px   = ((e.clientX - rect.left) / rect.width) * 100
    const py   = ((e.clientY - rect.top)  / rect.height) * 100
    const vSorted = sortedCopy(vLines)
    const hSorted = sortedCopy(hLines)
    const col = vSorted.findIndex(x => px < x)
    const row = hSorted.findIndex(y => py < y)
    const c   = col === -1 ? vSorted.length : col
    const r   = row === -1 ? hSorted.length : row
    const n   = r * (vSorted.length + 1) + c + 1
    setSelCell(prev => prev === n ? null : n)
  }, [vLines, hLines])

  // ── Confirm grid → mapping ────────────────────────────────────────────────
  function confirmGrid() {
    const init: Record<number, string> = {}
    cells.forEach(c => { init[c.num] = fieldMap[c.num] ?? '' })
    setFieldMap(init)
    setStage('mapping')
  }

  // ── Save template ─────────────────────────────────────────────────────────
  async function handleSave() {
    if (!docType.trim()) { alert('Document type name denna'); return }
    setSaving(true); setSaveErr('')
    try {
      const res = await fetch('/api/save-template', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          doc_type:    docType.trim(),
          grid_config: {
            vLines: sortedCopy(vLines),
            hLines: sortedCopy(hLines),
          },
          field_map: Object.fromEntries(
            Object.entries(fieldMap).map(([k, v]) => [k, v.trim()])
          ),
        }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      setSavedId(d.id)
      setStage('saved')
    } catch (err: any) {
      setSaveErr(err.message)
    } finally { setSaving(false) }
  }

  // ── Shared: PDF canvas panel (used in both adjusting + mapping stages) ────
  const PdfPanel = ({ interactive }: { interactive: boolean }) => (
    <div className="relative w-full">
      <canvas ref={interactive ? canvasRef : undefined} className="block w-full shadow-md"/>
      {/* SVG grid overlay */}
      <svg
        ref={interactive ? svgRef : undefined}
        className="absolute inset-0 w-full h-full"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        style={{ cursor: isDragging ? (hovLine?.type === 'v' ? 'ew-resize' : 'ns-resize') : 'default' }}
        onMouseMove={interactive ? (e) => { onSvgMouseMove(e); onSvgCellHover(e) } : undefined}
        onMouseUp={interactive ? onSvgMouseUp : undefined}
        onMouseLeave={interactive ? () => { onSvgMouseUp(); setHovCell(null) } : undefined}
        onClick={interactive ? onSvgClick : undefined}
      >
        {/* Cell highlights */}
        {cells.map(cell => {
          const isSel = selCell === cell.num
          const isHov = hovCell === cell.num && !isDragging
          return (
            <rect key={cell.num}
              x={cell.x} y={cell.y} width={cell.w} height={cell.h}
              fill={isSel ? 'rgba(220,38,38,0.18)' : isHov ? 'rgba(220,38,38,0.07)' : 'none'}
              style={{ pointerEvents: 'none' }}
            />
          )
        })}

        {/* Cell number badges */}
        {cells.map(cell => {
          const bw = Math.min(cell.w * 0.35, 8)
          const bh = Math.min(cell.h * 0.5,  5)
          const fs = Math.min(bw * 0.55, 2.5)
          return (
            <g key={`b${cell.num}`} style={{ pointerEvents: 'none' }}>
              <rect x={cell.x + 0.3} y={cell.y + 0.3} width={bw} height={bh} rx={0.5} fill="#dc2626"/>
              <text
                x={cell.x + 0.3 + bw / 2} y={cell.y + 0.3 + bh / 2}
                textAnchor="middle" dominantBaseline="middle"
                fill="white" fontSize={fs} fontWeight="bold" fontFamily="monospace"
                style={{ userSelect: 'none' }}
              >
                {cell.num}
              </text>
            </g>
          )
        })}

        {/* Vertical divider lines (draggable) */}
        {vLines.map((x, i) => {
          const isHov = hovLine?.type === 'v' && hovLine.idx === i
          return (
            <g key={`v${i}`}>
              {/* Invisible wide hit zone */}
              <line x1={x} y1={0} x2={x} y2={100}
                stroke="transparent" strokeWidth={3}
                style={{ cursor: interactive ? 'ew-resize' : 'default', pointerEvents: interactive ? 'stroke' : 'none' }}
                onMouseDown={interactive ? e => { onLineMouseDown(e, 'v', i); setHovLine({ type: 'v', idx: i }) } : undefined}
                onMouseEnter={interactive ? () => !isDragging && setHovLine({ type: 'v', idx: i }) : undefined}
                onMouseLeave={interactive ? () => !isDragging && setHovLine(null) : undefined}
              />
              {/* Visible line */}
              <line x1={x} y1={0} x2={x} y2={100}
                stroke={isHov ? '#f87171' : '#dc2626'}
                strokeWidth={isHov ? 0.5 : 0.3}
                style={{ pointerEvents: 'none' }}
              />
              {/* Drag handle dot */}
              {interactive && isHov && (
                <circle cx={x} cy={50} r={1.5} fill="#dc2626" style={{ pointerEvents: 'none' }}/>
              )}
            </g>
          )
        })}

        {/* Horizontal divider lines (draggable) */}
        {hLines.map((y, i) => {
          const isHov = hovLine?.type === 'h' && hovLine.idx === i
          return (
            <g key={`h${i}`}>
              <line x1={0} y1={y} x2={100} y2={y}
                stroke="transparent" strokeWidth={3}
                style={{ cursor: interactive ? 'ns-resize' : 'default', pointerEvents: interactive ? 'stroke' : 'none' }}
                onMouseDown={interactive ? e => { onLineMouseDown(e, 'h', i); setHovLine({ type: 'h', idx: i }) } : undefined}
                onMouseEnter={interactive ? () => !isDragging && setHovLine({ type: 'h', idx: i }) : undefined}
                onMouseLeave={interactive ? () => !isDragging && setHovLine(null) : undefined}
              />
              <line x1={0} y1={y} x2={100} y2={y}
                stroke={isHov ? '#f87171' : '#dc2626'}
                strokeWidth={isHov ? 0.5 : 0.3}
                style={{ pointerEvents: 'none' }}
              />
              {interactive && isHov && (
                <circle cx={50} cy={y} r={1.5} fill="#dc2626" style={{ pointerEvents: 'none' }}/>
              )}
            </g>
          )
        })}

        {/* Outer border */}
        <rect x={0} y={0} width={100} height={100}
          fill="none" stroke="#dc2626" strokeWidth={0.4}
          style={{ pointerEvents: 'none' }}
        />
      </svg>
    </div>
  )

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <AdminLayout>
      <div className="p-6 min-h-screen flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Grid Mapper</h1>
            <p className="text-gray-400 text-sm mt-0.5">
              {stage === 'idle'      && 'PDF upload karanna — grid overlay adjust karanna'}
              {stage === 'loading'   && 'PDF render wenawa...'}
              {stage === 'adjusting' && 'Grid lines drag karala adjust karanna → OK click'}
              {stage === 'mapping'   && 'Document type + field labels define karanna → Save'}
              {stage === 'saved'     && 'Template saved! Future PDFs auto-extract karanawa.'}
            </p>
          </div>
          {(stage === 'adjusting' || stage === 'mapping' || stage === 'saved') && (
            <button onClick={reset}
              className="flex items-center gap-2 text-sm text-gray-400 hover:text-red-500 transition-colors">
              <RotateCcw size={14}/> New Upload
            </button>
          )}
        </div>

        {/* ── IDLE: Upload zone ── */}
        {stage === 'idle' && (
          <div
            onDragOver={e => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`flex-1 border-2 border-dashed rounded-2xl p-20 text-center cursor-pointer transition-all ${
              dragOver ? 'border-red-400 bg-red-50' : 'border-gray-300 bg-white hover:border-red-400 hover:bg-red-50/30'
            }`}
          >
            <div className="w-16 h-16 rounded-2xl bg-red-50 flex items-center justify-center mx-auto mb-4">
              <Grid size={28} className="text-red-600"/>
            </div>
            <p className="text-lg font-semibold text-gray-700 mb-1">PDF eka drop karanna</p>
            <p className="text-gray-400 text-sm mb-5">හෝ click කරලා select කරන්න</p>
            <div className="inline-flex items-center gap-2 bg-red-600 text-white px-5 py-2.5 rounded-lg font-medium text-sm">
              <FileText size={16}/> PDF Select
            </div>
            <input ref={fileInputRef} type="file" accept=".pdf" className="hidden" onChange={handleFileInput}/>
          </div>
        )}

        {/* ── LOADING ── */}
        {stage === 'loading' && (
          <div className="flex-1 bg-white rounded-2xl flex flex-col items-center justify-center border">
            <div className="w-12 h-12 border-4 border-red-500 border-t-transparent rounded-full animate-spin mb-4"/>
            <p className="text-gray-600 font-medium">PDF render wenawa...</p>
            <p className="text-gray-400 text-sm mt-1">{fileName}</p>
          </div>
        )}

        {/* ── ADJUSTING: PDF + draggable grid ── */}
        {stage === 'adjusting' && (
          <div className="flex gap-4 flex-1" style={{ minHeight: '80vh' }}>

            {/* LEFT: canvas */}
            <div className="flex-1 bg-white rounded-xl border flex flex-col overflow-hidden">

              {/* Toolbar */}
              <div className="flex items-center gap-2 px-3 py-2 border-b bg-gray-50 text-xs flex-wrap">
                <FileText size={13} className="text-gray-400"/>
                <span className="font-medium text-gray-700 truncate max-w-[180px]">{fileName}</span>

                {totalPages > 1 && (
                  <div className="flex items-center gap-1">
                    <button onClick={() => goToPage(currentPage - 1)} disabled={currentPage <= 1}
                      className="p-1 rounded hover:bg-gray-200 disabled:opacity-30"><ChevronLeft size={13}/></button>
                    <span className="px-1 font-mono text-gray-500">{currentPage}/{totalPages}</span>
                    <button onClick={() => goToPage(currentPage + 1)} disabled={currentPage >= totalPages}
                      className="p-1 rounded hover:bg-gray-200 disabled:opacity-30"><ChevronRight size={13}/></button>
                  </div>
                )}

                {/* Grid controls */}
                <div className="ml-auto flex items-center gap-3 flex-wrap">
                  <div className="flex items-center gap-1 text-gray-500">
                    <span className="text-[11px] font-medium">Vertical</span>
                    <button onClick={() => removeLine('v')} disabled={vLines.length === 0}
                      className="w-5 h-5 rounded bg-gray-200 hover:bg-red-100 disabled:opacity-30 flex items-center justify-center">
                      <Minus size={10}/>
                    </button>
                    <span className="w-5 text-center text-[11px] font-mono">{vLines.length}</span>
                    <button onClick={() => addLine('v')}
                      className="w-5 h-5 rounded bg-gray-200 hover:bg-green-100 flex items-center justify-center">
                      <Plus size={10}/>
                    </button>
                  </div>
                  <div className="flex items-center gap-1 text-gray-500">
                    <span className="text-[11px] font-medium">Horizontal</span>
                    <button onClick={() => removeLine('h')} disabled={hLines.length === 0}
                      className="w-5 h-5 rounded bg-gray-200 hover:bg-red-100 disabled:opacity-30 flex items-center justify-center">
                      <Minus size={10}/>
                    </button>
                    <span className="w-5 text-center text-[11px] font-mono">{hLines.length}</span>
                    <button onClick={() => addLine('h')}
                      className="w-5 h-5 rounded bg-gray-200 hover:bg-green-100 flex items-center justify-center">
                      <Plus size={10}/>
                    </button>
                  </div>
                  <span className="text-gray-400 text-[11px]">{cells.length} cells</span>
                </div>
              </div>

              {/* Canvas + overlay */}
              <div className="flex-1 overflow-auto bg-gray-200">
                <PdfPanel interactive={true}/>
              </div>
            </div>

            {/* RIGHT: instructions + confirm */}
            <div className="w-56 flex flex-col gap-3 flex-shrink-0">
              <div className="bg-white rounded-xl border p-4 text-xs text-gray-600 space-y-3">
                <p className="font-semibold text-gray-800 text-sm">Grid Adjustment</p>
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <span className="w-5 h-5 rounded bg-red-100 text-red-600 flex items-center justify-center flex-shrink-0 font-bold text-[10px]">↔</span>
                    <span>Vertical lines drag karanna (ew-resize cursor)</span>
                  </div>
                  <div className="flex gap-2">
                    <span className="w-5 h-5 rounded bg-red-100 text-red-600 flex items-center justify-center flex-shrink-0 font-bold text-[10px]">↕</span>
                    <span>Horizontal lines drag karanna (ns-resize cursor)</span>
                  </div>
                  <div className="flex gap-2">
                    <Plus size={14} className="text-green-600 flex-shrink-0 mt-0.5"/>
                    <span>Toolbar + button eken line add karanna</span>
                  </div>
                  <div className="flex gap-2">
                    <Minus size={14} className="text-gray-400 flex-shrink-0 mt-0.5"/>
                    <span>− button eken last line remove</span>
                  </div>
                </div>
                <div className="pt-1 border-t text-gray-400">
                  Grid sari wuna kotama <span className="font-semibold text-gray-600">OK</span> click karanna
                </div>
              </div>

              {/* Cell count */}
              <div className="bg-white rounded-xl border p-3 text-center">
                <p className="text-2xl font-bold text-red-600">{cells.length}</p>
                <p className="text-xs text-gray-400 mt-0.5">{numRows} rows × {numCols} cols</p>
              </div>

              {/* OK button */}
              <button
                onClick={confirmGrid}
                className="flex items-center justify-center gap-2 bg-red-600 hover:bg-red-700 text-white font-semibold px-4 py-3 rounded-xl transition-colors shadow-sm"
              >
                <Check size={16}/> OK — Confirm Grid
              </button>

              {/* Upload another */}
              <label className="flex items-center justify-center gap-2 text-xs text-gray-400 rounded-xl border border-dashed border-gray-300 py-2.5 hover:border-red-400 hover:text-red-500 transition-colors cursor-pointer">
                <Upload size={12}/> New PDF
                <input type="file" accept=".pdf" className="hidden" onChange={handleFileInput}/>
              </label>
            </div>
          </div>
        )}

        {/* ── MAPPING: grid reference left + field form right ── */}
        {stage === 'mapping' && (
          <div className="flex gap-4 flex-1" style={{ minHeight: '80vh' }}>

            {/* LEFT: mini PDF preview (read-only) */}
            <div className="w-80 flex-shrink-0 bg-white rounded-xl border flex flex-col overflow-hidden">
              <div className="px-3 py-2 border-b bg-gray-50 text-xs text-gray-500 flex items-center gap-2">
                <Grid size={12} className="text-red-500"/>
                <span className="font-medium text-gray-700 truncate">{fileName}</span>
                <span className="ml-auto text-gray-400">{cells.length} cells</span>
              </div>
              <div className="flex-1 overflow-auto bg-gray-200">
                <PdfPanel interactive={false}/>
              </div>
            </div>

            {/* RIGHT: mapping form */}
            <div className="flex-1 bg-white rounded-xl border flex flex-col overflow-hidden">

              {/* Doc type header */}
              <div className="px-4 py-3 border-b bg-gray-50 flex items-center gap-3 flex-wrap">
                <div className="flex-1 min-w-[200px]">
                  <label className="block text-[11px] text-gray-400 font-medium mb-1 uppercase tracking-wide">
                    Document Type Name
                  </label>
                  <input
                    value={docType}
                    onChange={e => setDocType(e.target.value)}
                    placeholder="e.g. Customs Declaration Type A"
                    className="w-full px-3 py-1.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-red-400 focus:ring-1 focus:ring-red-200"
                  />
                </div>
                <div className="flex gap-2 items-end pb-0.5">
                  <button onClick={() => setStage('adjusting')}
                    className="px-3 py-1.5 rounded-lg border border-gray-200 text-xs text-gray-500 hover:bg-gray-50">
                    ← Edit Grid
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={saving || !docType.trim()}
                    className="flex items-center gap-2 px-4 py-1.5 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    {saving
                      ? <><div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"/> Saving...</>
                      : <><Save size={14}/> Save Template</>
                    }
                  </button>
                </div>
                {saveErr && (
                  <div className="w-full flex items-center gap-2 text-red-600 text-xs bg-red-50 rounded-lg px-3 py-1.5">
                    <AlertCircle size={12}/> {saveErr}
                  </div>
                )}
              </div>

              {/* Field mapping table */}
              <div className="flex-1 overflow-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-gray-50 border-b z-10">
                    <tr>
                      <th className="w-12 px-3 py-2 text-center text-xs text-gray-400 font-medium">#</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide w-24">Position</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">Field Label</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide w-2/5">Preview</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cells.map(cell => (
                      <tr key={cell.num}
                        className={`border-b transition-colors ${selCell === cell.num ? 'bg-red-50' : 'hover:bg-gray-50'}`}
                        onClick={() => setSelCell(prev => prev === cell.num ? null : cell.num)}
                      >
                        {/* Number badge */}
                        <td className="px-3 py-2 text-center">
                          <span className={`inline-flex items-center justify-center w-6 h-6 rounded text-white text-[10px] font-bold ${
                            selCell === cell.num ? 'bg-red-600' : 'bg-gray-300'
                          }`}>
                            {cell.num}
                          </span>
                        </td>

                        {/* Row / Col */}
                        <td className="px-3 py-2 text-xs text-gray-400 font-mono">
                          R{cell.row} C{cell.col}
                        </td>

                        {/* Field label input */}
                        <td className="px-2 py-1.5" onClick={e => e.stopPropagation()}>
                          <input
                            value={fieldMap[cell.num] ?? ''}
                            onChange={e => setFieldMap(prev => ({ ...prev, [cell.num]: e.target.value }))}
                            onFocus={() => setSelCell(cell.num)}
                            placeholder={`Box ${cell.num} label...`}
                            className={`w-full px-2 py-1 rounded border text-[12px] outline-none transition-colors ${
                              selCell === cell.num
                                ? 'border-red-300 bg-red-50 ring-1 ring-red-200'
                                : 'border-gray-200 hover:border-gray-300 focus:border-red-300'
                            }`}
                          />
                        </td>

                        {/* Preview: grid % location */}
                        <td className="px-3 py-2 text-[10px] text-gray-300 font-mono">
                          {cell.x.toFixed(1)}%,{cell.y.toFixed(1)}% — {cell.w.toFixed(1)}×{cell.h.toFixed(1)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Footer hint */}
              <div className="px-4 py-2 border-t bg-gray-50 text-xs text-gray-400">
                {Object.values(fieldMap).filter(v => v.trim()).length} / {cells.length} fields labelled — unlabelled cells saved as empty
              </div>
            </div>
          </div>
        )}

        {/* ── SAVED ── */}
        {stage === 'saved' && (
          <div className="flex-1 bg-white rounded-2xl border flex flex-col items-center justify-center gap-4 p-12">
            <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center">
              <Check size={32} className="text-green-600"/>
            </div>
            <div className="text-center">
              <p className="text-xl font-bold text-gray-800 mb-1">Template Saved!</p>
              <p className="text-gray-500 text-sm">
                <span className="font-semibold text-gray-700">"{docType}"</span> — {cells.length} grid cells configured
              </p>
            </div>

            {/* Template ID */}
            <div className="bg-gray-50 rounded-xl border px-4 py-3 text-center space-y-1">
              <p className="text-xs text-gray-400 font-medium">Template ID</p>
              <div className="flex items-center gap-2">
                <code className="text-xs font-mono text-gray-700">{savedId}</code>
                <button onClick={() => navigator.clipboard.writeText(savedId)}
                  className="text-gray-400 hover:text-gray-600"><Copy size={12}/></button>
              </div>
            </div>

            {/* Future pipeline note */}
            <div className="max-w-md bg-blue-50 border border-blue-100 rounded-xl p-4 text-xs text-blue-700 space-y-1.5">
              <p className="font-semibold text-blue-800">Auto-Extraction Pipeline (Ready)</p>
              <p>Future PDF ekak upload wena kota system eka:</p>
              <ol className="list-decimal list-inside space-y-1 text-blue-600">
                <li>Document type identify karanawa</li>
                <li>DB eken template load karanawa (grid_config)</li>
                <li>Saved % coordinates → pixel crop regions convert karanawa</li>
                <li>Each cell eken OCR / Vision API eken text extract karanawa</li>
                <li>field_map eken structured data return karanawa</li>
              </ol>
            </div>

            <div className="flex gap-3">
              <button onClick={reset}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-red-600 text-white font-medium text-sm hover:bg-red-700">
                <Upload size={14}/> New Template
              </button>
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  )
}
