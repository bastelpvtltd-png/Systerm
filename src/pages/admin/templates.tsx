import { useEffect, useState } from 'react'
import AdminLayout, { usePermission } from '@/components/admin/AdminLayout'
import { authHeader } from '@/lib/supabase'
import { FileStack, Trash2, FileDown, AlertTriangle, Loader, Plus, X, Zap, Save, Link2, Settings, Upload } from 'lucide-react'

// Word template upload with {{placeholder}} tags (e.g. {{invoice_number}},
// {{consignee_name}}, {{total_value}}) — upload once, then any time a
// document of that shape is needed, pick the template, fill in the detected
// tags, and get a one-page PDF with those values substituted in place of the
// tags (paragraph layout/order preserved from the original .docx).
interface DocTemplate { id: string; name: string; file_name: string; drive_url: string | null; raw_text: string; placeholders: string[]; created_at: string }

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve((reader.result as string).split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function TemplatesContent() {
  const { has } = usePermission()
  const canUse = has('section:templates.manage')
  const [mode, setMode] = useState<'word' | 'excel'>('word')
  const [templates, setTemplates] = useState<DocTemplate[]>([])
  const [uploading, setUploading] = useState(false)
  const [templateName, setTemplateName] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [selectedId, setSelectedId] = useState<string>('')
  const [values, setValues] = useState<Record<string, string>>({})

  async function loadTemplates() {
    const res = await fetch('/api/list-templates')
    const d = await res.json()
    if (res.ok) setTemplates(d.templates || [])
  }
  useEffect(() => {
    loadTemplates()
    // Live — a template someone else just uploaded shows up here without a
    // refresh; an open fill-in form (`values` below) is separate state.
    const t = setInterval(loadTemplates, 20000)
    return () => clearInterval(t)
  }, [])

  const selected = templates.find(t => t.id === selectedId) || null
  useEffect(() => { setValues({}) }, [selectedId])

  async function handleUpload() {
    setError('')
    if (!file) { setError('Choose a .docx file first'); return }
    setUploading(true)
    try {
      const base64 = await fileToBase64(file)
      let driveUrl = ''
      try {
        const dr = await fetch('/api/upload-to-drive', {
          method: 'POST', headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
          body: JSON.stringify({ base64, fileName: file.name, mimeType: file.type, docType: 'template' }),
        })
        const dd = await dr.json()
        if (dr.ok && dd.driveLink) driveUrl = dd.driveLink
      } catch {}

      const res = await fetch('/api/upload-template', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ base64, fileName: file.name, name: templateName || file.name, driveUrl }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Upload failed')
      setStatus(`✓ Template saved — ${d.template.placeholders.length} placeholder(s) detected`)
      setFile(null); setTemplateName('')
      await loadTemplates()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setUploading(false)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this template?')) return
    await fetch(`/api/list-templates?id=${id}`, { method: 'DELETE' })
    if (selectedId === id) setSelectedId('')
    await loadTemplates()
  }

  async function generatePdf() {
    if (!selected) return
    const { jsPDF } = await import('jspdf')
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    const M = 15
    let y = M
    const filled = selected.raw_text.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => values[key] ?? '')

    doc.setFont('helvetica', 'normal').setFontSize(10)
    for (const paragraph of filled.split('\n')) {
      const lines = doc.splitTextToSize(paragraph || ' ', 210 - M * 2)
      for (const line of lines) {
        if (y > 280) { doc.addPage(); y = M }
        doc.text(line, M, y)
        y += 5.5
      }
    }
    doc.save(`${selected.name.replace(/[^\w.-]+/g, '_')}.pdf`)
  }

  const [generatingWord, setGeneratingWord] = useState(false)
  async function generateWord() {
    if (!selected) return
    setError(''); setGeneratingWord(true)
    try {
      const res = await fetch('/api/generate-template-docx', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ template_id: selected.id, values }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Generate failed')
      const bytes = Uint8Array.from(atob(d.base64), c => c.charCodeAt(0))
      const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = d.fileName
      a.click()
      URL.revokeObjectURL(url)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setGeneratingWord(false)
    }
  }

  if (!canUse) return <div className="p-6 text-gray-400 text-sm">You don't have access to this page.</div>

  return (
    <div className="p-6">
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><FileStack size={20} className="text-[#3b82f6]"/>Templates</h1>
        <p className="text-gray-500 text-sm mt-0.5">Word {'{{tag}}'} templates, or Excel templates with cell-level data mapping</p>
      </div>

      <div className="flex gap-1 mb-5 bg-gray-100 p-1 rounded-xl w-fit">
        <button onClick={() => setMode('word')} className={`px-4 py-2 rounded-lg text-sm font-medium ${mode === 'word' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>Word ({'{{tags}}'})</button>
        <button onClick={() => setMode('excel')} className={`px-4 py-2 rounded-lg text-sm font-medium ${mode === 'excel' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>Excel (Cell Mapping)</button>
      </div>

      {mode === 'excel' ? <ExcelTemplatesContent/> : (
        <>
          {error && <div className="mb-4 flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3"><AlertTriangle size={16}/>{error}</div>}
          {status && <p className="text-sm text-green-600 mb-4">{status}</p>}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="card">
              <h2 className="font-semibold text-gray-900 text-sm mb-3">Upload Template</h2>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Template Name</label>
                  <input value={templateName} onChange={e => setTemplateName(e.target.value)} placeholder="e.g. Certificate of Origin" className="input"/>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">.docx File</label>
                  <input type="file" accept=".docx" onChange={e => setFile(e.target.files?.[0] || null)} className="text-sm"/>
                </div>
                <button onClick={handleUpload} disabled={uploading} className="btn-primary flex items-center gap-2">
                  {uploading ? <Loader size={14} className="animate-spin"/> : <Upload size={14}/>}Upload Template
                </button>
              </div>

              <h2 className="font-semibold text-gray-900 text-sm mt-6 mb-3">Saved Templates</h2>
              <div className="space-y-1 max-h-64 overflow-y-auto">
                {templates.map(t => (
                  <div key={t.id} onClick={() => setSelectedId(t.id)}
                    className={`flex items-center justify-between p-2.5 rounded-lg border text-xs cursor-pointer ${selectedId === t.id ? 'bg-blue-50 border-blue-300' : 'border-gray-100 hover:bg-gray-50'}`}>
                    <div>
                      <p className="font-medium text-gray-800">{t.name}</p>
                      <p className="text-gray-400">{t.placeholders.length} tag{t.placeholders.length === 1 ? '' : 's'}</p>
                    </div>
                    <button onClick={e => { e.stopPropagation(); handleDelete(t.id) }} className="text-gray-300 hover:text-red-500"><Trash2 size={14}/></button>
                  </div>
                ))}
                {templates.length === 0 && <p className="text-xs text-gray-400 text-center py-6">No templates uploaded yet</p>}
              </div>
            </div>

            <div className="card">
              <h2 className="font-semibold text-gray-900 text-sm mb-3">Fill & Generate</h2>
              {!selected ? (
                <p className="text-xs text-gray-400 text-center py-12">Select a template to fill in its tags</p>
              ) : selected.placeholders.length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-12">No {'{{tags}}'} were detected in this template</p>
              ) : (
                <>
                  <div className="space-y-3 mb-4">
                    {selected.placeholders.map(p => (
                      <div key={p}>
                        <label className="block text-xs font-medium text-gray-600 mb-1">{'{{' + p + '}}'}</label>
                        <input value={values[p] || ''} onChange={e => setValues(v => ({ ...v, [p]: e.target.value }))} className="input"/>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={generatePdf} className="btn-primary flex items-center gap-2">
                      <FileDown size={14}/>Generate PDF
                    </button>
                    <button onClick={generateWord} disabled={generatingWord} className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50" style={{ background: '#2563eb' }}>
                      {generatingWord ? <Loader size={14} className="animate-spin"/> : <FileDown size={14}/>}Generate Word
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ── Google Sheets Templates: link a Sheet, map cells, generate PDFs ──────
interface TemplateType { id: string; key: string; label: string; is_auto_capable: boolean }
interface MappingEntry { key: string; label: string; source: 'cusdec' | 'cdn' | 'manual'; dbColumn?: string; isArray: boolean; cellRef?: string; cellRange?: string; colRange?: string; rowRange?: string; sheetName?: string }
interface PrintConfig { sheetName: string; range: string; landscape: boolean; scale: 1|2|3|4; paperSize: string; askAtGenerateTime: boolean }

// Parse "A10:A25" → { col: 'A', rows: '10:25' }; "A10:D25" → { col: 'A:D', rows: '10:25' }
function parseCellRange(range: string): { col: string; rows: string } {
  const m = (range || '').replace(/\s/g, '').match(/^([A-Za-z]+)(\d+):([A-Za-z]+)(\d+)$/)
  if (!m) return { col: '', rows: '' }
  const sc = m[1].toUpperCase(), ec = m[3].toUpperCase()
  return { col: sc === ec ? sc : `${sc}:${ec}`, rows: `${m[2]}:${m[4]}` }
}
// Build "A10:A25" from col="A", rows="10:25"; supports col range "A:D" → "A10:D25"
function buildCellRange(col: string, rows: string): string {
  const c = col.trim().toUpperCase()
  const r = rows.trim().split(':')
  if (!c || r.length !== 2 || !r[0] || !r[1]) return ''
  const parts = c.split(':')
  const sc = parts[0], ec = parts.length > 1 ? parts[1] : parts[0]
  return `${sc}${r[0]}:${ec}${r[1]}`
}
interface ExcelTemplate {
  id: string; type_key: string; name: string; file_name?: string | null
  drive_url?: string | null; sheet_url?: string | null
  mapping: MappingEntry[]; print_range?: string | null; print_config?: PrintConfig | null
}
interface CusdecRec { id: string; code: string; number: string; exporter: string; cap: string }
interface SheetInfo { title: string; sheetId: number }

const defaultPrintConfig: PrintConfig = { sheetName: '', range: '', landscape: true, scale: 4, paperSize: 'A4', askAtGenerateTime: false }

function ExcelTemplatesContent() {
  const [types, setTypes] = useState<TemplateType[]>([])
  const [typeKey, setTypeKey] = useState('')
  const [addingType, setAddingType] = useState(false)
  const [newTypeLabel, setNewTypeLabel] = useState('')

  const [templates, setTemplates] = useState<ExcelTemplate[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [name, setName] = useState('')
  const [sheetUrlInput, setSheetUrlInput] = useState('')   // URL paste field for new template
  const [savingNew, setSavingNew] = useState(false)
  const [confirmPrompt, setConfirmPrompt] = useState<{ name: string; sheetUrl: string } | null>(null)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')

  const [mapping, setMapping] = useState<MappingEntry[]>([])
  const [printConfig, setPrintConfig] = useState<PrintConfig>(defaultPrintConfig)
  const [savingMapping, setSavingMapping] = useState(false)

  const [cusdecs, setCusdecs] = useState<CusdecRec[]>([])
  const [genCusdecId, setGenCusdecId] = useState('')
  const [manualValues, setManualValues] = useState<Record<string, string>>({})
  const [generating, setGenerating] = useState(false)
  const [autoModal, setAutoModal] = useState(false)
  // "Ask at generate time" modal state
  const [askModal, setAskModal] = useState(false)
  const [askSheet, setAskSheet] = useState('')
  const [askRange, setAskRange] = useState('')

  const [sheetsList, setSheetsList] = useState<SheetInfo[]>([])
  const [sheetsLoading, setSheetsLoading] = useState(false)
  const sheetNames = sheetsList.map(s => s.title)
  const [columnsByTable, setColumnsByTable] = useState<{ cusdec: string[]; cdn: string[] }>({ cusdec: [], cdn: [] })

  async function loadTypes() {
    const res = await fetch('/api/template-types')
    const d = await res.json()
    if (res.ok) {
      setTypes(d.types || [])
      if (!typeKey && d.types?.length) setTypeKey(d.types[0].key)
    }
  }
  useEffect(() => { loadTypes() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function loadTemplates() {
    if (!typeKey) return
    const res = await fetch(`/api/document-templates?type_key=${typeKey}`, { headers: await authHeader() })
    const d = await res.json()
    if (res.ok) setTemplates(d.templates || [])
  }
  useEffect(() => { loadTemplates(); setSelectedId('') }, [typeKey]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetch('/api/list-records?table=cusdec&limit=500').then(r => r.json()).then(d => setCusdecs(d.records || [])).catch(() => {})
  }, [])

  useEffect(() => {
    async function loadCols() {
      const headers = await authHeader()
      const [cusdecRes, cdnRes] = await Promise.all([
        fetch('/api/table-columns?table=cusdec', { headers }).then(r => r.json()).catch(() => ({ columns: [] })),
        fetch('/api/table-columns?table=cdn', { headers }).then(r => r.json()).catch(() => ({ columns: [] })),
      ])
      setColumnsByTable({ cusdec: cusdecRes.columns || [], cdn: cdnRes.columns || [] })
    }
    loadCols()
  }, [])

  // Load sheets list for the selected template (from its Google Sheets URL).
  useEffect(() => {
    if (!selectedId) { setSheetsList([]); return }
    let cancelled = false
    setSheetsLoading(true)
    authHeader().then(headers =>
      fetch(`/api/excel-template-sheets?template_id=${selectedId}`, { headers })
        .then(r => r.json())
        .then(d => { if (!cancelled) setSheetsList(d.sheets || []) })
        .catch(() => { if (!cancelled) setSheetsList([]) })
        .finally(() => { if (!cancelled) setSheetsLoading(false) })
    )
    return () => { cancelled = true }
  }, [selectedId])

  // Load sheets when a URL is typed/pasted in the new-template form.
  async function fetchSheetsForUrl(url: string) {
    if (!url.includes('spreadsheets')) { setSheetsList([]); return }
    setSheetsLoading(true)
    try {
      const headers = await authHeader()
      const res = await fetch(`/api/excel-template-sheets?sheet_url=${encodeURIComponent(url)}`, { headers })
      const d = await res.json()
      setSheetsList(d.sheets || [])
    } catch { setSheetsList([]) }
    finally { setSheetsLoading(false) }
  }

  const selected = templates.find(t => t.id === selectedId) || null
  const selectedType = types.find(t => t.key === typeKey) || null

  useEffect(() => {
    const raw = selected?.mapping || []
    setMapping(raw.map(m => {
      if (m.isArray && m.cellRange && !m.colRange && !m.rowRange) {
        const p = parseCellRange(m.cellRange)
        return { ...m, colRange: p.col, rowRange: p.rows }
      }
      return m
    }))
    setPrintConfig(selected?.print_config || defaultPrintConfig)
    setManualValues({})
    setSheetUrlInput('')
  }, [selectedId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function addType() {
    if (!newTypeLabel.trim()) return
    const res = await fetch('/api/template-types', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: newTypeLabel, label: newTypeLabel }),
    })
    const d = await res.json()
    if (res.ok) { setNewTypeLabel(''); setAddingType(false); await loadTypes(); setTypeKey(d.type.key) }
  }

  async function saveNewTemplate(confirmUpdate: boolean) {
    setSavingNew(true); setError('')
    try {
      const url = sheetUrlInput.trim()
      if (!url) throw new Error('Paste a Google Sheets URL first')
      const res = await fetch('/api/document-templates', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ type_key: typeKey, name: name.trim(), sheet_url: url, mapping: [], confirmUpdate }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Save failed')
      if (d.needsConfirm) { setConfirmPrompt({ name: d.name, sheetUrl: url }); return }
      setStatus(`✓ Template "${d.template.name}" ${d.updated ? 'updated' : 'saved'}`)
      setName(''); setSheetUrlInput(''); setConfirmPrompt(null)
      await loadTemplates()
      if (d.template?.id) setSelectedId(d.template.id)
    } catch (e: any) { setError(e.message) }
    finally { setSavingNew(false) }
  }

  async function handleDeleteTemplate(id: string) {
    if (!confirm('Delete this template?')) return
    await fetch(`/api/document-templates?id=${id}`, { method: 'DELETE', headers: await authHeader() })
    if (selectedId === id) setSelectedId('')
    await loadTemplates()
  }

  function addMappingRow() {
    setMapping(prev => [...prev, { key: `field_${prev.length + 1}`, label: '', source: 'manual', isArray: false, cellRef: '' }])
  }
  function updateMappingRow(i: number, patch: Partial<MappingEntry>) {
    setMapping(prev => prev.map((m, idx) => idx === i ? { ...m, ...patch } : m))
  }
  function removeMappingRow(i: number) {
    setMapping(prev => prev.filter((_, idx) => idx !== i))
  }

  async function saveMapping() {
    if (!selected) return
    setSavingMapping(true)
    try {
      const finalMapping = mapping.map(m => {
        if (m.isArray && (m.colRange || m.rowRange)) {
          if (!m.colRange || !m.rowRange) throw new Error(`Field "${m.label || m.key}": fill both Column and Rows`)
          const cellRange = buildCellRange(m.colRange, m.rowRange)
          if (!cellRange) throw new Error(`Field "${m.label || m.key}": Rows must be like 10:25`)
          return { ...m, cellRange }
        }
        return m
      })
      const res = await fetch('/api/document-templates', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ id: selected.id, type_key: selected.type_key, name: selected.name, mapping: finalMapping, print_config: printConfig }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      setStatus('✓ Mapping & print config saved')
      await loadTemplates()
    } catch (e: any) { setError(e.message) }
    finally { setSavingMapping(false) }
  }

  async function generate(opts: { cusdecId?: string; printSheet?: string; printRange?: string } = {}) {
    if (!selected) return
    setGenerating(true); setError('')
    try {
      const res = await fetch('/api/generate-from-template', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({
          template_id: selected.id,
          cusdec_id: opts.cusdecId || genCusdecId || undefined,
          manual_values: manualValues,
          print_sheet: opts.printSheet,
          print_range: opts.printRange,
        }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      const bytes = Uint8Array.from(atob(d.base64), c => c.charCodeAt(0))
      const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'application/pdf' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url; a.download = d.fileName; a.click()
      URL.revokeObjectURL(url)
      setStatus('✓ PDF generated')
    } catch (e: any) { setError(e.message) }
    finally { setGenerating(false) }
  }

  function openAskModal() {
    setAskSheet(sheetNames[0] || '')
    setAskRange(printConfig.range || '')
    setAskModal(true)
  }

  const capCompleteCusdecs = cusdecs.filter(c => c.cap && String(c.cap).trim())
  const manualFields = mapping.filter(m => m.source === 'manual')
  const needsCusdec = mapping.some(m => m.source === 'cusdec' || m.source === 'cdn')

  return (
    <div className="space-y-5">
      {error && <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3"><AlertTriangle size={16}/>{error}</div>}
      {status && <p className="text-sm text-green-600">{status}</p>}

      <div className="card">
        <div className="flex items-center gap-3 flex-wrap">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Template Type</label>
            <select value={typeKey} onChange={e => setTypeKey(e.target.value)} className="input">
              {types.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
          </div>
          {!addingType ? (
            <button onClick={() => setAddingType(true)} className="mt-5 flex items-center gap-1 text-xs text-blue-600 hover:underline"><Plus size={13}/>Add new template type</button>
          ) : (
            <div className="mt-5 flex items-center gap-2">
              <input value={newTypeLabel} onChange={e => setNewTypeLabel(e.target.value)} placeholder="e.g. Delivery Order" className="input"/>
              <button onClick={addType} className="btn-primary text-xs px-3 py-2">Add</button>
              <button onClick={() => setAddingType(false)} className="text-gray-400"><X size={16}/></button>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Left: Add template + Template list */}
        <div className="card">
          <h2 className="font-semibold text-gray-900 text-sm mb-3">Add / Update Template</h2>
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Google Sheets URL</label>
              <div className="flex gap-2">
                <input
                  value={sheetUrlInput}
                  onChange={e => { setSheetUrlInput(e.target.value); fetchSheetsForUrl(e.target.value) }}
                  placeholder="https://docs.google.com/spreadsheets/d/..."
                  className="input flex-1 text-xs font-mono"
                />
                {sheetsLoading && !selectedId && <Loader size={14} className="animate-spin text-blue-500 mt-2.5 flex-shrink-0"/>}
              </div>
              {sheetsList.length > 0 && !selectedId && (
                <p className="text-[11px] text-green-600 mt-1">{sheetsList.length} sheet{sheetsList.length === 1 ? '' : 's'} found: {sheetsList.map(s => s.title).join(', ')}</p>
              )}
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Template Name (optional)</label>
              <input value={name} onChange={e => setName(e.target.value)} placeholder={selectedType?.label || 'e.g. Boat Note'} className="input"/>
            </div>
            <button onClick={() => saveNewTemplate(false)} disabled={savingNew} className="btn-primary flex items-center gap-2">
              {savingNew ? <Loader size={14} className="animate-spin"/> : <Link2 size={14}/>}Save Template
            </button>
          </div>

          <h2 className="font-semibold text-gray-900 text-sm mt-6 mb-3">Saved Templates ({selectedType?.label})</h2>
          <div className="space-y-1 max-h-56 overflow-y-auto">
            {templates.map(t => (
              <div key={t.id} onClick={() => setSelectedId(t.id)}
                className={`flex items-center justify-between p-2.5 rounded-lg border text-xs cursor-pointer ${selectedId === t.id ? 'bg-blue-50 border-blue-300' : 'border-gray-100 hover:bg-gray-50'}`}>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-gray-800 truncate">{t.name}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <p className="text-gray-400">{t.mapping?.length || 0} field{(t.mapping?.length || 0) === 1 ? '' : 's'} mapped</p>
                    {(t.sheet_url || t.drive_url) && (
                      <a href={(t.sheet_url || t.drive_url)!} target="_blank" rel="noreferrer"
                        onClick={e => e.stopPropagation()}
                        className="flex items-center gap-0.5 text-blue-500 hover:underline">
                        <Link2 size={10}/>Sheet
                      </a>
                    )}
                  </div>
                </div>
                <button onClick={e => { e.stopPropagation(); handleDeleteTemplate(t.id) }} className="text-gray-300 hover:text-red-500 ml-2 flex-shrink-0"><Trash2 size={14}/></button>
              </div>
            ))}
            {templates.length === 0 && <p className="text-xs text-gray-400 text-center py-6">No templates for this type yet</p>}
          </div>
        </div>

        {/* Right: Cell mapping + print config + generate */}
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-900 text-sm flex items-center gap-2"><Settings size={15}/>Cell Mapping</h2>
            <div className="flex items-center gap-2">
              {sheetsLoading && selectedId && <Loader size={12} className="animate-spin text-gray-400"/>}
              {selected && !sheetsLoading && (
                <button onClick={() => { if (selected) { setSheetsLoading(true); authHeader().then(h => fetch(`/api/excel-template-sheets?template_id=${selected.id}`,{headers:h}).then(r=>r.json()).then(d=>setSheetsList(d.sheets||[])).catch(()=>setSheetsList([])).finally(()=>setSheetsLoading(false))) } }} className="text-[11px] text-blue-500 hover:underline">
                  {sheetNames.length > 0 ? `${sheetNames.length} sheets` : 'Reload sheets'}
                </button>
              )}
            </div>
          </div>
          {!selected ? (
            <p className="text-xs text-gray-400 text-center py-12">Select a template to map its cells</p>
          ) : (
            <>
              <div className="space-y-2 max-h-72 overflow-y-auto mb-3">
                {mapping.map((m, i) => (
                  <div key={i} className="border border-gray-100 rounded-lg p-2.5 space-y-1.5">
                    <div className="flex items-center gap-1.5">
                      <input value={m.label} onChange={e => updateMappingRow(i, { label: e.target.value })} placeholder="Field label" className="input text-xs flex-1"/>
                      <button onClick={() => removeMappingRow(i)} className="text-gray-300 hover:text-red-500 flex-shrink-0"><X size={14}/></button>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <select value={m.source} onChange={e => updateMappingRow(i, { source: e.target.value as MappingEntry['source'], isArray: e.target.value !== 'cdn' ? false : m.isArray, dbColumn: undefined })} className="input text-xs">
                        <option value="manual">Manual Input</option>
                        <option value="cusdec">CUSDEC field (1 value)</option>
                        <option value="cdn">CDN per-container (array)</option>
                      </select>
                      {m.source !== 'manual' && (
                        <select value={m.dbColumn || ''} onChange={e => updateMappingRow(i, { dbColumn: e.target.value })} className="input text-xs flex-1">
                          <option value="">Pick column...</option>
                          {columnsByTable[m.source].map(col => <option key={col} value={col}>{col}</option>)}
                        </select>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 text-[11px] text-gray-500">
                      <span className="flex-shrink-0">Sheet:</span>
                      {sheetNames.length > 0 ? (
                        <select value={m.sheetName || sheetNames[0]} onChange={e => updateMappingRow(i, { sheetName: e.target.value })} className="input text-xs flex-1">
                          {sheetNames.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      ) : (
                        <input value={m.sheetName || ''} onChange={e => updateMappingRow(i, { sheetName: e.target.value })} placeholder="Sheet name (e.g. Data)" className="input text-xs flex-1 font-mono"/>
                      )}
                    </div>
                    {m.source === 'cdn' && (
                      <label className="flex items-center gap-1.5 text-[11px] text-gray-500">
                        <input type="checkbox" checked={m.isArray} onChange={e => updateMappingRow(i, { isArray: e.target.checked })}/>
                        Repeat per container (fill one row per CDN)
                      </label>
                    )}
                    {m.source === 'cdn' && m.isArray && !m.dbColumn && (
                      <p className="text-[10px] text-amber-600 bg-amber-50 rounded px-2 py-1">⚠ Pick a CDN column above — without it nothing fills</p>
                    )}
                    {m.isArray ? (
                      <div className="space-y-1">
                        <div className="flex gap-1.5">
                          <div className="flex-1">
                            <label className="block text-[10px] text-gray-400 mb-0.5">Column(s)</label>
                            <input
                              value={m.colRange || ''}
                              onChange={e => updateMappingRow(i, { colRange: e.target.value.toUpperCase() })}
                              placeholder="e.g. A"
                              className="input text-xs font-mono"
                            />
                          </div>
                          <div className="flex-1">
                            <label className="block text-[10px] text-gray-400 mb-0.5">Rows</label>
                            <input
                              value={m.rowRange || ''}
                              onChange={e => updateMappingRow(i, { rowRange: e.target.value })}
                              placeholder="e.g. 10:25"
                              className="input text-xs font-mono"
                            />
                          </div>
                        </div>
                        {m.colRange && m.rowRange && buildCellRange(m.colRange, m.rowRange) && (
                          <p className="text-[10px] text-indigo-500 font-mono">→ {buildCellRange(m.colRange, m.rowRange)}</p>
                        )}
                      </div>
                    ) : (
                      <input value={m.cellRef || ''} onChange={e => updateMappingRow(i, { cellRef: e.target.value })} placeholder="Cell e.g. B5" className="input text-xs font-mono"/>
                    )}
                  </div>
                ))}
              </div>

              {/* Print Config */}
              <div className="border border-dashed border-gray-200 rounded-lg p-2.5 mb-3 space-y-2">
                <label className="block text-[11px] font-medium text-gray-600">PDF Print Config</label>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] text-gray-500 mb-0.5">Print Sheet</label>
                    <select value={printConfig.sheetName} onChange={e => setPrintConfig(p => ({ ...p, sheetName: e.target.value }))} className="input text-xs">
                      <option value="">— First sheet —</option>
                      {sheetNames.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] text-gray-500 mb-0.5">Cell Range</label>
                    <input
                      value={printConfig.range}
                      onChange={e => setPrintConfig(p => ({ ...p, range: e.target.value }))}
                      placeholder="e.g. A1:Z80"
                      className="input text-xs font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-gray-500 mb-0.5">Scale</label>
                    <select value={printConfig.scale} onChange={e => setPrintConfig(p => ({ ...p, scale: Number(e.target.value) as 1|2|3|4 }))} className="input text-xs">
                      <option value={1}>Normal (100%)</option>
                      <option value={2}>Fit Width</option>
                      <option value={3}>Fit Height</option>
                      <option value={4}>Fit to Page</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] text-gray-500 mb-0.5">Paper</label>
                    <select value={printConfig.paperSize} onChange={e => setPrintConfig(p => ({ ...p, paperSize: e.target.value }))} className="input text-xs">
                      <option value="A4">A4</option>
                      <option value="Letter">Letter</option>
                      <option value="A3">A3</option>
                      <option value="Legal">Legal</option>
                    </select>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-1.5 text-[11px] text-gray-500 cursor-pointer">
                    <input type="checkbox" checked={printConfig.landscape} onChange={e => setPrintConfig(p => ({ ...p, landscape: e.target.checked }))}/>
                    Landscape
                  </label>
                  <label className="flex items-center gap-1.5 text-[11px] text-gray-500 cursor-pointer">
                    <input type="checkbox" checked={printConfig.askAtGenerateTime} onChange={e => setPrintConfig(p => ({ ...p, askAtGenerateTime: e.target.checked }))}/>
                    Ask sheet/range at generate time
                  </label>
                </div>
              </div>

              <div className="flex items-center gap-2 mb-4">
                <button onClick={addMappingRow} className="flex items-center gap-1 text-xs text-blue-600 hover:underline"><Plus size={13}/>Add Field</button>
                <button onClick={saveMapping} disabled={savingMapping} className="btn-primary text-xs px-3 py-1.5 flex items-center gap-1.5">
                  {savingMapping ? <Loader size={12} className="animate-spin"/> : <Save size={12}/>}Save Mapping
                </button>
              </div>

              {/* Generate */}
              <div className="border-t border-gray-100 pt-3">
                <h3 className="font-semibold text-gray-800 text-xs mb-2">Generate PDF</h3>
                {needsCusdec && (
                  <div className="mb-2">
                    <label className="block text-xs font-medium text-gray-600 mb-1">CUSDEC</label>
                    <select value={genCusdecId} onChange={e => setGenCusdecId(e.target.value)} className="input text-xs">
                      <option value="">Select...</option>
                      {cusdecs.map(c => <option key={c.id} value={c.id}>E {c.number} — {c.exporter?.slice(0, 30)}</option>)}
                    </select>
                  </div>
                )}
                {manualFields.map(f => (
                  <div key={f.key} className="mb-2">
                    <label className="block text-xs font-medium text-gray-600 mb-1">{f.label || f.key}</label>
                    <input value={manualValues[f.key] || ''} onChange={e => setManualValues(v => ({ ...v, [f.key]: e.target.value }))} className="input text-xs"/>
                  </div>
                ))}
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  {printConfig.askAtGenerateTime ? (
                    <button onClick={openAskModal} disabled={generating} className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg text-white disabled:opacity-50" style={{ background: '#dc2626' }}>
                      {generating ? <Loader size={12} className="animate-spin"/> : <FileDown size={12}/>}Generate PDF…
                    </button>
                  ) : (
                    <button onClick={() => generate()} disabled={generating} className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg text-white disabled:opacity-50" style={{ background: '#dc2626' }}>
                      {generating ? <Loader size={12} className="animate-spin"/> : <FileDown size={12}/>}Generate PDF
                    </button>
                  )}
                  {selectedType?.is_auto_capable && (
                    <button onClick={() => setAutoModal(true)} className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg text-white" style={{ background: '#8b5cf6' }}>
                      <Zap size={12}/>Auto
                    </button>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Confirm duplicate name modal */}
      {confirmPrompt && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm p-5">
            <h3 className="font-semibold text-gray-900 mb-2">Template &quot;{confirmPrompt.name}&quot; already exists</h3>
            <p className="text-xs text-gray-500 mb-4">Update it with this Google Sheet URL instead of saving a duplicate?</p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmPrompt(null)} className="btn-secondary flex-1">Cancel</button>
              <button onClick={() => saveNewTemplate(true)} className="btn-primary flex-1">Update</button>
            </div>
          </div>
        </div>
      )}

      {/* Ask at generate time modal */}
      {askModal && selected && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm p-5">
            <h3 className="font-semibold text-gray-900 mb-3">PDF Print Options</h3>
            <div className="space-y-3">
              {sheetNames.length > 1 && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Sheet to Print</label>
                  <select value={askSheet} onChange={e => setAskSheet(e.target.value)} className="input text-xs">
                    {sheetNames.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Cell Range (optional)</label>
                <input value={askRange} onChange={e => setAskRange(e.target.value)} placeholder="e.g. A1:Z80" className="input text-xs font-mono"/>
              </div>
            </div>
            <div className="flex gap-3 mt-4">
              <button onClick={() => setAskModal(false)} className="btn-secondary flex-1">Cancel</button>
              <button
                onClick={() => { setAskModal(false); generate({ printSheet: askSheet || undefined, printRange: askRange || undefined }) }}
                disabled={generating}
                className="flex items-center justify-center gap-1.5 flex-1 text-xs py-2 rounded-lg text-white disabled:opacity-50"
                style={{ background: '#dc2626' }}
              >
                {generating ? <Loader size={12} className="animate-spin"/> : <FileDown size={12}/>}Generate PDF
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Auto modal */}
      {autoModal && selected && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md max-h-[80vh] flex flex-col">
            <div className="p-5 border-b">
              <h3 className="font-semibold text-gray-900">Auto — pick a CAP-complete CUSDEC</h3>
              <p className="text-xs text-gray-500 mt-1">Pulls the CUSDEC&apos;s data, fills each mapped array field down its cell range — once per CDN container, in order.</p>
            </div>
            <div className="p-5 overflow-y-auto flex-1 space-y-1.5">
              {capCompleteCusdecs.map(c => (
                <button key={c.id} onClick={() => { setAutoModal(false); generate({ cusdecId: c.id }) }}
                  className="w-full text-left border border-gray-100 rounded-lg p-2.5 text-xs hover:bg-gray-50">
                  <p className="font-medium text-gray-800">E {c.number} · CAP {c.cap}</p>
                  <p className="text-gray-400 truncate">{c.exporter}</p>
                </button>
              ))}
              {capCompleteCusdecs.length === 0 && <p className="text-xs text-gray-400 text-center py-8">No CAP-complete CUSDECs found</p>}
            </div>
            <div className="p-5 border-t">
              <button onClick={() => setAutoModal(false)} className="w-full py-2 rounded-lg text-sm text-gray-500 hover:bg-gray-100">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function TemplatesPage() {
  return <TemplatesContent/>
}
TemplatesPage.getLayout = (page: React.ReactElement) => <AdminLayout>{page}</AdminLayout>
