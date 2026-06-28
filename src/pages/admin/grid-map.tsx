import { useState, useRef, useCallback, useEffect } from 'react'
import AdminLayout from '@/components/admin/AdminLayout'
import { Upload, FileText, RotateCcw, ChevronLeft, ChevronRight, Grid } from 'lucide-react'

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

// ─── Component ────────────────────────────────────────────────────────────────
export default function GridMapPage() {
  const canvasRef    = useRef<HTMLCanvasElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const pdfDocRef    = useRef<any>(null)

  const [pdfReady, setPdfReady]       = useState(false)
  const [loading, setLoading]         = useState(false)
  const [fileName, setFileName]       = useState('')
  const [totalPages, setTotalPages]   = useState(1)
  const [currentPage, setCurrentPage] = useState(1)
  const [dragOver, setDragOver]       = useState(false)
  const [cols, setCols]               = useState(4)
  const [rows, setRows]               = useState(6)
  const [hoveredCell, setHoveredCell] = useState<number | null>(null)
  const [selectedCell, setSelectedCell] = useState<number | null>(null)

  // canvas size tracked so overlay SVG matches exactly
  const [canvasSize, setCanvasSize] = useState({ w: 0, h: 0 })

  // Observe canvas size changes (scale changes on render)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const obs = new ResizeObserver(() => {
      setCanvasSize({ w: canvas.offsetWidth, h: canvas.offsetHeight })
    })
    obs.observe(canvas)
    return () => obs.disconnect()
  }, [pdfReady])

  const goToPage = useCallback(async (page: number) => {
    if (!pdfDocRef.current || !canvasRef.current) return
    const p = Math.max(1, Math.min(page, totalPages))
    setCurrentPage(p)
    await renderPage(pdfDocRef.current, p, canvasRef.current)
    const c = canvasRef.current
    setCanvasSize({ w: c.offsetWidth, h: c.offsetHeight })
  }, [totalPages])

  const processFile = useCallback(async (file: File) => {
    if (!file || file.type !== 'application/pdf') { alert('PDF file ekak danna'); return }
    setLoading(true)
    setPdfReady(false)
    setFileName(file.name)
    setSelectedCell(null)
    try {
      const pdfjsLib = await loadPdfJs()
      const ab  = await file.arrayBuffer()
      const pdf = await pdfjsLib.getDocument({ data: ab }).promise
      pdfDocRef.current = pdf
      setTotalPages(pdf.numPages)
      setCurrentPage(1)
      if (canvasRef.current) {
        await renderPage(pdf, 1, canvasRef.current)
        const c = canvasRef.current
        setCanvasSize({ w: c.offsetWidth, h: c.offsetHeight })
        setPdfReady(true)
      }
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
    setPdfReady(false); setFileName(''); pdfDocRef.current = null
    setTotalPages(1); setCurrentPage(1); setSelectedCell(null)
    if (canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d')
      ctx?.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height)
    }
  }

  const totalCells = rows * cols
  // cell number given row r (0-indexed) and col c (0-indexed) → left-to-right, top-to-bottom
  const cellNum = (r: number, c: number) => r * cols + c + 1

  const cellW = canvasSize.w / cols
  const cellH = canvasSize.h / rows

  return (
    <AdminLayout>
      <div className="p-6 min-h-screen flex flex-col">

        {/* ── Header ── */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Grid Mapper</h1>
            <p className="text-gray-400 text-sm mt-0.5">
              PDF upload karanna — numbered red grid overlay show wanawa
            </p>
          </div>
          {pdfReady && (
            <button onClick={reset}
              className="flex items-center gap-2 text-sm text-gray-400 hover:text-red-500 transition-colors">
              <RotateCcw size={14}/> New Upload
            </button>
          )}
        </div>

        {/* ── Upload zone ── */}
        {!pdfReady && !loading && (
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

        {/* ── Loading ── */}
        {loading && (
          <div className="flex-1 bg-white rounded-2xl flex flex-col items-center justify-center border">
            <div className="w-12 h-12 border-4 border-red-500 border-t-transparent rounded-full animate-spin mb-4"/>
            <p className="text-gray-600 font-medium">PDF render wenawa...</p>
            <p className="text-gray-400 text-sm mt-1">{fileName}</p>
          </div>
        )}

        {/* ── PDF + Grid view ── */}
        {pdfReady && !loading && (
          <div className="flex gap-5 flex-1" style={{ minHeight: '80vh' }}>

            {/* ─── LEFT: PDF canvas with red grid overlay ─── */}
            <div className="flex-1 bg-white rounded-xl border flex flex-col overflow-hidden">

              {/* Toolbar */}
              <div className="flex items-center gap-2 px-3 py-2 border-b bg-gray-50 text-xs text-gray-500 flex-wrap">
                <FileText size={13} className="text-gray-400"/>
                <span className="font-medium text-gray-700 truncate max-w-xs">{fileName}</span>

                {/* Page nav */}
                {totalPages > 1 && (
                  <div className="flex items-center gap-1 ml-2">
                    <button onClick={() => goToPage(currentPage - 1)} disabled={currentPage <= 1}
                      className="p-1 rounded hover:bg-gray-200 disabled:opacity-30">
                      <ChevronLeft size={13}/>
                    </button>
                    <span className="px-2 font-mono text-gray-600">{currentPage} / {totalPages}</span>
                    <button onClick={() => goToPage(currentPage + 1)} disabled={currentPage >= totalPages}
                      className="p-1 rounded hover:bg-gray-200 disabled:opacity-30">
                      <ChevronRight size={13}/>
                    </button>
                  </div>
                )}

                <div className="ml-auto flex items-center gap-3">
                  {/* Grid controls */}
                  <label className="flex items-center gap-1 text-gray-500">
                    Cols
                    <input
                      type="number" min={1} max={20} value={cols}
                      onChange={e => { setCols(Math.max(1, Math.min(20, +e.target.value))); setSelectedCell(null) }}
                      className="w-12 px-1 py-0.5 rounded border border-gray-200 text-center text-xs focus:outline-none focus:border-red-400"
                    />
                  </label>
                  <label className="flex items-center gap-1 text-gray-500">
                    Rows
                    <input
                      type="number" min={1} max={30} value={rows}
                      onChange={e => { setRows(Math.max(1, Math.min(30, +e.target.value))); setSelectedCell(null) }}
                      className="w-12 px-1 py-0.5 rounded border border-gray-200 text-center text-xs focus:outline-none focus:border-red-400"
                    />
                  </label>
                  <span className="text-gray-400">{totalCells} cells</span>
                </div>

                {selectedCell !== null && (
                  <span className="text-red-600 font-semibold bg-red-50 px-2 py-0.5 rounded text-[11px] border border-red-200">
                    Grid #{selectedCell} selected
                  </span>
                )}
              </div>

              {/* Canvas + SVG overlay */}
              <div className="flex-1 overflow-auto bg-gray-200">
                <div className="relative inline-block w-full">

                  {/* PDF canvas */}
                  <canvas
                    ref={canvasRef}
                    className="block w-full shadow-md"
                  />

                  {/* Red grid SVG overlay — sits exactly on top */}
                  {canvasSize.w > 0 && (
                    <svg
                      className="absolute inset-0 pointer-events-none"
                      width={canvasSize.w}
                      height={canvasSize.h}
                      viewBox={`0 0 ${canvasSize.w} ${canvasSize.h}`}
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      {/* Cell fills + numbers (pointer-events via foreignObject trick: use rects with events) */}
                      {Array.from({ length: rows }, (_, r) =>
                        Array.from({ length: cols }, (_, c) => {
                          const num  = cellNum(r, c)
                          const x    = c * cellW
                          const y    = r * cellH
                          const isHovered  = hoveredCell === num
                          const isSelected = selectedCell === num
                          return (
                            <g key={num}>
                              {/* Cell background highlight */}
                              <rect
                                x={x} y={y} width={cellW} height={cellH}
                                fill={
                                  isSelected
                                    ? 'rgba(220,38,38,0.18)'
                                    : isHovered
                                      ? 'rgba(220,38,38,0.08)'
                                      : 'rgba(0,0,0,0)'
                                }
                                style={{ pointerEvents: 'none' }}
                              />
                              {/* Number badge background */}
                              <rect
                                x={x + 1} y={y + 1}
                                width={cellW < 60 ? Math.min(cellW - 2, 28) : 32}
                                height={cellH < 30 ? Math.min(cellH - 2, 16) : 18}
                                rx={2}
                                fill={isSelected ? '#dc2626' : isHovered ? '#ef4444' : '#dc2626'}
                                style={{ pointerEvents: 'none' }}
                              />
                              {/* Number text */}
                              <text
                                x={x + (cellW < 60 ? Math.min(cellW - 2, 28) / 2 : 16)}
                                y={y + (cellH < 30 ? Math.min(cellH - 2, 16) / 2 : 9) + 1}
                                textAnchor="middle"
                                dominantBaseline="middle"
                                fill="white"
                                fontSize={cellW < 50 ? 7 : cellH < 25 ? 7 : 9}
                                fontWeight="bold"
                                fontFamily="monospace"
                                style={{ pointerEvents: 'none', userSelect: 'none' }}
                              >
                                {num}
                              </text>
                            </g>
                          )
                        })
                      )}

                      {/* Vertical red grid lines */}
                      {Array.from({ length: cols - 1 }, (_, i) => (
                        <line
                          key={`v${i}`}
                          x1={(i + 1) * cellW} y1={0}
                          x2={(i + 1) * cellW} y2={canvasSize.h}
                          stroke="#dc2626" strokeWidth={1.5}
                          style={{ pointerEvents: 'none' }}
                        />
                      ))}

                      {/* Horizontal red grid lines */}
                      {Array.from({ length: rows - 1 }, (_, i) => (
                        <line
                          key={`h${i}`}
                          x1={0}           y1={(i + 1) * cellH}
                          x2={canvasSize.w} y2={(i + 1) * cellH}
                          stroke="#dc2626" strokeWidth={1.5}
                          style={{ pointerEvents: 'none' }}
                        />
                      ))}

                      {/* Outer border */}
                      <rect
                        x={0} y={0}
                        width={canvasSize.w} height={canvasSize.h}
                        fill="none"
                        stroke="#dc2626" strokeWidth={2}
                        style={{ pointerEvents: 'none' }}
                      />
                    </svg>
                  )}

                  {/* Invisible click/hover capture layer on top of SVG */}
                  {canvasSize.w > 0 && (
                    <div
                      className="absolute inset-0"
                      style={{ width: canvasSize.w, height: canvasSize.h, cursor: 'crosshair' }}
                      onMouseMove={e => {
                        const rect = e.currentTarget.getBoundingClientRect()
                        const mx = e.clientX - rect.left
                        const my = e.clientY - rect.top
                        const c = Math.floor(mx / cellW)
                        const r = Math.floor(my / cellH)
                        if (c >= 0 && c < cols && r >= 0 && r < rows) {
                          setHoveredCell(cellNum(r, c))
                        } else {
                          setHoveredCell(null)
                        }
                      }}
                      onMouseLeave={() => setHoveredCell(null)}
                      onClick={e => {
                        const rect = e.currentTarget.getBoundingClientRect()
                        const mx = e.clientX - rect.left
                        const my = e.clientY - rect.top
                        const c = Math.floor(mx / cellW)
                        const r = Math.floor(my / cellH)
                        if (c >= 0 && c < cols && r >= 0 && r < rows) {
                          const num = cellNum(r, c)
                          setSelectedCell(prev => prev === num ? null : num)
                        }
                      }}
                    />
                  )}
                </div>
              </div>
            </div>

            {/* ─── RIGHT: Grid reference panel ─── */}
            <div className="w-64 bg-white rounded-xl border flex flex-col overflow-hidden flex-shrink-0">
              <div className="px-4 py-3 border-b bg-gray-50">
                <p className="text-sm font-semibold text-gray-700">Grid Reference</p>
                <p className="text-xs text-gray-400 mt-0.5">{rows} rows × {cols} cols = {totalCells} cells</p>
              </div>

              {/* Selected cell info */}
              {selectedCell !== null ? (
                <div className="p-4 border-b">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="w-8 h-8 rounded-lg bg-red-600 text-white flex items-center justify-center text-sm font-bold">
                      {selectedCell}
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-gray-800">Grid #{selectedCell}</p>
                      <p className="text-xs text-gray-400">
                        Row {Math.ceil(selectedCell / cols)}, Col {((selectedCell - 1) % cols) + 1}
                      </p>
                    </div>
                  </div>
                  <div className="bg-red-50 border border-red-100 rounded-lg p-2.5 text-xs text-red-700 font-mono">
                    extract from Grid #{selectedCell}
                  </div>
                  <button
                    onClick={() => setSelectedCell(null)}
                    className="mt-2 text-xs text-gray-400 hover:text-gray-600 w-full text-center"
                  >
                    Deselect
                  </button>
                </div>
              ) : (
                <div className="p-4 border-b text-xs text-gray-400 italic">
                  PDF ekaka grid ekak click karanna...
                </div>
              )}

              {/* Mini grid map */}
              <div className="flex-1 overflow-auto p-3">
                <p className="text-xs text-gray-400 mb-2 font-medium">All cells</p>
                <div
                  className="grid gap-px"
                  style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
                >
                  {Array.from({ length: totalCells }, (_, i) => {
                    const num = i + 1
                    const isSelected = selectedCell === num
                    return (
                      <button
                        key={num}
                        onClick={() => setSelectedCell(prev => prev === num ? null : num)}
                        className={`aspect-square flex items-center justify-center text-[9px] font-bold rounded-sm transition-colors ${
                          isSelected
                            ? 'bg-red-600 text-white'
                            : 'bg-gray-100 text-gray-500 hover:bg-red-100 hover:text-red-700'
                        }`}
                        title={`Grid #${num}`}
                      >
                        {num}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Upload another */}
              <div className="p-3 border-t">
                <label className="flex items-center justify-center gap-2 w-full py-2 text-xs text-gray-500 rounded-lg border border-dashed border-gray-300 hover:border-red-400 hover:text-red-600 transition-colors cursor-pointer">
                  <Upload size={12}/> Upload another PDF
                  <input type="file" accept=".pdf" className="hidden" onChange={handleFileInput}/>
                </label>
              </div>
            </div>

          </div>
        )}
      </div>
    </AdminLayout>
  )
}
