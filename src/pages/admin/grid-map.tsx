import { useState, useRef, useCallback, useEffect } from 'react'
import AdminLayout from '@/components/admin/AdminLayout'
import { Upload, FileText, RotateCcw, ChevronLeft, ChevronRight, Grid } from 'lucide-react'

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

export default function GridMapPage() {
  const canvasRef    = useRef<HTMLCanvasElement>(null)
  const wrapRef      = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const pdfDocRef    = useRef<any>(null)

  const [stage, setStage]             = useState<'idle' | 'loading' | 'ready'>('idle')
  const [fileName, setFileName]       = useState('')
  const [totalPages, setTotalPages]   = useState(1)
  const [currentPage, setCurrentPage] = useState(1)
  const [dragOver, setDragOver]       = useState(false)
  const [cols, setCols]               = useState(4)
  const [rows, setRows]               = useState(6)
  const [hoveredCell, setHoveredCell] = useState<number | null>(null)
  const [selectedCell, setSelectedCell] = useState<number | null>(null)
  const [wrapSize, setWrapSize]       = useState({ w: 0, h: 0 })

  // Measure wrapper div size (not canvas pixel size) for SVG overlay
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const obs = new ResizeObserver(() => {
      setWrapSize({ w: el.offsetWidth, h: el.offsetHeight })
    })
    obs.observe(el)
    return () => obs.disconnect()
  }, [stage])

  const goToPage = useCallback(async (page: number) => {
    if (!pdfDocRef.current || !canvasRef.current) return
    const p = Math.max(1, Math.min(page, totalPages))
    setCurrentPage(p)
    await renderPage(pdfDocRef.current, p, canvasRef.current)
  }, [totalPages])

  const processFile = useCallback(async (file: File) => {
    if (!file || file.type !== 'application/pdf') { alert('PDF file ekak denna'); return }
    setStage('loading')
    setFileName(file.name)
    setSelectedCell(null)
    try {
      const pdfjsLib = await loadPdfJs()
      const ab  = await file.arrayBuffer()
      const pdf = await pdfjsLib.getDocument({ data: ab }).promise
      pdfDocRef.current = pdf
      setTotalPages(pdf.numPages)
      setCurrentPage(1)
      setStage('ready')
      // render after state update so canvas is in DOM
      await new Promise(r => setTimeout(r, 50))
      if (canvasRef.current) {
        await renderPage(pdf, 1, canvasRef.current)
        if (wrapRef.current) {
          setWrapSize({ w: wrapRef.current.offsetWidth, h: wrapRef.current.offsetHeight })
        }
      }
    } catch (err: any) {
      alert('Error: ' + err.message)
      setStage('idle')
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
    setStage('idle'); setFileName(''); pdfDocRef.current = null
    setTotalPages(1); setCurrentPage(1); setSelectedCell(null)
  }

  const totalCells = rows * cols
  const cellNum    = (r: number, c: number) => r * cols + c + 1
  const cellW      = wrapSize.w / cols
  const cellH      = wrapSize.h / rows

  return (
    <AdminLayout>
      <div className="p-6 min-h-screen flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Grid Mapper</h1>
            <p className="text-gray-400 text-sm mt-0.5">
              PDF upload → numbered red grid overlay
            </p>
          </div>
          {stage === 'ready' && (
            <button onClick={reset}
              className="flex items-center gap-2 text-sm text-gray-400 hover:text-red-500 transition-colors">
              <RotateCcw size={14}/> New Upload
            </button>
          )}
        </div>

        {/* Upload zone — only when idle */}
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

        {/* Loading */}
        {stage === 'loading' && (
          <div className="flex-1 bg-white rounded-2xl flex flex-col items-center justify-center border">
            <div className="w-12 h-12 border-4 border-red-500 border-t-transparent rounded-full animate-spin mb-4"/>
            <p className="text-gray-600 font-medium">PDF render wenawa...</p>
            <p className="text-gray-400 text-sm mt-1">{fileName}</p>
          </div>
        )}

        {/* ── PDF + Grid panel — always mounted when ready so canvasRef stays valid ── */}
        {stage === 'ready' && (
          <div className="flex gap-5 flex-1" style={{ minHeight: '80vh' }}>

            {/* LEFT: canvas + overlay */}
            <div className="flex-1 bg-white rounded-xl border flex flex-col overflow-hidden">

              {/* Toolbar */}
              <div className="flex items-center gap-2 px-3 py-2 border-b bg-gray-50 text-xs text-gray-500 flex-wrap">
                <FileText size={13} className="text-gray-400"/>
                <span className="font-medium text-gray-700 truncate max-w-xs">{fileName}</span>

                {totalPages > 1 && (
                  <div className="flex items-center gap-1 ml-2">
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

                <div className="ml-auto flex items-center gap-3">
                  <label className="flex items-center gap-1 text-gray-500">
                    Cols
                    <input type="number" min={1} max={20} value={cols}
                      onChange={e => { setCols(Math.max(1, Math.min(20, +e.target.value))); setSelectedCell(null) }}
                      className="w-12 px-1 py-0.5 rounded border border-gray-200 text-center text-xs focus:outline-none focus:border-red-400"/>
                  </label>
                  <label className="flex items-center gap-1 text-gray-500">
                    Rows
                    <input type="number" min={1} max={30} value={rows}
                      onChange={e => { setRows(Math.max(1, Math.min(30, +e.target.value))); setSelectedCell(null) }}
                      className="w-12 px-1 py-0.5 rounded border border-gray-200 text-center text-xs focus:outline-none focus:border-red-400"/>
                  </label>
                  <span className="text-gray-400">{totalCells} cells</span>
                </div>

                {selectedCell !== null && (
                  <span className="text-red-600 font-semibold bg-red-50 px-2 py-0.5 rounded text-[11px] border border-red-200">
                    Grid #{selectedCell} selected
                  </span>
                )}
              </div>

              {/* Canvas area */}
              <div className="flex-1 overflow-auto bg-gray-200">
                {/* wrapRef div — same display size as the canvas image */}
                <div className="relative w-full" ref={wrapRef}>

                  {/* PDF canvas — always in DOM when stage=ready */}
                  <canvas ref={canvasRef} className="block w-full shadow-md"/>

                  {/* SVG grid overlay */}
                  {wrapSize.w > 0 && wrapSize.h > 0 && (
                    <svg
                      className="absolute inset-0 pointer-events-none"
                      width={wrapSize.w}
                      height={wrapSize.h}
                      viewBox={`0 0 ${wrapSize.w} ${wrapSize.h}`}
                    >
                      {/* Cell highlights */}
                      {Array.from({ length: rows }, (_, r) =>
                        Array.from({ length: cols }, (_, c) => {
                          const num = cellNum(r, c)
                          const x   = c * cellW
                          const y   = r * cellH
                          const sel = selectedCell === num
                          const hov = hoveredCell === num
                          const badgeW = Math.min(cellW - 2, cols > 8 ? 18 : 28)
                          const badgeH = Math.min(cellH - 2, rows > 12 ? 12 : 18)
                          const fs    = badgeW < 20 ? 7 : 9
                          return (
                            <g key={num}>
                              <rect x={x} y={y} width={cellW} height={cellH}
                                fill={sel ? 'rgba(220,38,38,0.18)' : hov ? 'rgba(220,38,38,0.08)' : 'none'}
                                style={{ pointerEvents: 'none' }}/>
                              <rect x={x + 1} y={y + 1} width={badgeW} height={badgeH} rx={2}
                                fill="#dc2626" style={{ pointerEvents: 'none' }}/>
                              <text
                                x={x + 1 + badgeW / 2} y={y + 1 + badgeH / 2}
                                textAnchor="middle" dominantBaseline="middle"
                                fill="white" fontSize={fs} fontWeight="bold" fontFamily="monospace"
                                style={{ pointerEvents: 'none', userSelect: 'none' }}>
                                {num}
                              </text>
                            </g>
                          )
                        })
                      )}

                      {/* Vertical lines */}
                      {Array.from({ length: cols - 1 }, (_, i) => (
                        <line key={`v${i}`}
                          x1={(i+1)*cellW} y1={0} x2={(i+1)*cellW} y2={wrapSize.h}
                          stroke="#dc2626" strokeWidth={1.5} style={{ pointerEvents: 'none' }}/>
                      ))}

                      {/* Horizontal lines */}
                      {Array.from({ length: rows - 1 }, (_, i) => (
                        <line key={`h${i}`}
                          x1={0} y1={(i+1)*cellH} x2={wrapSize.w} y2={(i+1)*cellH}
                          stroke="#dc2626" strokeWidth={1.5} style={{ pointerEvents: 'none' }}/>
                      ))}

                      {/* Border */}
                      <rect x={0} y={0} width={wrapSize.w} height={wrapSize.h}
                        fill="none" stroke="#dc2626" strokeWidth={2}
                        style={{ pointerEvents: 'none' }}/>
                    </svg>
                  )}

                  {/* Interaction layer */}
                  {wrapSize.w > 0 && (
                    <div
                      className="absolute inset-0"
                      style={{ cursor: 'crosshair' }}
                      onMouseMove={e => {
                        const rect = e.currentTarget.getBoundingClientRect()
                        const c = Math.floor((e.clientX - rect.left) / cellW)
                        const r = Math.floor((e.clientY - rect.top)  / cellH)
                        setHoveredCell(c >= 0 && c < cols && r >= 0 && r < rows ? cellNum(r, c) : null)
                      }}
                      onMouseLeave={() => setHoveredCell(null)}
                      onClick={e => {
                        const rect = e.currentTarget.getBoundingClientRect()
                        const c = Math.floor((e.clientX - rect.left) / cellW)
                        const r = Math.floor((e.clientY - rect.top)  / cellH)
                        if (c >= 0 && c < cols && r >= 0 && r < rows) {
                          const n = cellNum(r, c)
                          setSelectedCell(prev => prev === n ? null : n)
                        }
                      }}
                    />
                  )}
                </div>
              </div>
            </div>

            {/* RIGHT: reference panel */}
            <div className="w-60 bg-white rounded-xl border flex flex-col overflow-hidden flex-shrink-0">
              <div className="px-4 py-3 border-b bg-gray-50">
                <p className="text-sm font-semibold text-gray-700">Grid Reference</p>
                <p className="text-xs text-gray-400 mt-0.5">{rows} × {cols} = {totalCells} cells</p>
              </div>

              {selectedCell !== null ? (
                <div className="p-4 border-b">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="w-8 h-8 rounded-lg bg-red-600 text-white flex items-center justify-center text-sm font-bold flex-shrink-0">
                      {selectedCell}
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-gray-800">Grid #{selectedCell}</p>
                      <p className="text-xs text-gray-400">
                        Row {Math.ceil(selectedCell / cols)}, Col {((selectedCell - 1) % cols) + 1}
                      </p>
                    </div>
                  </div>
                  <div className="bg-red-50 border border-red-100 rounded-lg p-2.5 text-xs text-red-700 font-mono leading-relaxed">
                    extract from Grid #{selectedCell}
                  </div>
                  <button onClick={() => setSelectedCell(null)}
                    className="mt-2 text-xs text-gray-400 hover:text-gray-600 w-full text-center">
                    Deselect
                  </button>
                </div>
              ) : (
                <div className="p-4 border-b text-xs text-gray-400 italic">
                  Grid cell ekak click karanna...
                </div>
              )}

              <div className="flex-1 overflow-auto p-3">
                <p className="text-xs text-gray-400 mb-2 font-medium">All cells</p>
                <div className="grid gap-px" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
                  {Array.from({ length: totalCells }, (_, i) => {
                    const n = i + 1
                    return (
                      <button key={n}
                        onClick={() => setSelectedCell(prev => prev === n ? null : n)}
                        className={`aspect-square flex items-center justify-center text-[9px] font-bold rounded-sm transition-colors ${
                          selectedCell === n
                            ? 'bg-red-600 text-white'
                            : 'bg-gray-100 text-gray-500 hover:bg-red-100 hover:text-red-700'
                        }`}>
                        {n}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="p-3 border-t">
                <label className="flex items-center justify-center gap-2 w-full py-2 text-xs text-gray-500 rounded-lg border border-dashed border-gray-300 hover:border-red-400 hover:text-red-600 transition-colors cursor-pointer">
                  <Upload size={12}/> Wenama PDF
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
