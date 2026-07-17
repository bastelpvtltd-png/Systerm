import { useEffect, useRef, useState } from 'react'
import AdminLayout, { usePermission } from '@/components/admin/AdminLayout'
import { authHeader } from '@/lib/supabase'
import { FileStack, Trash2, FileDown, AlertTriangle, Loader, Plus, X, Save, Upload } from 'lucide-react'

// ── Word {{tag}} templates ────────────────────────────────────────────────
interface WordTemplate { id: string; name: string; file_name: string; drive_url: string | null; raw_text: string; placeholders: string[]; created_at: string }

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve((reader.result as string).split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function WordTemplatesContent() {
  const [templates, setTemplates] = useState<WordTemplate[]>([])
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
    } catch (e: any) { setError(e.message) }
    finally { setUploading(false) }
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
    const M = 15; let y = M
    const filled = selected.raw_text.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => values[key] ?? '')
    doc.setFont('helvetica', 'normal').setFontSize(10)
    for (const paragraph of filled.split('\n')) {
      const lines = doc.splitTextToSize(paragraph || ' ', 210 - M * 2)
      for (const line of lines) {
        if (y > 280) { doc.addPage(); y = M }
        doc.text(line, M, y); y += 5.5
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
      const a = document.createElement('a'); a.href = url; a.download = d.fileName; a.click()
      URL.revokeObjectURL(url)
    } catch (e: any) { setError(e.message) }
    finally { setGeneratingWord(false) }
  }

  return (
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
                  <p className="text-gray-400">{t.placeholders?.length ?? 0} tag{(t.placeholders?.length ?? 0) === 1 ? '' : 's'}</p>
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
            <p className="text-xs text-gray-400 text-center py-12">No {'{{'+'tags'+'}}'} were detected in this template</p>
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
                <button onClick={generatePdf} className="btn-primary flex items-center gap-2"><FileDown size={14}/>Generate PDF</button>
                <button onClick={generateWord} disabled={generatingWord} className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50" style={{ background: '#2563eb' }}>
                  {generatingWord ? <Loader size={14} className="animate-spin"/> : <FileDown size={14}/>}Generate Word
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  )
}

// ── Google Sheets Templates — fixed doc types, relational mappings ─────────
interface TemplateMapping {
  id?: string; field_label: string; data_source: 'cusdec' | 'cdn' | 'manual'
  column_name: string; is_repeating: boolean; target_cell_or_range: string
  sheet_name: string
}
interface GSheet {
  id: string; document_type: string; template_url: string
  print_sheet_name: string | null; print_range: string | null
  paper_size: string; orientation: string; fit_to_page: boolean
  template_mappings: TemplateMapping[]
  template_format?: 'google_sheet' | 'xml' | 'text'
  template_content?: string | null
}

const TEMPLATE_FORMATS = [
  { value: 'google_sheet', label: 'Google Sheet' },
  { value: 'xml',          label: 'XML' },
  { value: 'text',         label: 'Text Template' },
] as const
type TemplateFormat = typeof TEMPLATE_FORMATS[number]['value']

const DOC_TYPES = [
  { value: 'boat_note',    label: 'Boat Note' },
  { value: 'invoice',      label: 'Invoice' },
  { value: 'packing_list', label: 'Packing List' },
  { value: 'co',           label: 'CO (Certificate of Origin)' },
  { value: 'pytho',        label: 'Phyto (Phytosanitary)' },
]

// Slug used as the document_type value (DB column + /api/doc-generate key) —
// the label shown everywhere else (this dropdown, the Docs Create tab) is
// derived from it via titleCaseSlug() below, since doc_templates has no
// separate display-name column.
function slugifyDocType(label: string): string {
  return label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}
export function titleCaseSlug(slug: string): string {
  return slug.split('_').filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(' ')
}

const emptyRow = (): TemplateMapping => ({
  field_label: '', data_source: 'cusdec', column_name: '',
  is_repeating: false, target_cell_or_range: '', sheet_name: '',
})

