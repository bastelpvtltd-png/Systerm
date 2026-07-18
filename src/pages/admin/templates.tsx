import { useEffect, useRef, useState } from 'react'
import AdminLayout, { usePermission } from '@/components/admin/AdminLayout'
import { authHeader } from '@/lib/supabase'
import { FileStack, AlertTriangle, Loader, Plus, X, Save } from 'lucide-react'
import { BUILTIN_DOC_TYPES } from '@/lib/docTypes'

// ── Google Sheets Templates — fixed doc types, relational mappings ─────────
interface TemplateMapping {
  id?: string; field_label: string; data_source: 'cusdec' | 'cdn' | 'manual'
  column_name: string; is_repeating: boolean; target_cell_or_range: string
  sheet_name: string
}
interface SheetRoute { id?: string; route_type: 'fill' | 'print'; sheet_gid: string; sheet_name: string; tin_vat_list: string[] }
interface GSheet {
  id: string; document_type: string; template_url: string
  print_sheet_name: string | null; print_range: string | null
  paper_size: string; orientation: string; fit_to_page: boolean
  template_mappings: TemplateMapping[]
  template_format?: 'google_sheet' | 'xml' | 'text' | 'trico_gate_pass'
  template_content?: string | null
}

const TEMPLATE_FORMATS = [
  { value: 'google_sheet',    label: 'Google Sheet' },
  { value: 'xml',             label: 'XML' },
  { value: 'text',            label: 'Text Template' },
  { value: 'trico_gate_pass', label: 'Trico Gate Pass (web form)' },
] as const
type TemplateFormat = typeof TEMPLATE_FORMATS[number]['value']

const DOC_TYPES = BUILTIN_DOC_TYPES

// Picking these two document types only makes sense with one template
// format each — auto-select it so the mapping UI below (Sheet columns vs.
// the {{tag}} textarea) matches without an extra manual step.
const DOC_TYPE_DEFAULT_FORMAT: Partial<Record<string, TemplateFormat>> = {
  cusdec_xml: 'xml',
  cdn_text: 'text',
}

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