// Known columns per table — loaded from /api/table-columns
const CUSDEC_FALLBACK = ['code','number','date','exporter','consignee','vessel','voyage_no','bl_no','gross_mass','net_mass','cap','hs_code','amount','invoice_number','boat_note_link']
const CDN_FALLBACK    = ['code','cusdec_number','shipper','consignee','container_no','goods_description','vessel','voyage','bl_no','slpa_no','lorry_no','cdn_no']

function DocTemplatesContent() {
  const [docType, setDocType]         = useState('boat_note')
  const [templateFormat, setTemplateFormat] = useState<TemplateFormat>('google_sheet')
  const [templateContent, setTemplateContent] = useState('')
  const [templateUrl, setTemplateUrl] = useState('')
  const [urlInput, setUrlInput]       = useState('')
  const [mappings, setMappings]       = useState<TemplateMapping[]>([emptyRow()])
  const [printSheet, setPrintSheet]   = useState('')
  const [printRange, setPrintRange]   = useState('')
  const [paperSize, setPaperSize]     = useState('A4')
  const [orientation, setOrientation] = useState('Portrait')
  const [fitToPage, setFitToPage]     = useState(true)
  const [saving, setSaving]           = useState(false)
  const [error, setError]             = useState('')
  const [status, setStatus]           = useState('')
  const [columnsBySource, setColumnsBySource] = useState<{ cusdec: string[]; cdn: string[] }>({ cusdec: CUSDEC_FALLBACK, cdn: CDN_FALLBACK })
  const [sheetNames, setSheetNames]   = useState<string[]>([])
  const [sheetsLoading, setSheetsLoading] = useState(false)
  const [sheetsWarn, setSheetsWarn]   = useState('')
  const lastFetchedUrl = useRef('')  // avoid double-fetch when loadTemplate sets urlInput
  const [extraDocTypes, setExtraDocTypes] = useState<{ value: string; label: string }[]>([])
  const [addingNewType, setAddingNewType] = useState(false)
  const [newTypeLabel, setNewTypeLabel]   = useState('')
  const allDocTypes = [...DOC_TYPES, ...extraDocTypes.filter(e => !DOC_TYPES.some(d => d.value === e.value))]

  // Load cusdec/cdn columns once
  useEffect(() => {
    async function loadCols() {
      const h = await authHeader()
      const [cr, dr] = await Promise.all([
        fetch('/api/table-columns?table=cusdec', { headers: h }).then(r => r.json()).catch(() => ({ columns: CUSDEC_FALLBACK })),
        fetch('/api/table-columns?table=cdn',    { headers: h }).then(r => r.json()).catch(() => ({ columns: CDN_FALLBACK })),
      ])
      setColumnsBySource({ cusdec: cr.columns?.length ? cr.columns : CUSDEC_FALLBACK, cdn: dr.columns?.length ? dr.columns : CDN_FALLBACK })
    }
    loadCols()
  }, [])

  // Custom document types created previously (anything already saved that
  // isn't one of the 5 built-in ones) — so re-opening this page still shows
  // them in the dropdown instead of only being reachable right after creation.
  useEffect(() => {
    async function loadExtraTypes() {
      const h = await authHeader()
      const res = await fetch('/api/doc-templates', { headers: h })
      if (!res.ok) return
      const d = await res.json()
      const known = new Set(DOC_TYPES.map(t => t.value))
      const extras = ((d.templates || []) as GSheet[])
        .map(t => t.document_type)
        .filter(v => v && !known.has(v))
        .filter((v, i, arr) => arr.indexOf(v) === i)
        .map(v => ({ value: v, label: titleCaseSlug(v) }))
      setExtraDocTypes(extras)
    }
    loadExtraTypes()
  }, [])

  function confirmNewType() {
    const slug = slugifyDocType(newTypeLabel)
    if (!slug) return
    setExtraDocTypes(prev => prev.some(e => e.value === slug) ? prev : [...prev, { value: slug, label: newTypeLabel.trim() }])
    setDocType(slug)
    setAddingNewType(false)
    setNewTypeLabel('')
  }

  useEffect(() => { loadTemplate() }, [docType]) // eslint-disable-line react-hooks/exhaustive-deps

  async function loadTemplate() {
    setError(''); setStatus('')
    const h = await authHeader()
    const res = await fetch('/api/doc-templates', { headers: h })
    if (!res.ok) return
    const d = await res.json()
    const found: GSheet | null = (d.templates || []).find((t: GSheet) => t.document_type === docType) || null
    const url = found?.template_url || ''
    const format = found?.template_format || 'google_sheet'
    setTemplateFormat(format)
    setTemplateContent(found?.template_content || '')
    setTemplateUrl(url)
    setUrlInput(url)
    setMappings(found?.template_mappings?.length ? found.template_mappings.map(m => ({ ...m, sheet_name: m.sheet_name || '' })) : [emptyRow()])
    setPrintSheet(found?.print_sheet_name || '')
    setPrintRange(found?.print_range || '')
    setPaperSize(found?.paper_size || 'A4')
    setOrientation(found?.orientation || 'Portrait')
    setFitToPage(found?.fit_to_page !== false)
    if (format === 'google_sheet' && url) fetchSheets(url)
    else setSheetNames([])
  }

  async function fetchSheets(url: string) {
    if (!url.includes('spreadsheets')) { setSheetNames([]); return }
    lastFetchedUrl.current = url
    setTemplateUrl(url)
    setSheetsWarn('')
    setSheetsLoading(true)
    try {
      const h = await authHeader()
      const res = await fetch('/api/excel-template-sheets?sheet_url=' + encodeURIComponent(url), { headers: h })
      const d = await res.json()
      const names = (d.sheets || []).map((s: { title: string }) => s.title)
      if (names.length) {
        setSheetNames(names)
      } else {
        setSheetNames([])
        setSheetsWarn(d.error ? `Sheet auto-load failed: ${d.error}` : 'No sheets found — enter sheet names manually')
      }
    } catch {
      setSheetNames([])
      setSheetsWarn('Could not connect to Google Sheets — enter sheet names manually below')
    }
    finally { setSheetsLoading(false) }
  }

  // Auto-fetch sheets when URL is pasted or typed (700ms debounce)
  useEffect(() => {
    const url = urlInput.trim()
    if (!url || !url.includes('spreadsheets')) {
      if (url && url !== templateUrl) { setTemplateUrl(url); lastFetchedUrl.current = url }
      if (!url) { setSheetNames([]); setSheetsWarn('') }
      return
    }
    if (url === lastFetchedUrl.current) return
    const timer = setTimeout(() => fetchSheets(url), 700)
    return () => clearTimeout(timer)
  }, [urlInput]) // eslint-disable-line react-hooks/exhaustive-deps

  function updateRow(i: number, patch: Partial<TemplateMapping>) {
    setMappings(prev => prev.map((m, idx) => idx === i ? { ...m, ...patch } : m))
  }

  async function save() {
    setSaving(true); setError('')
    try {
      const h = await authHeader()
      let body: Record<string, unknown>

      if (templateFormat === 'google_sheet') {
        const url = templateUrl.trim() || urlInput.trim()
        if (!url) throw new Error('Google Sheets URL required — paste the spreadsheet URL above')
        const valid = mappings.filter(m => m.field_label && (m.data_source === 'manual' || m.column_name) && m.target_cell_or_range)
        for (const m of valid) {
          if (m.is_repeating && !m.target_cell_or_range.includes(':'))
            throw new Error(`"${m.field_label}" is repeating — cell range required (e.g. A10:A25)`)
        }
        body = {
          document_type: docType, template_format: templateFormat, template_url: url, template_content: null,
          print_sheet_name: printSheet || null, print_range: printRange || null,
          paper_size: paperSize, orientation, fit_to_page: fitToPage,
          mappings: valid,
        }
      } else {
        // XML / Text — no spreadsheet, no cell/range: the raw {{field_label}}
        // template body is typed directly here and stored as-is.
        if (!templateContent.trim()) throw new Error('Template content required — type the {{field_label}} template above')
        const valid = mappings.filter(m => m.field_label && (m.data_source === 'manual' || m.column_name))
        body = {
          document_type: docType, template_format: templateFormat, template_url: null, template_content: templateContent,
          print_sheet_name: null, print_range: null, paper_size: 'A4', orientation: 'Portrait', fit_to_page: true,
          mappings: valid.map(m => ({ ...m, target_cell_or_range: '', sheet_name: '' })),
        }
      }

      const res = await fetch('/api/doc-templates', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...h },
        body: JSON.stringify(body),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      setStatus('✓ Template saved')
      await loadTemplate()
    } catch (e: any) { setError(e.message) }
    finally { setSaving(false) }
  }

  const cols = (src: 'cusdec' | 'cdn') => columnsBySource[src] || []

  return (
    <div className="space-y-5">
      {error && <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3"><AlertTriangle size={16}/><span>{error}</span></div>}
      {status && <p className="text-sm text-green-600">{status}</p>}

      {/* Step 1 — Doc type + URL */}
      <div className="card">
        <h2 className="font-semibold text-gray-900 text-sm mb-3 flex items-center gap-2">
          <span className="w-5 h-5 bg-blue-600 text-white rounded-full text-[11px] flex items-center justify-center font-bold">1</span>
          Document Config
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Document Type</label>
            {addingNewType ? (
              <div className="flex gap-1.5">
                <input value={newTypeLabel} onChange={e => setNewTypeLabel(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') confirmNewType(); if (e.key === 'Escape') setAddingNewType(false) }}
                  placeholder="e.g. Delivery Note" autoFocus
                  className="input flex-1 text-xs"/>
                <button onClick={confirmNewType} disabled={!newTypeLabel.trim()}
                  className="px-2.5 rounded-lg text-xs font-medium text-white disabled:opacity-40" style={{ background: '#22A87A' }}>
                  <Save size={13}/>
                </button>
                <button onClick={() => { setAddingNewType(false); setNewTypeLabel('') }}
                  className="px-2.5 rounded-lg text-xs text-gray-400 hover:text-red-500 border border-gray-200"><X size={13}/></button>
              </div>
            ) : (
              <select value={docType} onChange={e => {
                if (e.target.value === '__new__') { setAddingNewType(true); return }
                setDocType(e.target.value)
              }} className="input">
                {allDocTypes.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                <option value="__new__">+ Add New Document Type</option>
              </select>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Template Format</label>
            <select value={templateFormat} onChange={e => setTemplateFormat(e.target.value as TemplateFormat)} className="input">
              {TEMPLATE_FORMATS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
          </div>
        </div>

        {templateFormat === 'google_sheet' ? (
          <div className="mt-3">
            <label className="block text-xs font-medium text-gray-600 mb-1">Google Sheets URL</label>
            <div className="relative">
              <input value={urlInput} onChange={e => setUrlInput(e.target.value)}
                placeholder="https://docs.google.com/spreadsheets/d/..."
                className="input w-full text-xs font-mono pr-8"/>
              {sheetsLoading && (
                <Loader size={12} className="animate-spin absolute right-2.5 top-1/2 -translate-y-1/2 text-blue-500 pointer-events-none"/>
              )}
            </div>
            {sheetNames.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {sheetNames.map(s => (
                  <span key={s} className="text-[11px] bg-green-50 text-green-700 border border-green-200 rounded px-1.5 py-0.5 font-medium">{s}</span>
                ))}
              </div>
            )}
            {sheetsWarn && sheetNames.length === 0 && (
              <p className="text-[11px] text-amber-600 mt-1.5 flex items-center gap-1 flex-wrap">
                <AlertTriangle size={11}/>{sheetsWarn}
                {sheetsWarn.toLowerCase().includes('unauthorized') && (
                  <a href="/admin/google-reauth" className="underline text-blue-600 ml-1">Re-authorize Google →</a>
                )}
              </p>
            )}
            {templateUrl && sheetNames.length === 0 && !sheetsWarn && !sheetsLoading && (
              <p className="text-[11px] text-green-600 mt-1">✓ URL accepted — sheet names can be typed manually below</p>
            )}
          </div>
        ) : (
          <div className="mt-3">
            <label className="block text-xs font-medium text-gray-600 mb-1">
              {templateFormat === 'xml' ? 'XML Template' : 'Text Template'}
              <span className="text-gray-400 font-normal"> — type the raw {templateFormat === 'xml' ? 'XML' : 'text'} with {'{{field_label}}'} tags where a mapped field should be filled in</span>
            </label>
            <textarea value={templateContent} onChange={e => setTemplateContent(e.target.value)} rows={10}
              placeholder={templateFormat === 'xml'
                ? '<Declaration>\n  <Number>{{Reference No}}</Number>\n  <Exporter>{{Exporter}}</Exporter>\n</Declaration>'
                : 'CDN No: {{CDN No}}\nContainer: {{Container No}}\nGross Mass: {{Gross Mass}}'}
              className="w-full font-mono text-xs border border-gray-200 rounded-lg p-3"/>
          </div>
        )}
      </div>

      {/* Step 2 — Field Mappings */}
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-gray-900 text-sm flex items-center gap-2">
            <span className="w-5 h-5 bg-blue-600 text-white rounded-full text-[11px] flex items-center justify-center font-bold">2</span>
            Field Mappings
          </h2>
          <button onClick={() => setMappings(p => [...p, emptyRow()])} className="flex items-center gap-1 text-xs text-blue-600 hover:underline">
            <Plus size={13}/>Add Row
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[700px]">
            <thead>
              <tr className="border-b border-gray-100 text-left text-gray-500">
                <th className="pb-2 font-medium pr-2 w-28">Field Label</th>
                <th className="pb-2 font-medium pr-2 w-20">Source</th>
                <th className="pb-2 font-medium pr-2 w-36">Column</th>
                <th className="pb-2 font-medium pr-2 w-16 text-center">Repeat</th>
                {templateFormat === 'google_sheet' && <th className="pb-2 font-medium pr-2 w-28">Sheet</th>}
                {templateFormat === 'google_sheet' && <th className="pb-2 font-medium pr-2 w-24">Cell / Range</th>}
                <th className="pb-2 w-6"></th>
              </tr>
            </thead>
            <tbody>
              {mappings.map((m, i) => (
                <tr key={i} className="border-b border-gray-50">
                  <td className="py-1.5 pr-2">
                    <input value={m.field_label} onChange={e => updateRow(i, { field_label: e.target.value })}
                      placeholder="e.g. Invoice No" className="input text-xs w-full"/>
                  </td>
                  <td className="py-1.5 pr-2">
                    <select value={m.data_source} onChange={e => updateRow(i, { data_source: e.target.value as 'cusdec' | 'cdn' | 'manual', column_name: '' })} className="input text-xs">
                      <option value="cusdec">cusdec</option>
                      <option value="cdn">cdn</option>
                      <option value="manual">manual</option>
                    </select>
                  </td>
                  <td className="py-1.5 pr-2">
                    {m.data_source === 'manual' ? (
                      <span className="text-[11px] text-gray-400 italic">typed at generation time</span>
                    ) : (
                      <select value={m.column_name} onChange={e => updateRow(i, { column_name: e.target.value })} className="input text-xs">
                        <option value="">— pick —</option>
                        {cols(m.data_source).map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    )}
                  </td>
                  <td className="py-1.5 pr-2 text-center">
                    <input type="checkbox" checked={m.is_repeating}
                      onChange={e => updateRow(i, { is_repeating: e.target.checked, target_cell_or_range: '' })}
                      className="cursor-pointer"/>
                  </td>
                  {templateFormat === 'google_sheet' && (
                    <td className="py-1.5 pr-2">
                      {sheetNames.length > 0 ? (
                        <select value={m.sheet_name} onChange={e => updateRow(i, { sheet_name: e.target.value })} className="input text-xs">
                          <option value="">— first sheet —</option>
                          {sheetNames.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      ) : (
                        <input value={m.sheet_name} onChange={e => updateRow(i, { sheet_name: e.target.value })}
                          placeholder="Sheet name" className="input text-xs w-full"/>
                      )}
                    </td>
                  )}
                  {templateFormat === 'google_sheet' && (
                    <td className="py-1.5 pr-2">
                      <input value={m.target_cell_or_range}
                        onChange={e => updateRow(i, { target_cell_or_range: e.target.value.toUpperCase() })}
                        placeholder={m.is_repeating ? 'A10:A25' : 'B5'}
                        className={`input text-xs font-mono w-full ${m.is_repeating && m.target_cell_or_range && !m.target_cell_or_range.includes(':') ? 'border-red-300' : ''}`}/>
                      {m.is_repeating && m.target_cell_or_range && !m.target_cell_or_range.includes(':') && (
                        <p className="text-[10px] text-red-500 mt-0.5">Range needed</p>
                      )}
                    </td>
                  )}
                  <td className="py-1.5">
                    <button onClick={() => setMappings(p => p.filter((_, idx) => idx !== i))} className="text-gray-300 hover:text-red-500"><X size={13}/></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {mappings.length === 0 && <p className="text-xs text-gray-400 text-center py-4">No fields — click Add Row</p>}
        </div>
      </div>

      {/* Step 3 — Print Settings (Google Sheets only — XML/Text have no page layout) */}
      <div className="card">
        {templateFormat === 'google_sheet' && (
          <>
            <h2 className="font-semibold text-gray-900 text-sm mb-3 flex items-center gap-2">
              <span className="w-5 h-5 bg-blue-600 text-white rounded-full text-[11px] flex items-center justify-center font-bold">3</span>
              Print Settings
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Print Tab (sheet)</label>
                {sheetNames.length > 0 ? (
                  <select value={printSheet} onChange={e => setPrintSheet(e.target.value)} className="input text-xs">
                    <option value="">— first sheet —</option>
                    {sheetNames.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                ) : (
                  <input value={printSheet} onChange={e => setPrintSheet(e.target.value)}
                    placeholder="e.g. Print" className="input text-xs font-mono"/>
                )}
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Print Range</label>
                <input value={printRange} onChange={e => setPrintRange(e.target.value)}
                  placeholder="e.g. A1:K50" className="input text-xs font-mono"/>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Paper Size</label>
                <select value={paperSize} onChange={e => setPaperSize(e.target.value)} className="input text-xs">
                  <option>A4</option><option>Letter</option><option>A3</option><option>Legal</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Orientation</label>
                <select value={orientation} onChange={e => setOrientation(e.target.value)} className="input text-xs">
                  <option>Portrait</option><option>Landscape</option>
                </select>
              </div>
            </div>
            <label className="flex items-center gap-2 text-xs text-gray-700 mb-4 cursor-pointer select-none">
              <input type="checkbox" checked={fitToPage} onChange={e => setFitToPage(e.target.checked)} className="cursor-pointer"/>
              <span>Fit to page (shrink content to fit paper — recommended)</span>
            </label>
          </>
        )}
        <button onClick={save} disabled={saving} className="btn-primary flex items-center gap-2">
          {saving ? <Loader size={14} className="animate-spin"/> : <Save size={14}/>}Save Template
        </button>
      </div>
    </div>
  )
}

// ── Page shell ────────────────────────────────────────────────────────────
function TemplatesContent() {
  const { has } = usePermission()
  const canUse = has('section:templates.manage')
  const [mode, setMode] = useState<'word' | 'sheets'>('word')

  if (!canUse) return <div className="p-6 text-gray-400 text-sm">You don&apos;t have access to this page.</div>

  return (
    <div className="p-6">
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><FileStack size={20} className="text-[#3b82f6]"/>Templates</h1>
        <p className="text-gray-500 text-sm mt-0.5">Word {'{{'+'tag'+'}}'} templates · Google Sheet / XML / Text templates</p>
      </div>
      <div className="flex gap-1 mb-5 bg-gray-100 p-1 rounded-xl w-fit">
        <button onClick={() => setMode('word')} className={`px-4 py-2 rounded-lg text-sm font-medium ${mode === 'word' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>Word ({'{{'+'tags'+'}}'})</button>
        <button onClick={() => setMode('sheets')} className={`px-4 py-2 rounded-lg text-sm font-medium ${mode === 'sheets' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>Sheet / XML / Text</button>
      </div>
      {mode === 'sheets' ? <DocTemplatesContent/> : <WordTemplatesContent/>}
    </div>
  )
}

export default function TemplatesPage() {
  return <TemplatesContent/>
}
TemplatesPage.getLayout = (page: React.ReactElement) => <AdminLayout>{page}</AdminLayout>