function SheetRouteEditor({ title, routeType, routes, setRoutes, sheets, shippers, onSave, saving }: {
  title: string
  routeType: 'fill' | 'print'
  routes: SheetRoute[]
  setRoutes: (fn: (prev: SheetRoute[]) => SheetRoute[]) => void
  sheets: { title: string; sheetId: number }[]
  shippers: { tin_vat: string; exporter: string }[]
  onSave: () => void
  saving: boolean
}) {
  const [newSheetGid, setNewSheetGid] = useState('')
  const [pickerOpenIdx, setPickerOpenIdx] = useState<number | null>(null)
  const [shipperSearch, setShipperSearch] = useState('')

  function addRoute() {
    if (!newSheetGid) return
    const sheet = sheets.find(s => String(s.sheetId) === newSheetGid)
    if (!sheet || routes.some(r => r.sheet_gid === newSheetGid)) return
    setRoutes(prev => [...prev, { route_type: routeType, sheet_gid: newSheetGid, sheet_name: sheet.title, tin_vat_list: [] }])
    setNewSheetGid('')
  }
  function toggleShipper(routeIdx: number, tinVat: string) {
    setRoutes(prev => prev.map((r, i) => i !== routeIdx ? r : {
      ...r, tin_vat_list: r.tin_vat_list.includes(tinVat) ? r.tin_vat_list.filter(t => t !== tinVat) : [...r.tin_vat_list, tinVat],
    }))
  }
  function removeRoute(idx: number) { setRoutes(prev => prev.filter((_, i) => i !== idx)) }
  const assignedElsewhere = (excludeIdx: number) => new Set(routes.flatMap((r, i) => i === excludeIdx ? [] : r.tin_vat_list))

  return (
    <div className="border border-gray-100 rounded-lg p-3">
      <h3 className="text-xs font-semibold text-gray-700 mb-2">{title}</h3>
      <div className="space-y-2 mb-3">
        {routes.map((r, idx) => {
          const takenElsewhere = assignedElsewhere(idx)
          // Always show the sheet's CURRENT title (looked up live by gid,
          // the same stable-ID resolution generation itself uses) — not the
          // name cached in the DB from whenever this route was first saved,
          // which goes stale the moment the tab is renamed in Google Sheets.
          const liveName = sheets.find(s => String(s.sheetId) === r.sheet_gid)?.title || r.sheet_name
          return (
            <div key={r.sheet_gid} className="border border-gray-100 rounded-lg p-2">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-medium text-gray-800">{liveName}</span>
                <button onClick={() => removeRoute(idx)} className="text-gray-300 hover:text-red-500"><X size={13}/></button>
              </div>
              <button onClick={() => setPickerOpenIdx(pickerOpenIdx === idx ? null : idx)} className="text-[11px] text-blue-600 hover:underline mb-1.5">
                {pickerOpenIdx === idx ? 'Hide shippers' : `${r.tin_vat_list.length} shipper(s) — edit`}
              </button>
              {pickerOpenIdx === idx && (
                <div className="max-h-40 overflow-y-auto border-t border-gray-50 pt-1.5 space-y-1">
                  <input value={shipperSearch} onChange={e => setShipperSearch(e.target.value)} placeholder="Search shipper..." className="input text-xs w-full mb-1"/>
                  {shippers.filter(s => !shipperSearch || s.exporter.toLowerCase().includes(shipperSearch.toLowerCase()) || s.tin_vat.includes(shipperSearch)).map(s => (
                    <label key={s.tin_vat} className={`flex items-center gap-2 text-[11px] px-1 py-0.5 rounded ${takenElsewhere.has(s.tin_vat) ? 'opacity-40' : 'cursor-pointer hover:bg-gray-50'}`}>
                      <input type="checkbox" checked={r.tin_vat_list.includes(s.tin_vat)} disabled={takenElsewhere.has(s.tin_vat)}
                        onChange={() => toggleShipper(idx, s.tin_vat)}/>
                      <span className="truncate">{s.exporter.slice(0, 28) || '(no name)'} <span className="text-gray-400">· {s.tin_vat}</span></span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )
        })}
        {routes.length === 0 && <p className="text-[11px] text-gray-400">No routes — using the default sheet for everyone.</p>}
      </div>
      <div className="flex gap-1.5 mb-2">
        <select value={newSheetGid} onChange={e => setNewSheetGid(e.target.value)} className="input text-xs flex-1">
          <option value="">— pick a sheet to add —</option>
          {sheets.filter(s => !routes.some(r => r.sheet_gid === String(s.sheetId))).map(s => (
            <option key={s.sheetId} value={s.sheetId}>{s.title}</option>
          ))}
        </select>
        <button onClick={addRoute} disabled={!newSheetGid} className="px-2.5 rounded-lg text-xs font-medium text-white disabled:opacity-40" style={{ background: '#3b82f6' }}>
          <Plus size={13}/>
        </button>
      </div>
      <button onClick={onSave} disabled={saving} className="btn-secondary w-full flex items-center justify-center gap-2 text-xs">
        {saving ? <Loader size={13} className="animate-spin"/> : <Save size={13}/>}Save
      </button>
    </div>
  )
}

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
  const [sheetsWithGid, setSheetsWithGid] = useState<{ title: string; sheetId: number }[]>([])
  const [sheetsLoading, setSheetsLoading] = useState(false)
  const [sheetsWarn, setSheetsWarn]   = useState('')
  const lastFetchedUrl = useRef('')  // avoid double-fetch when loadTemplate sets urlInput
  const [extraDocTypes, setExtraDocTypes] = useState<{ value: string; label: string }[]>([])
  const [addingNewType, setAddingNewType] = useState(false)
  const [newTypeLabel, setNewTypeLabel]   = useState('')
  const allDocTypes = [...DOC_TYPES, ...extraDocTypes.filter(e => !DOC_TYPES.some(d => d.value === e.value))]

  // Per-shipper (TIN VAT) Sheet Routing — see template-sheet-routes.ts.
  const [templateId, setTemplateId] = useState('')
  const [fillRoutes, setFillRoutes] = useState<SheetRoute[]>([])
  const [printRoutes, setPrintRoutes] = useState<SheetRoute[]>([])
  const [shipperOptions, setShipperOptions] = useState<{ tin_vat: string; exporter: string }[]>([])
  const [routesSaving, setRoutesSaving] = useState<'fill' | 'print' | ''>('')
  const [routesStatus, setRoutesStatus] = useState('')

  useEffect(() => {
    fetch('/api/list-records?table=cusdec&limit=1000').then(r => r.json()).then(d => {
      const seen = new Set<string>()
      const opts: { tin_vat: string; exporter: string }[] = []
      for (const c of (d.records || [])) {
        if (!c.tin_vat || seen.has(c.tin_vat)) continue
        seen.add(c.tin_vat)
        opts.push({ tin_vat: c.tin_vat, exporter: c.exporter || '' })
      }
      setShipperOptions(opts)
    }).catch(() => {})
  }, [])

  async function loadRoutes(tplId: string) {
    if (!tplId) { setFillRoutes([]); setPrintRoutes([]); return }
    try {
      const h = await authHeader()
      const res = await fetch(`/api/template-sheet-routes?template_id=${tplId}`, { headers: h })
      const d = await res.json()
      const routes: SheetRoute[] = d.routes || []
      setFillRoutes(routes.filter(r => r.route_type === 'fill'))
      setPrintRoutes(routes.filter(r => r.route_type === 'print'))
    } catch { setFillRoutes([]); setPrintRoutes([]) }
  }

  async function saveRoutes(routeType: 'fill' | 'print') {
    if (!templateId) { setRoutesStatus('Save the template first (needs a Google Sheets URL) before configuring routing.'); return }
    setRoutesSaving(routeType); setRoutesStatus('')
    try {
      const list = routeType === 'fill' ? fillRoutes : printRoutes
      const h = await authHeader()
      const res = await fetch('/api/template-sheet-routes', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...h },
        body: JSON.stringify({ template_id: templateId, route_type: routeType, routes: list }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      setRoutesStatus(`✓ ${routeType === 'fill' ? 'Fill' : 'Print'} Sheet routing saved`)
    } catch (e: any) { setRoutesStatus(`✗ ${e.message}`) }
    finally { setRoutesSaving('') }
  }

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
    const format = found?.template_format || DOC_TYPE_DEFAULT_FORMAT[docType] || 'google_sheet'
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
    setTemplateId(found?.id || '')
    setRoutesStatus('')
    loadRoutes(found?.id || '')
    if (format === 'google_sheet' && url) fetchSheets(url)
    else { setSheetNames([]); setSheetsWithGid([]) }
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
      const sheets: { title: string; sheetId: number }[] = d.sheets || []
      const names = sheets.map(s => s.title)
      if (names.length) {
        setSheetNames(names)
        setSheetsWithGid(sheets)
      } else {
        setSheetNames([])
        setSheetsWithGid([])
        setSheetsWarn(d.error ? `Sheet auto-load failed: ${d.error}` : 'No sheets found — enter sheet names manually')
      }
    } catch {
      setSheetNames([])
      setSheetsWithGid([])
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
      } else if (templateFormat === 'trico_gate_pass') {
        const url = templateUrl.trim() || urlInput.trim()
        if (!url) throw new Error('After-login URL required')
        const valid = mappings.filter(m => m.field_label && (m.data_source === 'manual' || m.column_name) && m.target_cell_or_range)
        body = {
          document_type: docType, template_format: templateFormat, template_url: url, template_content: null,
          print_sheet_name: null, print_range: null, paper_size: 'A4', orientation: 'Portrait', fit_to_page: true,
          mappings: valid.map(m => ({ ...m, sheet_name: '' })),
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
        ) : templateFormat === 'trico_gate_pass' ? (
          <div className="mt-3">
            <label className="block text-xs font-medium text-gray-600 mb-1">
              After-Login URL
              <span className="text-gray-400 font-normal"> — the gate pass form's URL on Trico, reached after signing in with the credential picked at generation time</span>
            </label>
            <input value={urlInput} onChange={e => setUrlInput(e.target.value)}
              placeholder="https://s2.tricologi.net/webuser/?option=gatepass&action=gatepass_exp"
              className="input w-full text-xs font-mono"/>
            <p className="text-[11px] text-gray-400 mt-1.5">No Fill/Print sheet here — map each field below to the exact form field name on that page (Column = "Form Field Name").</p>
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
                {templateFormat === 'google_sheet' && <th className="pb-2 font-medium pr-2 w-24">Cell / Range</th>}
                {templateFormat === 'trico_gate_pass' && <th className="pb-2 font-medium pr-2 w-32">Form Field Name</th>}
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
                      <input value={m.target_cell_or_range}
                        onChange={e => updateRow(i, { target_cell_or_range: e.target.value.toUpperCase() })}
                        placeholder={m.is_repeating ? 'A10:A25' : 'B5'}
                        className={`input text-xs font-mono w-full ${m.is_repeating && m.target_cell_or_range && !m.target_cell_or_range.includes(':') ? 'border-red-300' : ''}`}/>
                      {m.is_repeating && m.target_cell_or_range && !m.target_cell_or_range.includes(':') && (
                        <p className="text-[10px] text-red-500 mt-0.5">Range needed</p>
                      )}
                    </td>
                  )}
                  {templateFormat === 'trico_gate_pass' && (
                    <td className="py-1.5 pr-2">
                      <input value={m.target_cell_or_range}
                        onChange={e => updateRow(i, { target_cell_or_range: e.target.value })}
                        placeholder="e.g. container_no"
                        className="input text-xs font-mono w-full"/>
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

      {/* Sheet Routing — optional, Google Sheets only. Different shippers'
          data can fill (and print) on different physical tabs of the same
          spreadsheet, matched by TIN VAT at generation time. */}
      {templateFormat === 'google_sheet' && sheetsWithGid.length > 0 && (
        <div className="card">
          <h2 className="font-semibold text-gray-900 text-sm mb-1">Sheet Routing <span className="text-gray-400 font-normal">(optional)</span></h2>
          <p className="text-xs text-gray-400 mb-3">Route different shippers' CUSDECs to different sheet tabs — pick a sheet, then tick which shippers (by TIN VAT) use it. A CUSDEC with no matching route falls back to the spreadsheet's first sheet.</p>
          {routesStatus && <p className={`text-xs mb-3 font-medium ${routesStatus.startsWith('✓') ? 'text-green-600' : 'text-red-600'}`}>{routesStatus}</p>}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <SheetRouteEditor
              title="Fill Sheet routing" routeType="fill" routes={fillRoutes} setRoutes={setFillRoutes}
              sheets={sheetsWithGid} shippers={shipperOptions}
              onSave={() => saveRoutes('fill')} saving={routesSaving === 'fill'}
            />
            <SheetRouteEditor
              title="Print Sheet routing" routeType="print" routes={printRoutes} setRoutes={setPrintRoutes}
              sheets={sheetsWithGid} shippers={shipperOptions}
              onSave={() => saveRoutes('print')} saving={routesSaving === 'print'}
            />
          </div>
        </div>
      )}

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

  if (!canUse) return <div className="p-6 text-gray-400 text-sm">You don&apos;t have access to this page.</div>

  return (
    <div className="p-6">
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><FileStack size={20} className="text-[#3b82f6]"/>Templates</h1>
        <p className="text-gray-500 text-sm mt-0.5">Google Sheet / XML / Text templates</p>
      </div>
      <DocTemplatesContent/>
    </div>
  )
}

export default function TemplatesPage() {
  return <TemplatesContent/>
}
TemplatesPage.getLayout = (page: React.ReactElement) => <AdminLayout>{page}</AdminLayout>
