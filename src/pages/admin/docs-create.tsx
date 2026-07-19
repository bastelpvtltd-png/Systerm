import { useState, useEffect, useRef } from 'react'
import AdminLayout, { usePermission } from '@/components/admin/AdminLayout'
import { authHeader } from '@/lib/supabase'
import { Anchor, Loader, RefreshCw, CheckSquare, Square, FileDown, Mail, FileStack, Receipt, Package, Plus, X, Clock, ClipboardCheck, Search, FileCode, ScanText, Copy, Save, Download, AlertTriangle, CheckCircle, Send, Trash2 } from 'lucide-react'
import SendModal, { type SendResultFile } from '@/components/admin/SendModal'
import SheetPickerModal from '@/components/admin/SheetPickerModal'
import EmailPdfModal from '@/components/admin/EmailPdfModal'
import { emptyXmlValues, buildAsycudaXml, XML_FIELD_DEFS, defaultXmlMappings, type XmlValues, type XmlMappingRow } from '@/lib/asycudaXml'
import { ALWAYS_TAB_TYPES, DEDICATED_TAB_TYPES } from '@/lib/docTypes'

// Custom document types (from Templates → "+ Add New Document Type") get a
// dynamically-added tab id of the form `custom:${document_type}` — string
// keeps that open-ended rather than a fixed union.
type DocsCreateTab = 'invoice' | 'packing-list' | 'boat-note' | 'done-boat-note' | 'cusdec-xml' | 'cdn-text' | 'parties-copy' | string

// A document_type slug typed on Templates ("Party's Copy" → "party_s_copy",
// "Parties Copy" → "parties_copy", etc.) should attach to the existing
// Party's Copy tab rather than spawn a duplicate custom tab — matched by
// normalized substring rather than an exact slug since the exact wording
// typed into "+ Add New Document Type" can vary.
function isPartiesCopySlug(slug: string): boolean {
  const norm = slug.toLowerCase().replace(/[^a-z0-9]/g, '')
  return norm.includes('party') && norm.includes('copy')
}

interface CusdecRec { id: string; code?: string; number: string; exporter: string; consignee: string; vessel: string; voyage_no: string; bl_no: string; gross_mass: string; net_mass: string; discharge_port: string; location_of_goods: string; created_at: string; cap?: string; export_release_passed?: boolean; boat_note_url?: string; declarant_code?: string }
// No consignee column on cdn — the buyer's name/address only lives on the
// matched CUSDEC row (see CdnTextPanel.selectCdn).
interface CdnRec    { id: string; code?: string; cdn_no: string; container_no: string; driver_name: string; cusdec_number: string; goods_description: string; gross_mass: string; vessel: string; voyage: string; voyage_date: string; bl_no: string; slpa_no: string; voc: string; coc: string; lorry_no: string; trailer_no: string; loading_port: string; discharge_port: string; location: string; pkg_no: string; pkg_type: string; volume: string; seal_no: string; con_type: string; marks: string; boat_note_passed?: boolean; shipper?: string }

interface BoatNote { shipper: string; consignee: string; entry_no: string; bl_no: string; slpa_no: string; voyage: string; voyage_date: string; vessel: string; terminal: string; lorry_no: string; trailer_no: string; driver_name: string; container_no: string; con_type: string; seal_no: string; goods: string; gross_mass: string; net_mass: string; cdn_no: string; pkg_no: string; pkg_type: string; voc: string; coc: string; loading_port: string; discharge_port: string; volume: string; marks: string }

// Invoice + Packing List share one form — both PDFs pull from the same
// state so nothing has to be typed twice. Fields not listed per-item
// (Terms of Delivery, Payment Type, Bank Details, ...) live at the top level;
// Item Description and Payment Type are repeatable (spec explicitly calls
// for "more than one" of each).
function Field({ label, edited, children }: { label: string; edited?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">
        {label}
        {edited && <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 align-middle">Edited</span>}
      </label>
      {children}
    </div>
  )
}

// Company constants from Excel b2 sheet
const COMPANY = {
  name:       'PRIYANTHI AGENCY',
  declarant:  'H A B P KUMRA',
  ca_no:      '706266609',
  tel:        '',
}

// getLayout (see _app.tsx) keeps AdminLayout mounted across navigations
// instead of remounting the sidebar on every tab click.
export default function BoatNotePage() {
  return <BoatNoteContent/>
}
BoatNotePage.getLayout = (page: React.ReactElement) => <AdminLayout>{page}</AdminLayout>

const emptyBoatNote = (): BoatNote => ({
  shipper: '', consignee: '', entry_no: '', bl_no: '', slpa_no: '', voyage: '', voyage_date: '',
  vessel: '', terminal: '', lorry_no: '', trailer_no: '', driver_name: '', container_no: '',
  con_type: '', seal_no: '', goods: '', gross_mass: '', net_mass: '', cdn_no: '', pkg_no: '',
  pkg_type: '', voc: '', coc: '', loading_port: '', discharge_port: '', volume: '', marks: '',
})

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve((reader.result as string).split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function BoatNoteContent() {
  const { has, isAdmin } = usePermission()
  const canSelectCusdec = has('section:boat-note.select-cusdec')
  const canSelectCdn = has('section:boat-note.select-cdn')
  const canOutput = has('section:boat-note.output')
  const canInvoice = has('section:boat-note.invoice')
  const canPackingList = has('section:boat-note.packing-list')
  const canBoatNote = canSelectCusdec || canSelectCdn || canOutput
  const canDoneBoatNote = has('section:boat-note.done')
  const canCusdecXml  = has('section:boat-note.cusdec-xml')
  const canCdnText    = has('section:boat-note.cdn-text')
  const canPartiesCopy = has('section:boat-note.parties-copy')

  // Custom document types created via Templates → "+ Add New Document
  // Type" (anything not one of the built-in tabs below) get their own
  // dynamically-added tab, gated on the same permission as the rest of
  // this page since there's no dedicated permission key for them yet.
  const [customDocTypes, setCustomDocTypes] = useState<{ value: string; label: string; format?: string }[]>(ALWAYS_TAB_TYPES)
  useEffect(() => {
    async function loadCustomTypes() {
      try {
        const h = await authHeader()
        const res = await fetch('/api/doc-templates', { headers: h })
        if (!res.ok) return
        const d = await res.json()
        const extras = ((d.templates || []) as any[])
          .filter(t => t.document_type && !DEDICATED_TAB_TYPES.has(t.document_type) && !isPartiesCopySlug(t.document_type))
          .filter((t, i, arr) => arr.findIndex(x => x.document_type === t.document_type) === i)
          .filter(t => !ALWAYS_TAB_TYPES.some(x => x.value === t.document_type))
          .map(t => ({ value: t.document_type as string, label: (t.document_type as string).split('_').filter(Boolean).map((w: string) => w[0].toUpperCase() + w.slice(1)).join(' '), format: t.template_format }))
        // ALWAYS_TAB_TYPES (CO, Phyto) show up as tabs even before a
        // template's been saved for them — merge the dynamically-discovered
        // extras in alongside, not replacing them.
        setCustomDocTypes([...ALWAYS_TAB_TYPES, ...extras])
      } catch {}
    }
    loadCustomTypes()
  }, [])

  const subTabs = ([
    ['invoice',       Receipt,       'Invoice',       canInvoice],
    ['packing-list',  Package,       'Packing List',  canPackingList],
    ['boat-note',     Anchor,        'Boat Note',     canBoatNote],
    ['cusdec-xml',    FileCode,      'Cusdec XML',    canCusdecXml],
    ['cdn-text',      ScanText,      'CDN Text',      canCdnText],
    ['parties-copy',  Copy,          "Party's Copy",  canPartiesCopy],
    ...customDocTypes.map(d => [`custom:${d.value}`, FileStack, d.label, canBoatNote] as const),
  ] as const).filter(([, , , can]) => can)
  const [subTab, setSubTab] = useState<DocsCreateTab>(subTabs[0]?.[0] || 'boat-note')
  const [cusdecs, setCusdecs]   = useState<CusdecRec[]>([])
  const [cdns, setCdns]         = useState<CdnRec[]>([])
  const [allCdns, setAllCdns]   = useState<CdnRec[]>([])
  const [showCompleted, setShowCompleted] = useState(false)
  const [selCusdec, setSelCusdec] = useState('')
  const [selCdns, setSelCdns]   = useState<string[]>([])
  const [boatNotes, setBoatNotes] = useState<BoatNote[]>([])
  const [cusdecNo, setCusdecNo] = useState('')
  const [loading, setLoading]   = useState(false)
  const [generating, setGen]    = useState(false)
  const [emailTo, setEmailTo]   = useState('bathiyapradeep7788@gmail.com')
  const [sending, setSending]   = useState(false)
  const [status, setStatus]     = useState('')
  const [excelTemplates, setExcelTemplates] = useState<{id: string; name: string}[]>([])
  const [excelTemplateId, setExcelTemplateId] = useState('')
  const [generatingExcel, setGeneratingExcel] = useState(false)
  const [bnPdf, setBnPdf] = useState<{ base64: string; fileName: string } | null>(null)
  const [bnReason, setBnReason] = useState('')
  const [savedBnUrl, setSavedBnUrl] = useState('')
  const [sendModalBnOpen, setSendModalBnOpen] = useState(false)
  const [bnHistoryRefreshKey, setBnHistoryRefreshKey] = useState(0)

  // Shown only when Sheet Routing can't resolve a Fill/Print sheet on its
  // own (no route matches this shipper's TIN VAT, their routed tab was
  // deleted, or — Manual Entry — there's no CUSDEC/TIN VAT to route by at
  // all) — the server hands back the live tab list so the user picks
  // instead of the generate silently landing on the wrong tab.
  const [bnSheets, setBnSheets] = useState<{ title: string; sheetId: number }[]>([])
  const [bnFillSheetGid, setBnFillSheetGid] = useState('')
  const [bnPrintSheetGid, setBnPrintSheetGid] = useState('')
  const [bnSheetPickNeeded, setBnSheetPickNeeded] = useState(false)
  const [bnSheetPickMessage, setBnSheetPickMessage] = useState('')

  // ── Boat Note: Manual Entry sub-tab (no CUSDEC — type the template
  // fields by hand, generate the same Google Sheets template PDF, then
  // download/mail only — nothing gets saved to Drive since there's no
  // CUSDEC record to attach the link to) ─────────────────────────────────
  const [bnEntryMode, setBnEntryMode] = useState<'cusdec' | 'manual'>('cusdec')
  const [bnTplFields, setBnTplFields] = useState<{ field_label: string; is_repeating: boolean }[]>([])
  const [bnTplLoadError, setBnTplLoadError] = useState('')
  const [bnFormValues, setBnFormValues] = useState<Record<string, string[]>>({})
  const [bnManualGenerating, setBnManualGenerating] = useState(false)

  useEffect(() => {
    async function loadBnTemplateFields() {
      setBnTplLoadError('')
      try {
        const h = await authHeader()
        const res = await fetch('/api/doc-templates', { headers: h })
        if (!res.ok) { setBnTplLoadError(`Failed to load template (HTTP ${res.status})`); return }
        const d = await res.json()
        const tpl = (d.templates || []).find((t: any) => t.document_type === 'boat_note')
        if (!tpl) { setBnTplLoadError('No Boat Note template configured — set one up in Templates first'); return }
        const fields = (tpl.template_mappings || []).map((m: any) => ({
          field_label: m.field_label, is_repeating: !!m.is_repeating,
        }))
        setBnTplFields(fields)
        const init: Record<string, string[]> = {}
        fields.forEach((f: { field_label: string }) => { init[f.field_label] = [''] })
        setBnFormValues(init)
      } catch (e: any) {
        setBnTplLoadError(e.message || 'Failed to load template')
      }
    }
    loadBnTemplateFields()
  }, [])

  async function generateManualBn() {
    if (bnSheetPickNeeded && (!bnFillSheetGid || !bnPrintSheetGid)) return
    setBnManualGenerating(true); setStatus(''); setBnPdf(null); setSavedBnUrl(''); setBnReason(''); setBoatNotes([]); setCusdecNo('')
    try {
      const manual: Record<string, string> = {}
      Object.entries(bnFormValues).forEach(([label, rows]) => { manual[label] = rows.join('\n') })
      const h = await authHeader()
      const body: Record<string, unknown> = { document_type: 'boat_note', manual_values: manual }
      if (bnFillSheetGid) body.fill_sheet_gid = bnFillSheetGid
      if (bnPrintSheetGid) body.print_sheet_gid = bnPrintSheetGid
      const res = await fetch('/api/doc-generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...h },
        body: JSON.stringify(body),
      })
      const d = await res.json()
      if (!res.ok) {
        if (d.needsSheetSelection) {
          setBnSheets(d.sheets || [])
          setBnSheetPickNeeded(true)
          setBnSheetPickMessage(d.error)
          setStatus('')
          return
        }
        throw new Error(d.error || 'Generate failed')
      }
      setBnSheetPickNeeded(false)
      setBnPdf({ base64: d.base64, fileName: d.fileName })
      setStatus('✓ PDF ready — download or send below')
    } catch (e: any) { setStatus(`✗ ${e.message}`) }
    finally { setBnManualGenerating(false) }
  }

  // ── Boat Note: Quick Upload (CUSDEC XML + PDF, ephemeral) ─────────────
  // Admin-only per spec. Nothing here ever reaches Supabase/Drive — the
  // XML is parsed in-memory server-side (parse-cusdec-xml.ts) purely to
  // read its field values, and the PDF the user attaches is never sent
  // anywhere at all (kept only for the admin's own reference while filling
  // in the container-level fields the XML doesn't carry). Reload the page
  // and every trace of this is gone, which is the point.
  const [quickXmlFile, setQuickXmlFile] = useState<File | null>(null)
  const [quickPdfFile, setQuickPdfFile] = useState<File | null>(null)
  const [quickFields, setQuickFields] = useState<BoatNote>(emptyBoatNote())
  const [quickParsing, setQuickParsing] = useState(false)
  const [quickGenerating, setQuickGenerating] = useState(false)
  const [quickStatus, setQuickStatus] = useState('')

  function setQuickField<K extends keyof BoatNote>(key: K, value: BoatNote[K]) {
    setQuickFields(f => ({ ...f, [key]: value }))
  }

  async function parseQuickXml() {
    if (!quickXmlFile) return
    setQuickParsing(true); setQuickStatus('')
    try {
      const xmlBase64 = await fileToBase64(quickXmlFile)
      const res = await fetch('/api/parse-cusdec-xml', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ xmlBase64 }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Could not parse this XML')
      setQuickFields(f => ({
        ...f,
        shipper: d.parsed.exporter || f.shipper,
        consignee: d.parsed.consignee || f.consignee,
        entry_no: d.parsed.number ? `E ${d.parsed.number}` : f.entry_no,
        bl_no: d.parsed.bl_no || f.bl_no,
        vessel: d.parsed.vessel || f.vessel,
        gross_mass: d.parsed.gross_mass || f.gross_mass,
        goods: d.parsed.goods_description || f.goods,
      }))
      setQuickStatus('✓ XML parsed — review the fields below, fill in the rest, then Generate')
    } catch (e: any) {
      setQuickStatus(`✗ ${e.message}`)
    } finally {
      setQuickParsing(false)
    }
  }

  async function generateQuickBoatNote() {
    setQuickGenerating(true); setQuickStatus('')
    try {
      const doc = await buildBoatNotePdf([quickFields], quickFields.entry_no || 'QUICK')
      const dt = new Date().toISOString().slice(0, 10)
      doc.save(`BOAT_NOTE_QUICK_${dt}.pdf`)
      setQuickStatus('✓ PDF downloaded — nothing from this form was saved anywhere')
    } catch (e: any) {
      setQuickStatus(`✗ ${e.message}`)
    } finally {
      setQuickGenerating(false)
    }
  }

  function resetQuickUpload() {
    setQuickXmlFile(null); setQuickPdfFile(null); setQuickFields(emptyBoatNote()); setQuickStatus('')
  }

  useEffect(() => {
    authHeader().then(h => fetch('/api/document-templates', { headers: h }))
      .then(r => r.json()).then(d => setExcelTemplates(d.templates || [])).catch(() => {})
  }, [])

  useEffect(() => {
    loadCusdecs()
    // Live — the CUSDEC/CDN lists (and each row's completed/blue/green
    // status) stay current without a refresh; the current selection and any
    // generated boat notes are separate state, untouched by this.
    const t = setInterval(() => loadCusdecs(true), 20000)
    return () => clearInterval(t)
  }, [])
  useEffect(() => { if (selCusdec) loadCdns() }, [selCusdec])

  async function loadCusdecs(silent = false) {
    if (!silent) setLoading(true)
    try {
      const [cr, dr] = await Promise.all([
        fetch('/api/list-records?table=cusdec&limit=200'),
        fetch('/api/list-records?table=cdn&limit=1000'),
      ])
      if (cr.ok) { const d = await cr.json(); setCusdecs(d.records || []) }
      if (dr.ok) { const d = await dr.json(); setAllCdns(d.records || []) }
    } finally { if (!silent) setLoading(false) }
  }

  // A CUSDEC counts as "completed" (hidden by default) once it's Export
  // Released, or every one of its CDN containers has passed Boat Note check —
  // same rule Automation's Export Release panel uses, so the two screens
  // never disagree about what's actually done.
  function isCompleted(c: CusdecRec): boolean {
    if (c.export_release_passed) return true
    const own = allCdns.filter(d => d.code === c.code && d.cusdec_number === c.number)
    if (!own.length) return false
    const cap = parseInt(c.cap || '', 10)
    if (cap && own.length < cap) return false
    return own.every(d => d.boat_note_passed)
  }
  const visibleCusdecs = showCompleted ? cusdecs : cusdecs.filter(c => !isCompleted(c))

  async function loadCdns() {
    const cur = cusdecs.find(c => c.id === selCusdec)
    if (!cur) return
    try {
      const r = await fetch(`/api/list-records?table=cdn&filter=cusdec_number&value=${cur.number}`)
      if (r.ok) { const d = await r.json(); setCdns(d.records || []) }
    } catch {}
  }

  const toggleCdn = (id: string) =>
    setSelCdns(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id])

  async function generate() {
    if (!selCusdec || !selCdns.length) { setStatus('⚠ Select CUSDEC and containers'); return }

    // Pre-flight constraints before calling the expensive generate API
    const cur = cusdecs.find(c => c.id === selCusdec)
    if (cur) {
      const ownCdns = allCdns.filter(d => d.code === cur.code && d.cusdec_number === cur.number)
      const cap = parseInt(cur.cap || '', 10)
      if (cap && ownCdns.length < cap) {
        setStatus(`⛔ Only ${ownCdns.length} CDN(s) loaded but CAP is ${cap} — all containers must be present before generating the Boat Note`)
        return
      }

    }

    setGen(true); setBoatNotes([]); setBnPdf(null); setSavedBnUrl(''); setBnReason(''); setBnSheetPickNeeded(false)
    try {
      const h = await authHeader()
      const r = await fetch('/api/generate-boat-note', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...h },
        body: JSON.stringify({ cusdec_id: selCusdec, cdn_ids: selCdns }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error)
      setBoatNotes(d.boat_notes || [])
      const cusdecNoVal = d.cusdec_no || ''
      setCusdecNo(cusdecNoVal)
      await generateBnPdf(cusdecNoVal, d.boat_notes?.length || 0)
    } catch (e: any) { setStatus(`✗ ${e.message}`) }
    finally { setGen(false) }
  }

  // Split out of generate() so the Fill/Print sheet picker (shown only
  // when Sheet Routing can't resolve a route for this shipper) can retry
  // just the PDF step, without re-running generate-boat-note again.
  async function generateBnPdf(cusdecNoVal: string, containerCount: number) {
    const h = await authHeader()
    const body: Record<string, unknown> = { document_type: 'boat_note', cusdec_id: selCusdec, cdn_ids: selCdns }
    if (bnFillSheetGid) body.fill_sheet_gid = bnFillSheetGid
    if (bnPrintSheetGid) body.print_sheet_gid = bnPrintSheetGid
    const pdfRes = await fetch('/api/doc-generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...h },
      body: JSON.stringify(body),
    })
    const pdfD = await pdfRes.json()
    if (!pdfRes.ok) {
      if (pdfD.needsSheetSelection) {
        setBnSheets(pdfD.sheets || [])
        setBnSheetPickNeeded(true)
        setBnSheetPickMessage(pdfD.error)
        setStatus('')
        return
      }
      throw new Error(pdfD.error || 'Template PDF generate failed')
    }
    setBnSheetPickNeeded(false)
    const cusdecDigits = cusdecNoVal.replace(/[^0-9]/g, '')
    const fileName = `B${cusdecDigits || cusdecNoVal || 'UNKNOWN'}.pdf`
    setBnPdf({ base64: pdfD.base64, fileName })
    setStatus(`✓ ${containerCount} container(s) — PDF ready`)
  }

  async function generateExcelTemplate() {
    if (!excelTemplateId || !selCusdec) return
    setGeneratingExcel(true)
    try {
      const r = await fetch('/api/generate-from-template', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ template_id: excelTemplateId, cusdec_id: selCusdec, format: 'xlsx' }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error)
      const bytes = Uint8Array.from(atob(d.base64), c => c.charCodeAt(0))
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
      const a = document.createElement('a'); a.href = url; a.download = d.fileName; a.click()
      URL.revokeObjectURL(url)
    } catch (e: any) { setStatus(`✗ Excel: ${e.message}`) }
    finally { setGeneratingExcel(false) }
  }

  // Shared by both the CUSDEC-record flow (below) and the Quick Upload
  // (XML+PDF) ephemeral flow — same Exp 3a layout either way, just a
  // different source for the BoatNote field values.
  async function buildBoatNotePdf(notes: BoatNote[], cusdecNoForFooter: string) {
    const { jsPDF } = await import('jspdf')
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })

    const PW = 277  // landscape A4 width - margins
    const M  = 10   // margin

    notes.forEach((bn, pi) => {
      if (pi > 0) doc.addPage()

      let y = M

      // ── Title ──────────────────────────────────────────────────────────
      doc.setFontSize(10).setFont('helvetica', 'bold')
      doc.text('SHIPPING NOTE / BOAT NOTE  -  Exp 3a', M + PW / 2, y + 4, { align: 'center' })
      y += 8

      // ── Helper functions ───────────────────────────────────────────────
      const box = (x: number, yy: number, w: number, h: number) => doc.rect(x, yy, w, h)

      const label = (x: number, yy: number, txt: string) => {
        doc.setFont('helvetica', 'bold').setFontSize(6.5)
        doc.text(txt, x + 1, yy + 3.5)
      }

      const val = (x: number, yy: number, txt: string, maxW = 60) => {
        doc.setFont('helvetica', 'normal').setFontSize(8)
        const lines = doc.splitTextToSize(txt || '', maxW)
        doc.text(lines.slice(0, 2), x + 1.5, yy + 8)
      }

      const cell = (x: number, yy: number, w: number, h: number, lbl: string, v: string, maxW?: number) => {
        box(x, yy, w, h)
        label(x, yy, lbl)
        val(x, yy, v, maxW || w - 2)
      }

      // ── Row 1: Shipper (col 0..99) | Entry No (100..159) | B/L No (160..286) ──
      const h1 = 18, h2 = 12, h3 = 10

      cell(M,       y, 99, h1, '1.  Shipper (Name and Address)  3336/7', bn.shipper.replace(/\r?\n/g,' '), 96)
      cell(M+99,    y, 60, h1, '9.  Custom Entry No.', bn.entry_no)
      cell(M+159,   y, 60, h1, '10.  SN(B/L) No.', bn.bl_no)
      y += h1

      // ── Row 2: (shipper cont blank) | Exporter Reg | SLPA No ──
      box(M,     y, 99, h2); label(M,     y, '')
      cell(M+99,  y, 60, h2, '11.  Exporter\'s Registration No.', '')
      cell(M+159, y, 60, h2, '12.  SLPA No.', bn.slpa_no)
      y += h2

      // ── Row 3: Consignee | Shipping Line ──
      cell(M,     y, 99, h1, '2.  Consignee (Name and Address)  3132/3', bn.consignee.replace(/\r?\n/g,' '), 96)
      cell(M+99,  y, 120, h1, '13.  Name of Shipping Line / MTO  3126/7', 'PRIYANTHI AGENCY')
      y += h1

      // ── Row 4: Notify | Place of Acceptance ──
      cell(M,    y, 99, h2, '3.  Notify Address  3180/1', 'SAME AS ABOVE')
      cell(M+99, y, 120, h2, '14. (a) Place of Acceptance  3348/9', bn.loading_port)
      y += h2

      // ── Row 5: Voyage/Date | Warehouse | Place of Delivery ──
      cell(M,    y, 55, h2, '4.  Voyage No./Date  8228', `${bn.voyage}  ${bn.voyage_date}`)
      cell(M+55, y, 44, h2, '5.  Warehouse No.  3156  (Terminal)', bn.terminal)
      cell(M+99, y, 120, h2, '14. (b) Place of Delivery  3246/7', bn.discharge_port)
      y += h2

      // ── Row 6: Vessel | Port of Loading ──
      cell(M,    y, 99, h2, '6.  Vessel  8122/3', bn.vessel)
      cell(M+99, y, 60, h2, '7.  Port of Loading  3230/1', bn.loading_port)
      cell(M+159,y, 60, h2, '', '')
      y += h2

      // ── Row 7: Port of Discharge | VSL OPR | CNT OPR | Declaration text ──
      cell(M,     y, 55, h3, '8.  Port of Discharge  3414/5', bn.discharge_port)
      cell(M+55,  y, 22, h3, 'VSL OPR CODE', bn.voc)
      cell(M+77,  y, 22, h3, 'CNT OPR CODE', bn.coc)
      box(M+99, y, 120, h3)
      doc.setFont('helvetica', 'italic').setFontSize(6)
      doc.text('  The Company Preparing this note declares that to the best of their belief the goods', M+100, y+4)
      doc.text('  have been accurately described, their quantities weights and measurements are correct.', M+100, y+8)
      y += h3

      // ── Row 8: Headers for container table ──
      const th = 7
      cell(M,     y, 45, th, '15. Marks & Nos. / Container Nos.  7102', '')
      cell(M+45,  y, 30, th, '16. Number and Kind of Packages  7224/5', '')
      cell(M+75,  y, 50, th, '17. Description of Goods  7002', '')
      cell(M+125, y, 22, th, '18. CCN NO.  7282', '')
      cell(M+147, y, 24, th, '19.(a) Gross Wt (Kg)  6292', '')
      cell(M+171, y, 17, th, '20.(a) Cube m³  6324', '')
      cell(M+188, y, 31, th, 'Lorry / Trailer', '')
      y += th

      // ── Container data row ──
      const dr = 14
      box(M, y, 45, dr); val(M, y, bn.container_no, 42)
      box(M+45, y, 30, dr)
      doc.setFont('helvetica', 'normal').setFontSize(8)
      doc.text(`1 X ${bn.con_type || '40'} FCL`, M+46, y+8)
      box(M+75, y, 50, dr); val(M+75, y, bn.goods, 47)
      box(M+125,y, 22, dr); val(M+125,y, bn.cdn_no, 20)
      box(M+147,y, 24, dr)
      doc.text(bn.gross_mass ? `${bn.gross_mass} KGS` : '', M+148, y+8)
      box(M+171,y, 17, dr); val(M+171,y, bn.volume || '60', 15)
      box(M+188,y, 31, dr); val(M+188,y, `${bn.lorry_no}  ${bn.trailer_no}`, 28)
      y += dr

      // ── Net Wt / Shipped / Seal ──
      const sr = 10
      cell(M,     y, 45, sr, '  Seal No.', bn.seal_no)
      cell(M+45,  y, 30, sr, '  Driver', bn.driver_name.slice(0,18))
      box(M+75,   y, 50, sr)
      box(M+125,  y, 22, sr); label(M+125, y, '19.(e) Shipped (BL)')
      doc.setFont('helvetica','normal').setFontSize(8)
      doc.text(`${bn.pkg_no} BL`, M+126, y+8)
      cell(M+147, y, 24, sr, '19.(b) Net Wt (Kg)', bn.gross_mass ? `${bn.gross_mass} KGS` : '')
      box(M+171,  y, 17, sr)
      box(M+188,  y, 31, sr)
      y += sr

      // ── Status / Freight / SLPA ──
      const fr = 10
      box(M,      y, 55, fr); label(M,     y, '21. For SLPA Use')
      cell(M+55,  y, 44, fr, '25.(a) Status of Container', 'FCL')
      cell(M+99,  y, 60, fr, '25.(b) Freight Payable At', bn.discharge_port)
      cell(M+159, y, 60, fr, '26. No. of Original B/L', '3')
      y += fr

      // ── Company / Declarant / Signature ──
      const cr = 12
      cell(M,     y, 55, cr, '23. Shipping Agent', COMPANY.name)
      cell(M+55,  y, 44, cr, '30. Name of Company Preparing this Note', COMPANY.name)
      cell(M+99,  y, 60, cr, '31. Name of Declarant  3140/1', COMPANY.declarant)
      cell(M+159, y, 60, cr, '32. Tel No.', COMPANY.tel)
      y += cr

      // ── Debit account / Signature line ──
      box(M, y, 219, h3)
      doc.setFont('helvetica','normal').setFontSize(7)
      doc.text(`Please debit our C/A No. ${COMPANY.ca_no} with charges payable`, M+2, y+6)
      box(M+219, y, 58, h3); label(M+219, y, '33. Signature of Declarant                              Date')
      y += h3

      // ── Footer ──
      doc.setFont('helvetica','italic').setFontSize(6.5)
      doc.text(`Generated by Export Management System  ·  CUSDEC ${cusdecNoForFooter}  ·  ${new Date().toLocaleDateString('en-GB')}`, M + PW/2, y+5, { align:'center' })
    })

    return doc
  }

  // Naming convention the spec calls for: B{CUSDEC_Number}, e.g. B12345 —
  // used for every Boat Note file this page produces (direct download,
  // Save Only, and the Done Boat Note archive's own downloads/merges).
  function boatNoteFileName(ext: 'pdf' | 'xlsx') {
    const num = (cusdecNo || 'UNKNOWN').replace(/\D/g, '') || cusdecNo
    return `B${num}.${ext}`
  }

  async function downloadPdf() {
    if (!bnPdf) return
    const bytes = Uint8Array.from(atob(bnPdf.base64), c => c.charCodeAt(0))
    const blob = new Blob([bytes], { type: 'application/pdf' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = bnPdf.fileName; a.click()
    URL.revokeObjectURL(url)
    setStatus('✓ PDF downloaded')
  }

  // Excel isn't a pixel copy of the government Exp 3a form (that's a fixed-
  // layout PDF format) — it's the same field data in flat rows, one per
  // container, for whoever needs to work with it in a spreadsheet.
  async function downloadExcel() {
    if (!boatNotes.length) return
    const XLSX = await import('xlsx')
    const rows = boatNotes.map((bn, i) => ({
      '#': i + 1, 'Shipper': bn.shipper, 'Consignee': bn.consignee, 'Entry No': bn.entry_no, 'B/L No': bn.bl_no,
      'SLPA No': bn.slpa_no, 'Voyage': bn.voyage, 'Voyage Date': bn.voyage_date, 'Vessel': bn.vessel, 'Terminal': bn.terminal,
      'Container No': bn.container_no, 'Con Type': bn.con_type, 'Seal No': bn.seal_no, 'Goods': bn.goods,
      'Gross Mass': bn.gross_mass, 'Net Mass': bn.net_mass, 'CDN No': bn.cdn_no, 'Pkg No': bn.pkg_no, 'Pkg Type': bn.pkg_type,
      'VOC': bn.voc, 'COC': bn.coc, 'Loading Port': bn.loading_port, 'Discharge Port': bn.discharge_port,
      'Volume': bn.volume, 'Marks': bn.marks, 'Lorry/Trailer': `${bn.lorry_no} ${bn.trailer_no}`, 'Driver': bn.driver_name,
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Boat Note')
    XLSX.writeFile(wb, boatNoteFileName('xlsx'))
    setStatus('✓ Excel downloaded')
  }

  const [savingOnly, setSavingOnly] = useState(false)
  // "Save Only": generates the same PDF, uploads it to Drive, and records
  // just the file path on the CUSDEC row (cusdec.boat_note_drive_url) — no
  // auto-download, for when this is being filed rather than handed to
  // someone right now.
  async function saveOnly() {
    if (!bnPdf || !selCusdec) return
    setSavingOnly(true); setStatus('')
    try {
      const h = await authHeader()
      const dr = await fetch('/api/upload-to-drive', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...h },
        body: JSON.stringify({ base64: bnPdf.base64, fileName: bnPdf.fileName, mimeType: 'application/pdf', docType: 'boat_note' }),
      })
      const dd = await dr.json()
      if (!dr.ok || !dd.driveLink) throw new Error(dd.error || 'Drive upload failed')
      const res = await fetch('/api/save-boat-note', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...h },
        body: JSON.stringify({ cusdec_id: selCusdec, drive_url: dd.driveLink, file_name: bnPdf.fileName }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      setSavedBnUrl(dd.driveLink)
      setStatus(`✓ Saved — ${bnPdf.fileName}`)
    } catch (e: any) {
      setStatus(`✗ ${e.message}`)
    } finally {
      setSavingOnly(false)
    }
  }

  async function onSaveBnModal(): Promise<{ ok: boolean; results?: SendResultFile[]; error?: string }> {
    if (!bnPdf || !selCusdec) return { ok: false, error: 'No PDF or CUSDEC selected' }
    try {
      const h = await authHeader()
      const dr = await fetch('/api/upload-to-drive', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...h },
        body: JSON.stringify({ base64: bnPdf.base64, fileName: bnPdf.fileName, mimeType: 'application/pdf', docType: 'boat_note' }),
      })
      const dd = await dr.json()
      if (!dr.ok || !dd.driveLink) throw new Error(dd.error || 'Drive upload failed')
      const res = await fetch('/api/save-boat-note', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...h },
        body: JSON.stringify({ cusdec_id: selCusdec, drive_url: dd.driveLink, file_name: bnPdf.fileName }),
      })
      const sd = await res.json()
      if (!res.ok) throw new Error(sd.error)
      setSavedBnUrl(dd.driveLink)
      return { ok: true, results: [{ fileName: bnPdf.fileName, driveLink: dd.driveLink, docType: 'boat_note' }] }
    } catch (e: any) {
      return { ok: false, error: e.message }
    }
  }

  async function onGetDriveLinksBnModal(): Promise<SendResultFile[]> {
    if (savedBnUrl && bnPdf) return [{ fileName: bnPdf.fileName, driveLink: savedBnUrl, docType: 'boat_note' }]
    const res = await onSaveBnModal()
    return res.results || []
  }

  async function sendEmail() {
    if (!boatNotes.length || !emailTo) return
    setSending(true)
    try {
      const r = await fetch('/api/send-email', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: emailTo,
          subject: `BOAT NOTES - CUSDEC ${cusdecNo} - ${new Date().toLocaleDateString('en-GB')}`,
          body: `Please find the boat notes for CUSDEC ${cusdecNo}.\n\nContainers:\n${boatNotes.map((b,i) => `${i+1}. ${b.container_no} | CDN: ${b.cdn_no} | ${b.goods} | ${b.gross_mass} Kg`).join('\n')}`,
          boatNotes, cusdecNo,
        }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error)
      setStatus('✓ Email sent to ' + emailTo)
    } catch (e: any) { setStatus(`✗ Email: ${e.message}`) }
    finally { setSending(false) }
  }

  const cur = cusdecs.find(c => c.id === selCusdec)
  const curHasBnUrl = !!cur?.boat_note_url
  const curIsBlue   = !!cur?.export_release_passed
  const curIsGreen  = cur ? isCompleted(cur) && !curIsBlue : false
  const statusColor = status.startsWith('✓') ? 'text-green-600' : status.startsWith('⚠') ? 'text-amber-600' : 'text-red-600'

  return (
      <div className="p-6">
        <div className="mb-5">
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <FileStack size={20} className="text-[#3b82f6]"/> Docs Create
          </h1>
          <p className="text-gray-500 text-sm mt-0.5">Invoice · Packing List · Boat Note</p>
        </div>

        {subTabs.length > 1 && (
          <div className="flex gap-1 mb-6 bg-gray-100 p-1 rounded-xl w-fit">
            {subTabs.map(([key, Icon, label]) => (
              <button key={key} onClick={() => setSubTab(key)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  subTab === key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}>
                <Icon size={14}/>{label}
              </button>
            ))}
          </div>
        )}

        {(subTab === 'invoice' && canInvoice) || (subTab === 'packing-list' && canPackingList) ? (
          <CustomDocPanel documentType={subTab === 'invoice' ? 'invoice' : 'packing_list'} label={subTab === 'invoice' ? 'Invoice' : 'Packing List'}/>
        ) : null}

        {subTab === 'boat-note' && canBoatNote && (
        <>
        <p className="text-gray-500 text-sm mb-3 -mt-2">SHIPPING NOTE / BOAT NOTE – Exp 3a format · Select CUSDEC → CDNs → Generate → Download / Email</p>

        <div className="flex gap-1.5 mb-4 bg-gray-100 rounded-lg p-1 w-fit">
          <button onClick={() => { setBnEntryMode('cusdec'); setBnPdf(null); setBoatNotes([]); setStatus(''); setSavedBnUrl(''); setBnReason(''); setBnSheetPickNeeded(false); setBnFillSheetGid(''); setBnPrintSheetGid('') }}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${bnEntryMode === 'cusdec' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
            From CUSDEC
          </button>
          <button onClick={() => { setBnEntryMode('manual'); setBnPdf(null); setBoatNotes([]); setStatus(''); setSavedBnUrl(''); setBnReason(''); setBnSheetPickNeeded(false); setBnFillSheetGid(''); setBnPrintSheetGid('') }}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${bnEntryMode === 'manual' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
            Manual Entry
          </button>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">

          {/* Manual Entry — no CUSDEC/CDN needed, fill template fields by hand */}
          {bnEntryMode === 'manual' && (
          <div className="card xl:col-span-2">
            <h2 className="font-semibold text-gray-900 text-sm mb-3">Fill Template Fields</h2>
            {bnTplLoadError ? (
              <p className="text-xs text-red-500 flex items-center gap-1">
                <AlertTriangle size={12}/>{bnTplLoadError}
              </p>
            ) : bnTplFields.length === 0 ? (
              <p className="text-xs text-gray-400">Loading template fields…</p>
            ) : (
              <div className="space-y-3">
                {bnTplFields.map(f => {
                  const rows = bnFormValues[f.field_label] || ['']
                  return (
                    <div key={f.field_label}>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-xs font-medium text-gray-600">{f.field_label}</label>
                        {f.is_repeating && (
                          <button
                            onClick={() => setBnFormValues(p => ({ ...p, [f.field_label]: [...(p[f.field_label] || ['']), ''] }))}
                            className="flex items-center gap-1 text-[11px] text-blue-600 hover:underline">
                            <Plus size={11}/>Add Row
                          </button>
                        )}
                      </div>
                      {f.is_repeating ? (
                        <div className="space-y-1.5">
                          {rows.map((val, ri) => (
                            <div key={ri} className="flex gap-1.5">
                              <input
                                value={val}
                                onChange={e => setBnFormValues(p => {
                                  const arr = [...(p[f.field_label] || [])]
                                  arr[ri] = e.target.value
                                  return { ...p, [f.field_label]: arr }
                                })}
                                className="input text-xs flex-1"
                                placeholder={`Row ${ri + 1}`}/>
                              {rows.length > 1 && (
                                <button
                                  onClick={() => setBnFormValues(p => {
                                    const arr = (p[f.field_label] || []).filter((_, ii) => ii !== ri)
                                    return { ...p, [f.field_label]: arr }
                                  })}
                                  className="text-gray-300 hover:text-red-500">
                                  <X size={13}/>
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <input
                          value={rows[0] || ''}
                          onChange={e => setBnFormValues(p => ({ ...p, [f.field_label]: [e.target.value] }))}
                          className="input text-xs w-full"/>
                      )}
                    </div>
                  )
                })}
                <button onClick={generateManualBn} disabled={bnManualGenerating}
                  className="flex items-center justify-center gap-2 w-full py-2.5 rounded-lg text-sm text-white font-medium disabled:opacity-40 mt-1"
                  style={{ background: '#3b82f6' }}>
                  {bnManualGenerating ? <Loader size={14} className="animate-spin"/> : <Anchor size={14}/>}
                  Generate Boat Note
                </button>
              </div>
            )}
          </div>
          )}

          {/* Step 1 — CUSDEC */}
          {bnEntryMode === 'cusdec' && canSelectCusdec && (
          <div className="card">
            <div className="flex items-center justify-between mb-1.5">
              <h2 className="font-semibold text-gray-900 text-sm">1 · Select CUSDEC</h2>
              <button onClick={() => loadCusdecs()} className="text-gray-400 hover:text-gray-600"><RefreshCw size={13}/></button>
            </div>
            <label className="flex items-center gap-1.5 text-[11px] text-gray-500 mb-2.5 cursor-pointer">
              <input type="checkbox" checked={showCompleted} onChange={e => setShowCompleted(e.target.checked)}/>
              Show Completed Records (Export Released / Boat Note Passed)
            </label>
            {loading ? (
              <div className="flex justify-center py-6"><Loader size={18} className="animate-spin text-gray-400"/></div>
            ) : visibleCusdecs.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-6">{cusdecs.length === 0 ? 'No CUSDECs — import Excel file first' : 'Nothing pending — tick "Show Completed Records" to see them'}</p>
            ) : (
              <div className="space-y-1 max-h-72 overflow-y-auto">
                {visibleCusdecs.map(c => (
                  <button key={c.id}
                    onClick={() => { setSelCusdec(c.id); setSelCdns([]); setBoatNotes([]); setBnSheetPickNeeded(false); setBnFillSheetGid(''); setBnPrintSheetGid('') }}
                    className={`w-full text-left p-2.5 rounded-lg border text-xs transition-all ${
                      selCusdec === c.id ? 'bg-blue-50 border-blue-300 shadow-sm' : 'border-gray-100 hover:bg-gray-50'
                    } ${isCompleted(c) ? '!border-l-4 !border-l-green-500' : ''}`}>
                    <p className="font-bold text-gray-800 flex items-center gap-1.5">
                      E {c.number}
                      {c.cap && <span className="text-[10px] font-normal px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">CAP {c.cap}</span>}
                      {c.export_release_passed && <span className="text-[10px] font-normal text-blue-600">· Released</span>}
                    </p>
                    <p className="text-gray-600 truncate mt-0.5">{c.exporter?.slice(0,40)}</p>
                    <p className="text-gray-400 mt-0.5">{c.vessel} · {c.voyage_no}</p>
                  </button>
                ))}
              </div>
            )}
          </div>
          )}

          {/* Step 2 — CDNs */}
          {bnEntryMode === 'cusdec' && canSelectCdn && (
          <div className="card">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-gray-900 text-sm">2 · Select Containers (CDN)</h2>
              {cdns.length > 0 && (
                <div className="flex gap-2 text-xs">
                  <button onClick={() => setSelCdns(cdns.map(c=>c.id))} className="text-blue-600 hover:text-blue-800">All</button>
                  <button onClick={() => setSelCdns([])} className="text-gray-400">None</button>
                </div>
              )}
            </div>
            {!selCusdec ? (
              <p className="text-xs text-gray-400 text-center py-6">Select a CUSDEC first</p>
            ) : cdns.length === 0 ? (
              <div className="text-center py-6">
                <p className="text-xs text-gray-400">No CDNs found for CUSDEC {cur?.number}</p>
                <p className="text-xs text-gray-300 mt-1">Import Excel to populate CDN records</p>
              </div>
            ) : (
              <div className="space-y-1 max-h-64 overflow-y-auto mb-3">
                {cdns.map(cdn => {
                  const on = selCdns.includes(cdn.id)
                  return (
                    <button key={cdn.id} onClick={() => toggleCdn(cdn.id)}
                      className={`w-full flex items-start gap-2 text-left p-2.5 rounded-lg border text-xs transition-all ${
                        on ? 'bg-green-50 border-green-300' : 'border-gray-100 hover:bg-gray-50'
                      }`}>
                      {on
                        ? <CheckSquare size={13} className="text-green-500 flex-shrink-0 mt-0.5"/>
                        : <Square size={13} className="text-gray-300 flex-shrink-0 mt-0.5"/>}
                      <div>
                        <p className="font-bold text-gray-800">{cdn.container_no || '—'}</p>
                        <p className="text-gray-500">CDN: {cdn.cdn_no} · {cdn.goods_description || 'WASTE PAPER'}</p>
                        <p className="text-gray-400">{cdn.gross_mass} Kg · Driver: {cdn.driver_name?.slice(0,18)}</p>
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
            <button onClick={generate} disabled={generating || !selCusdec || !selCdns.length}
              className="mt-2 w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm text-white font-medium disabled:opacity-40 transition-opacity"
              style={{ background: '#3b82f6' }}>
              {generating ? <Loader size={14} className="animate-spin"/> : <Anchor size={14}/>}
              Generate {selCdns.length > 0 ? `(${selCdns.length})` : ''} Boat Note{selCdns.length !== 1 ? 's' : ''}
            </button>
          </div>
          )}

          {/* Step 3 — Output */}
          {canOutput && (
          <div className="card">
            <h2 className="font-semibold text-gray-900 text-sm mb-3">3 · Download / Email</h2>

            {status && <p className={`text-xs mb-3 font-medium ${statusColor}`}>{status}</p>}

            {bnPdf ? (
              <>
                {/* Container summary — CUSDEC mode only */}
                {boatNotes.length > 0 && (
                  <div className="bg-green-50 border border-green-200 rounded-xl p-3 mb-4">
                    <p className="text-xs font-bold text-green-700 mb-1.5">
                      CUSDEC E {cusdecNo} · {boatNotes.length} container{boatNotes.length !== 1 ? 's' : ''}
                    </p>
                    <div className="space-y-0.5">
                      {boatNotes.map((bn, i) => (
                        <p key={i} className="text-xs text-green-700">
                          {i+1}. {bn.container_no} · CDN {bn.cdn_no} · {bn.gross_mass} Kg
                        </p>
                      ))}
                    </div>
                  </div>
                )}

                {/* Download + Send */}
                {bnPdf && (
                  <div className="flex gap-2 mb-3">
                    <button onClick={downloadPdf}
                      className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm text-white font-medium"
                      style={{ background: '#1B3A5C' }}>
                      <FileDown size={14}/> Download
                    </button>
                    {(bnEntryMode === 'manual' || !(curIsGreen && curHasBnUrl)) && (
                      <button onClick={() => setSendModalBnOpen(true)}
                        className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium border border-gray-200 text-gray-700 hover:bg-gray-50">
                        <Send size={14}/> Send
                      </button>
                    )}
                  </div>
                )}

                {/* Save panel — status-based, CUSDEC mode only (Manual Entry has no CUSDEC to save against) */}
                {bnEntryMode === 'cusdec' && bnPdf && !(curIsGreen && curHasBnUrl) && (
                  <div className="border-t border-gray-100 pt-3">
                    <h3 className="text-xs font-semibold text-gray-700 mb-2">Save to System</h3>
                    {savedBnUrl ? (
                      <div className="flex items-center gap-2 text-xs text-green-600 bg-green-50 rounded-lg px-3 py-2 border border-green-100">
                        <CheckCircle size={13}/>Saved!{" "}
                        <a href={savedBnUrl} target="_blank" rel="noreferrer" className="underline ml-1">View in Drive</a>
                      </div>
                    ) : curHasBnUrl ? (
                      /* Rule 2: has existing url → locked replace */
                      <div className="space-y-2">
                        <label className="flex items-center gap-2 text-xs text-gray-600 bg-amber-50 rounded-lg px-3 py-2 border border-amber-100 cursor-not-allowed select-none">
                          <input type="checkbox" checked readOnly className="opacity-60"/>
                          <span className="font-medium">Replace existing Boat Note link</span>
                          <span className="text-gray-400 text-[11px]">(locked)</span>
                        </label>
                        <p className="text-xs text-amber-600 flex items-center gap-1">
                          <AlertTriangle size={12}/>Will upload new PDF and replace the existing Drive link.
                        </p>
                        <button onClick={saveOnly} disabled={savingOnly}
                          className="flex items-center gap-2 w-full justify-center px-3 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50"
                          style={{ background: '#22A87A' }}>
                          {savingOnly ? <Loader size={14} className="animate-spin"/> : <CheckCircle size={14}/>}Done
                        </button>
                      </div>
                    ) : (
                      /* Rules 3 & 4: no existing url → reason dropdown */
                      <div className="space-y-2">
                        <select value={bnReason} onChange={e => setBnReason(e.target.value)} className="input w-full text-xs">
                          <option value="">— Select reason —</option>
                          <option value="first_generation">First Generation</option>
                          <option value="reissue">Re-issue</option>
                          <option value="correction">Correction</option>
                          <option value="other">Other</option>
                        </select>
                        <button onClick={saveOnly} disabled={savingOnly || !bnReason}
                          className="flex items-center gap-2 w-full justify-center px-3 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50"
                          style={{ background: '#22A87A' }}>
                          {savingOnly ? <Loader size={14} className="animate-spin"/> : <CheckCircle size={14}/>}Done
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* SendModal */}
                {sendModalBnOpen && bnPdf && (
                  <SendModal
                    label={bnPdf.fileName}
                    docType="boat_note"
                    onSave={onSaveBnModal}
                    onGetDriveLinks={onGetDriveLinksBnModal}
                    onClose={() => setSendModalBnOpen(false)}
                    onDone={() => { setSendModalBnOpen(false); loadCusdecs(true); setBnHistoryRefreshKey(k => k + 1) }}
                  />
                )}

                <GenerationHistoryPanel documentType="boat_note" refreshKey={bnHistoryRefreshKey}/>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Anchor size={32} className="text-gray-200 mb-3"/>
                <p className="text-sm text-gray-400">
                  {bnEntryMode === 'cusdec' ? <>Select CUSDEC + containers<br/>then click Generate</> : <>Fill in the template fields<br/>then click Generate</>}
                </p>
              </div>
            )}
          </div>
          )}
        </div>

        {/* Format preview note */}
        <div className="mt-4 p-3 bg-blue-50 rounded-xl border border-blue-100 text-xs text-blue-700">
          <span className="font-semibold">PDF Format:</span> SHIPPING NOTE / BOAT NOTE – Exp 3a · Landscape A4 · All fields from Excel b2 sheet (Shipper, Consignee, Voyage, Vessel, Port of Loading/Discharge, Container, CDN No., Gross Weight, Cube, SLPA, Company, Declarant)
        </div>

        {bnSheetPickNeeded && (
          <SheetPickerModal
            message={bnSheetPickMessage}
            sheets={bnSheets}
            fillGid={bnFillSheetGid}
            printGid={bnPrintSheetGid}
            onFillChange={setBnFillSheetGid}
            onPrintChange={setBnPrintSheetGid}
            onConfirm={() => bnEntryMode === 'cusdec' ? generateBnPdf(cusdecNo, boatNotes.length) : generateManualBn()}
            onClose={() => setBnSheetPickNeeded(false)}
            busy={generating || bnManualGenerating}
          />
        )}

        </>
        )}

        {subTab === 'cusdec-xml' && canCusdecXml && <CusdecXmlPanel/>}
        {subTab === 'cdn-text' && canCdnText && <CdnTextPanel/>}
        {subTab === 'parties-copy' && canPartiesCopy && <PartiesCopyPanel/>}
        {subTab.startsWith('custom:') && canBoatNote && (() => {
          const value = subTab.slice('custom:'.length)
          const d = customDocTypes.find(c => c.value === value)
          if (!d) return null
          return d.format === 'trico_gate_pass'
            ? <TricoGatePassPanel documentType={d.value} label={d.label}/>
            : <CustomDocPanel documentType={d.value} label={d.label}/>
        })()}
      </div>
  )
}

// ── Done Boat Note — archive of every Boat Note ever saved via Save Only ──
interface DoneBoatNote { id: string; cusdec_number: string | null; file_name: string; drive_url: string; created_at: string; created_by_name: string | null }

function DoneBoatNotePanel() {
  const [items, setItems] = useState<DoneBoatNote[]>([])
  const [loading, setLoading] = useState(false)
  const [cusdecNumber, setCusdecNumber] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [merging, setMerging] = useState(false)
  const [merged, setMerged] = useState<{ base64: string; fileName: string } | null>(null)
  const [emailTo, setEmailTo] = useState('')
  const [sendingMail, setSendingMail] = useState(false)
  const [status, setStatus] = useState('')
  // Filters only actually apply via the Search button, not on every
  // keystroke — the poll below needs the CURRENT filter values at call time,
  // not whatever they were when the mount-only effect first ran, so it reads
  // through this ref instead of closing over cusdecNumber/from/to directly.
  const filtersRef = useRef({ cusdecNumber, from, to })
  useEffect(() => { filtersRef.current = { cusdecNumber, from, to } }, [cusdecNumber, from, to])

  async function load(silent = false) {
    if (!silent) setLoading(true)
    try {
      const { cusdecNumber, from, to } = filtersRef.current
      const params = new URLSearchParams()
      if (cusdecNumber) params.set('cusdecNumber', cusdecNumber)
      if (from) params.set('from', from)
      if (to) params.set('to', to)
      const res = await fetch(`/api/generated-boat-notes?${params.toString()}`, { headers: await authHeader() })
      const d = await res.json()
      if (res.ok) setItems(d.items || [])
    } finally { if (!silent) setLoading(false) }
  }
  useEffect(() => {
    load()
    // Live — a Boat Note someone else just saved shows up here without a
    // manual refresh, respecting whatever filter is currently applied.
    const t = setInterval(() => load(true), 15000)
    return () => clearInterval(t)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function toggle(id: string) { setSelected(prev => ({ ...prev, [id]: !prev[id] })) }
  const selectedIds = Object.keys(selected).filter(id => selected[id])
  const allSelected = items.length > 0 && selectedIds.length === items.length
  function toggleAll() { setSelected(allSelected ? {} : Object.fromEntries(items.map(i => [i.id, true]))) }

  async function mergeSelected() {
    setMerging(true); setStatus(''); setMerged(null)
    try {
      const res = await fetch('/api/merge-boat-notes', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ ids: selectedIds }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      setMerged({ base64: d.base64, fileName: d.fileName })
      setStatus(`✓ Merged ${selectedIds.length} Boat Notes — download or email below (not saved anywhere)`)
    } catch (e: any) {
      setStatus(`✗ ${e.message}`)
    } finally {
      setMerging(false)
    }
  }

  function downloadMerged() {
    if (!merged) return
    const bytes = Uint8Array.from(atob(merged.base64), c => c.charCodeAt(0))
    const blob = new Blob([bytes], { type: 'application/pdf' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = merged.fileName
    a.click()
    URL.revokeObjectURL(url)
  }

  async function emailMerged() {
    if (!merged || !emailTo) return
    setSendingMail(true); setStatus('')
    try {
      const res = await fetch('/api/send-email', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({
          to: emailTo, subject: `Merged Boat Notes — ${merged.fileName}`,
          body: `Attached: ${selectedIds.length} merged Boat Note(s).`,
          attachments: [{ filename: merged.fileName, base64: merged.base64 }],
        }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      setStatus(`✓ Emailed to ${emailTo}`)
    } catch (e: any) {
      setStatus(`✗ ${e.message}`)
    } finally {
      setSendingMail(false)
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-gray-500 text-sm -mt-2">Archive of every Boat Note saved via "Save Only" — filter, then select several to merge into one PDF.</p>

      <div className="card">
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <input value={cusdecNumber} onChange={e => setCusdecNumber(e.target.value)} placeholder="CUSDEC number..." className="input max-w-[160px]"/>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="input max-w-[150px]"/>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} className="input max-w-[150px]"/>
          <button onClick={() => load()} className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs text-white" style={{ background: '#1B3A5C' }}>
            <Search size={12}/> Search
          </button>
          {selectedIds.length > 1 && (
            <button onClick={mergeSelected} disabled={merging}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs text-white disabled:opacity-50" style={{ background: '#8b5cf6' }}>
              {merging ? <Loader size={12} className="animate-spin"/> : <FileStack size={12}/>} Merge Selected ({selectedIds.length})
            </button>
          )}
        </div>
        {status && <p className={`text-xs mb-3 font-medium ${status.startsWith('✓') ? 'text-green-600' : 'text-red-600'}`}>{status}</p>}

        {merged && (
          <div className="mb-3 bg-purple-50 border border-purple-200 rounded-lg p-3 space-y-2">
            <div className="flex items-center gap-2">
              <p className="text-xs text-purple-700 flex-1">{merged.fileName}</p>
              <button onClick={downloadMerged} className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-white text-xs" style={{ background: '#1B3A5C' }}>
                <FileDown size={12}/> Download
              </button>
            </div>
            <div className="flex items-center gap-2">
              <input value={emailTo} onChange={e => setEmailTo(e.target.value)} placeholder="recipient@email.com"
                className="input text-xs flex-1"/>
              <button onClick={emailMerged} disabled={sendingMail || !emailTo}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-white text-xs disabled:opacity-50" style={{ background: '#22A87A' }}>
                {sendingMail ? <Loader size={12} className="animate-spin"/> : <Mail size={12}/>} Email
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-8"><Loader size={18} className="animate-spin text-gray-400"/></div>
        ) : items.length === 0 ? (
          <p className="text-xs text-gray-400 text-center py-6">No saved Boat Notes yet</p>
        ) : (
          <div className="overflow-x-auto max-h-96 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 sticky top-0"><tr>
                <th className="text-left px-2 py-1.5"><button onClick={toggleAll} className="text-gray-400 hover:text-gray-600">{allSelected ? <CheckSquare size={13} className="text-green-600"/> : <Square size={13}/>}</button></th>
                <th className="text-left px-2 py-1.5 text-gray-500 font-medium">File</th>
                <th className="text-left px-2 py-1.5 text-gray-500 font-medium">CUSDEC</th>
                <th className="text-left px-2 py-1.5 text-gray-500 font-medium">Saved By</th>
                <th className="text-left px-2 py-1.5 text-gray-500 font-medium">When</th>
                <th className="text-left px-2 py-1.5 text-gray-500 font-medium"></th>
              </tr></thead>
              <tbody>
                {items.map(it => (
                  <tr key={it.id} className="border-t border-gray-50">
                    <td className="px-2 py-1.5">
                      <button onClick={() => toggle(it.id)} className="text-gray-300 hover:text-green-600">
                        {selected[it.id] ? <CheckSquare size={13} className="text-green-600"/> : <Square size={13}/>}
                      </button>
                    </td>
                    <td className="px-2 py-1.5 text-gray-800">{it.file_name}</td>
                    <td className="px-2 py-1.5 text-gray-600">{it.cusdec_number ? `E ${it.cusdec_number}` : '—'}</td>
                    <td className="px-2 py-1.5 text-gray-600">{it.created_by_name || '—'}</td>
                    <td className="px-2 py-1.5 text-gray-400">{new Date(it.created_at).toLocaleString('en-GB')}</td>
                    <td className="px-2 py-1.5">
                      <a href={it.drive_url} target="_blank" rel="noreferrer" className="text-blue-500 hover:text-blue-700"><FileDown size={13}/></a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Cusdec XML Tab ────────────────────────────────────────────────────────
interface CusdecXmlRec extends CusdecRec {
  date?: string; delivery_terms?: string; hs_code?: string
  preference?: string; procedure_code?: string; pkges?: string
}

function CusdecXmlPanel() {
  const [cusdecs, setCusdecs] = useState<CusdecXmlRec[]>([])
  const [cdns, setCdns] = useState<Record<string, any>[]>([])
  const [mappings, setMappings] = useState<XmlMappingRow[]>(defaultXmlMappings())
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [values, setValues] = useState<XmlValues>(emptyXmlValues())
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('')

  useEffect(() => {
    function load() {
      fetch('/api/list-records?table=cusdec&limit=500').then(r => r.json()).then(d => setCusdecs(d.records || [])).catch(() => {})
      fetch('/api/list-records?table=cdn&limit=1000').then(r => r.json()).then(d => setCdns(d.records || [])).catch(() => {})
    }
    load()
    const t = setInterval(load, 20000)
    // The Templates page ("ASYCUDA CUSDEC XML" format) is the source of
    // truth for field mapping once an admin has saved one — falls back to
    // the built-in defaults (same ones Templates seeds a fresh template
    // with) so this works with zero setup.
    fetch('/api/doc-templates').then(r => r.json()).then(d => {
      const tpl = (d.templates || []).find((t: any) => t.document_type === 'cusdec_xml')
      if (tpl?.template_mappings?.length) setMappings(tpl.template_mappings)
    }).catch(() => {})
    return () => clearInterval(t)
  }, [])

  const filtered = cusdecs.filter(c =>
    !search || c.number?.toLowerCase().includes(search.toLowerCase()) || c.exporter?.toLowerCase().includes(search.toLowerCase())
  )
  const selected = cusdecs.find(c => c.id === selectedId) || null

  async function selectCusdec(id: string) {
    setSelectedId(id); setStatus('')
    const cusdec = cusdecs.find(c => c.id === id) as unknown as Record<string, any> | undefined
    if (!cusdec) return
    setLoading(true)
    try {
      const res = await fetch(`/api/cusdec-xml?id=${id}`)
      const d = await res.json()
      const saved: Partial<XmlValues> = d.xml_data || {}
      const cdnRow = cdns.find(c => c.code === cusdec.code && c.cusdec_number === cusdec.number) || null

      // Database pull (via mapping) wins when it has a value; otherwise fall
      // back to whatever was last saved to this CUSDEC's xml_data, then the
      // ASYCUDA structural defaults — same priority the dedicated builder
      // used before, just driven by configurable mappings now instead of a
      // fixed handful of hardcoded fields.
      const merged: XmlValues = { ...emptyXmlValues(), ...saved }
      for (const def of XML_FIELD_DEFS) {
        const m = mappings.find(mm => mm.field_label === def.key)
        if (!m || m.data_source === 'manual') continue
        const raw = m.data_source === 'cusdec' ? cusdec[m.column_name] : cdnRow?.[m.column_name]
        if (raw) (merged as any)[def.key] = raw
      }
      setValues(merged)
    } finally { setLoading(false) }
  }

  function setField<K extends keyof XmlValues>(key: K, v: XmlValues[K]) {
    setValues(prev => ({ ...prev, [key]: v }))
  }

  async function saveXml() {
    if (!selected) return
    setStatus('')
    try {
      const res = await fetch('/api/cusdec-xml', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: selected.id, xml_data: values }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      setStatus('✓ Saved to CUSDEC record')
    } catch (e: any) { setStatus(`✗ ${e.message}`) }
  }

  function generateXml() {
    const xml = buildAsycudaXml(values)
    const blob = new Blob([xml], { type: 'application/xml' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `CUSDEC_${values.regNumber || 'export'}.xml`
    a.click(); URL.revokeObjectURL(url)
    setStatus('✓ XML downloaded')
  }

  // Every ASYCUDA field gets an editable box here — not just a curated
  // subset — so anything without a database mapping (or where the mapped
  // value is wrong/missing) always has somewhere to type it by hand before
  // Save/Generate. Derived from XML_FIELD_DEFS (the same list Templates'
  // "ASYCUDA CUSDEC XML" format mapping uses) so the two stay in sync.
  const FIELD_GROUPS: { title: string; fields: [keyof XmlValues, string][] }[] =
    Array.from(new Set(XML_FIELD_DEFS.map(def => def.group))).map(group => ({
      title: group,
      fields: XML_FIELD_DEFS.filter(def => def.group === group).map(def => [def.key, def.label] as [keyof XmlValues, string]),
    }))

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
      <div className="card xl:col-span-1">
        <h2 className="font-semibold text-gray-900 text-sm mb-3">Select CUSDEC</h2>
        <div className="relative mb-3">
          <Search size={14} className="absolute left-2.5 top-2.5 text-gray-400"/>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search number or exporter..."
            className="w-full pl-8 pr-3 py-2 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-400"/>
        </div>
        <div className="space-y-1 max-h-96 overflow-y-auto">
          {filtered.map(c => (
            <button key={c.id} onClick={() => selectCusdec(c.id)}
              className={`w-full text-left p-2.5 rounded-lg border text-xs ${selectedId === c.id ? 'bg-blue-50 border-blue-300' : 'border-gray-100 hover:bg-gray-50'}`}>
              <p className="font-bold text-gray-800">E {c.number}</p>
              <p className="text-gray-600 truncate">{c.exporter?.slice(0, 40)}</p>
            </button>
          ))}
          {filtered.length === 0 && <p className="text-xs text-gray-400 text-center py-6">No CUSDECs found</p>}
        </div>
      </div>
      <div className="xl:col-span-2 space-y-4">
        {!selected ? (
          <div className="card text-center py-16 text-gray-400 text-sm">Select a CUSDEC to build its XML</div>
        ) : loading ? (
          <div className="card flex justify-center py-16"><Loader size={20} className="animate-spin text-gray-400"/></div>
        ) : (
          <>
            {status && <p className={`text-xs font-medium ${status.startsWith('✓') ? 'text-green-600' : 'text-red-600'}`}>{status}</p>}
            {FIELD_GROUPS.map(group => (
              <div key={group.title} className="card">
                <h3 className="font-semibold text-gray-900 text-sm mb-3">{group.title}</h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {group.fields.map(([key, label]) => (
                    <Field key={key} label={label}>
                      <input value={(values[key] as string) || ''} onChange={e => setField(key, e.target.value as any)} className="input"/>
                    </Field>
                  ))}
                </div>
              </div>
            ))}
            <div className="card flex gap-3">
              <button onClick={saveXml} className="btn-secondary flex items-center gap-2"><Save size={14}/>Save to CUSDEC record</button>
              <button onClick={generateXml} className="btn-primary flex items-center gap-2"><Download size={14}/>Generate XML</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── CDN Text Tab ──────────────────────────────────────────────────────────
function CdnTextPanel() {
  const [cdns, setCdns] = useState<CdnRec[]>([])
  const [cusdecs, setCusdecs] = useState<CusdecRec[]>([])
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [fields, setFields] = useState<Record<string, string>>({})
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    function load() {
      fetch('/api/list-records?table=cdn&limit=500').then(r => r.json()).then(d => setCdns(d.records || [])).catch(() => {})
      fetch('/api/list-records?table=cusdec&limit=500').then(r => r.json()).then(d => setCusdecs(d.records || [])).catch(() => {})
    }
    load()
    const t = setInterval(load, 20000)
    return () => clearInterval(t)
  }, [])

  const filtered = cdns.filter(c => !search || c.container_no?.toLowerCase().includes(search.toLowerCase()) || c.shipper?.toLowerCase().includes(search.toLowerCase()))

  function selectCdn(id: string) {
    setSelectedId(id)
    const cdn = cdns.find(c => c.id === id)
    if (!cdn) return
    const cusdec = cusdecs.find(c => c.code === cdn.code && c.number === cdn.cusdec_number)

    // cdn_no is stored as one composite string — "2026 CBEX1 C 46385" i.e.
    // "YEAR CODE SERIAL NUMBER" — split it instead of dumping the whole
    // thing into the NBR line (which duplicated the COD/YEA/SER lines above
    // it) or hardcoding today's year/a fixed 'C' serial.
    const cdnNoParts = (cdn.cdn_no || '').trim().split(/\s+/)
    const [cdnYear, cdnCode, cdnSerial, cdnNumber] = cdnNoParts.length === 4
      ? cdnNoParts : ['', '', '', cdn.cdn_no || '']

    setFields({
      officeCode: cdnCode || cusdec?.code || cdn.code || '', year: cdnYear || new Date().getFullYear().toString(),
      serial: cdnSerial || 'C', number: cdnNumber,
      // cdn has no consignee column of its own — the buyer's name/address
      // only lives on the matched CUSDEC row.
      shipper: cdn.shipper || '', consignee: cusdec?.consignee || '',
      linkedCusdecRef: cusdec?.number || '', voyageDate: cdn.voyage_date || '', bl: cdn.bl_no || '',
      driver: cdn.driver_name || '', terminal: cdn.location || '', lorry: cdn.lorry_no || '', trailer: cdn.trailer_no || '',
      loadPort: cdn.loading_port || '', dischPort: cdn.discharge_port || '', vessel: cdn.vessel || '',
      voc: cdn.voc || '', coc: cdn.coc || '', slpa: cdn.slpa_no || '',
      pkgNo: cdn.pkg_no || '', pkgType: cdn.pkg_type || '', volume: cdn.volume || '',
      goods: cdn.goods_description || '', container: cdn.container_no || '', conType: cdn.con_type || '',
      seal: cdn.seal_no || '', marks: cdn.marks || '', gross: cdn.gross_mass || '',
      // Declarant code is the clearing agent's own registration — fixed
      // across every declaration, not something that varies per shipment —
      // so it falls back to the known constant when no per-CUSDEC value has
      // been saved yet (cusdec.declarant_code is a new, mostly-empty column).
      preparedBy: '', declarantCode: cusdec?.declarant_code || '1748813322525',
    })
  }

  function setF(key: string, v: string) { setFields(prev => ({ ...prev, [key]: v })) }

  const textOutput = [
    `COD: ${fields.officeCode || ''}`, `YEA: ${fields.year || ''}`, `SER: ${fields.serial || ''}`, `NBR: ${fields.number || ''}`,
    `COD: <unknown>`, `YEA: <unknown>`, `SER: <unknown>`, `NBR: <unknown>`,
    `ADD: ${fields.shipper || ''}`, `ADD: ${fields.consignee || ''}`,
    `NBR: ${fields.linkedCusdecRef || ''}`, `DAT: ${fields.voyageDate || ''}`, `BOL: ${fields.bl || ''}`,
    `DRV: ${fields.driver || ''}`, `CLN: ${fields.terminal || ''}`, `NBR: ${fields.lorry || ''}`, `TRL: ${fields.trailer || ''}`,
    `LOD: ${fields.loadPort || ''}`, `ULD: ${fields.dischPort || ''}`, `EXV: ${fields.vessel || ''}`,
    `VSL: ${fields.voc || ''}`, `OPC: ${fields.coc || ''}`, `SLP: ${fields.slpa || ''}`,
    `NBR: ${fields.pkgNo || ''}`, `TYP: ${fields.pkgType || ''}`, `VOL: ${fields.volume || ''}`,
    `DSC: ${fields.goods || ''}`, `NBR: ${fields.container || ''}`, `TYP: ${fields.conType || ''}`,
    `SEA: ${fields.seal || ''}`, `MRK: ${fields.marks || ''}`, `GWT: ${fields.gross || ''}`, `TMP: ...`,
    `NAM: ${fields.preparedBy || ''}`, `DAT: ${new Date().toISOString().slice(0, 19).replace('T', ' ')}.0`,
    `COD: ${fields.declarantCode || ''}`, `CNT: 1`,
  ].join('\n')

  function copyText() {
    navigator.clipboard.writeText(textOutput).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) })
  }

  const editableFieldLabels: [string, string][] = [
    ['officeCode', 'Office Code'], ['year', 'Year'], ['serial', 'Serial'], ['number', 'CDN Number'],
    ['shipper', 'Shipper (Address)'], ['consignee', 'Consignee (Address)'], ['linkedCusdecRef', 'Linked CUSDEC Ref'],
    ['voyageDate', 'Voyage Date'], ['bl', 'B/L No.'], ['driver', 'Driver'], ['terminal', 'Terminal'],
    ['lorry', 'Lorry No.'], ['trailer', 'Trailer No.'], ['loadPort', 'Loading Port'], ['dischPort', 'Discharge Port'],
    ['vessel', 'Vessel'], ['voc', 'VOC'], ['coc', 'COC'], ['slpa', 'SLPA No.'],
    ['pkgNo', 'Package No.'], ['pkgType', 'Package Type'], ['volume', 'Volume'], ['goods', 'Goods Description'],
    ['container', 'Container No.'], ['conType', 'Container Type'], ['seal', 'Seal No.'], ['marks', 'Marks'], ['gross', 'Gross Mass'],
    ['preparedBy', 'Prepared By (Name)'], ['declarantCode', 'Declarant Code'],
  ]

  return (
    <div className="space-y-6">
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
      <div className="card xl:col-span-1">
        <h2 className="font-semibold text-gray-900 text-sm mb-3">Select CDN</h2>
        <div className="relative mb-3">
          <Search size={14} className="absolute left-2.5 top-2.5 text-gray-400"/>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search container or shipper..."
            className="w-full pl-8 pr-3 py-2 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-400"/>
        </div>
        <div className="space-y-1 max-h-96 overflow-y-auto">
          {filtered.map(c => (
            <button key={c.id} onClick={() => selectCdn(c.id)}
              className={`w-full text-left p-2.5 rounded-lg border text-xs ${selectedId === c.id ? 'bg-blue-50 border-blue-300' : 'border-gray-100 hover:bg-gray-50'}`}>
              <p className="font-bold text-gray-800">{c.container_no || '—'}</p>
              <p className="text-gray-600 truncate">{c.shipper?.slice(0, 40)}</p>
            </button>
          ))}
          {filtered.length === 0 && <p className="text-xs text-gray-400 text-center py-6">No CDNs found</p>}
        </div>
      </div>
      <div className="xl:col-span-2 space-y-4">
        {!selectedId ? (
          <div className="card text-center py-16 text-gray-400 text-sm">Select a CDN to pull its data</div>
        ) : (
          <>
            <div className="card">
              <h3 className="font-semibold text-gray-900 text-sm mb-3">Fields (auto-pulled from database — edit here only, nothing writes back)</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {editableFieldLabels.map(([key, label]) => (
                  <Field key={key} label={label}>
                    <input value={fields[key] || ''} onChange={e => setF(key, e.target.value)} className="input"/>
                  </Field>
                ))}
              </div>
            </div>
            <div className="card">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold text-gray-900 text-sm">Copy/Paste Text Output</h3>
                <button onClick={copyText} className="btn-secondary flex items-center gap-2 text-xs">
                  <Copy size={13}/>{copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
              <textarea readOnly value={textOutput} rows={20} className="w-full font-mono text-xs border border-gray-200 rounded-lg p-3 bg-gray-50"/>
            </div>
          </>
        )}
      </div>
    </div>

    <div className="border-t border-gray-100 pt-6">
      <h2 className="font-semibold text-gray-900 text-sm mb-3">Generate from Text Template</h2>
      <CustomDocPanel documentType="cdn_text" label="CDN Text"/>
    </div>
    </div>
  )
}

// ── Party's Copy Tab ──────────────────────────────────────────────────────
interface PartiesCopyCusdec extends CusdecRec { cap?: string; party_copy_url?: string }

function PartiesCopyPanel() {
  const [cusdecs, setCusdecs] = useState<PartiesCopyCusdec[]>([])
  const [cdns, setCdns] = useState<CdnRec[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [search, setSearch] = useState('')
  const [proGenerating, setProGenerating] = useState(false)
  const [status, setStatus] = useState('')
  const [entryMode, setEntryMode] = useState<'cusdec' | 'manual'>('cusdec')
  const [proPdf, setProPdf] = useState<{ base64: string; fileName: string } | null>(null)
  const [sendModalOpen, setSendModalOpen] = useState(false)
  const [savedPartyUrl, setSavedPartyUrl] = useState('')
  const [partyHistoryRefreshKey, setPartyHistoryRefreshKey] = useState(0)

  // Shown only if Sheet Routing can't resolve a Fill/Print sheet for this
  // shipper (no route matches their TIN VAT, or the routed tab was
  // deleted) — the server sends back the live tab list so the user can
  // pick instead of the generate silently guessing wrong.
  const [proSheets, setProSheets] = useState<{ title: string; sheetId: number }[]>([])
  const [proFillGid, setProFillGid] = useState('')
  const [proPrintGid, setProPrintGid] = useState('')
  const [proSheetPickNeeded, setProSheetPickNeeded] = useState(false)
  const [proSheetPickMessage, setProSheetPickMessage] = useState('')

  // A Google Sheets template saved under a "Party's Copy"-ish document_type
  // (see isPartiesCopySlug) — Generate always produces this template's PDF;
  // there's no built-in jsPDF fallback layout anymore.
  const [tplDocType, setTplDocType] = useState('')

  function load() {
    fetch('/api/list-records?table=cusdec&limit=500').then(r => r.json()).then(d => setCusdecs(d.records || [])).catch(() => {})
    fetch('/api/list-records?table=cdn&limit=500').then(r => r.json()).then(d => setCdns(d.records || [])).catch(() => {})
  }
  useEffect(() => {
    load()
    const t = setInterval(load, 20000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    async function findTemplate() {
      try {
        const h = await authHeader()
        const res = await fetch('/api/doc-templates', { headers: h })
        if (!res.ok) return
        const d = await res.json()
        const tpl = ((d.templates || []) as any[]).find(t => isPartiesCopySlug(t.document_type))
        setTplDocType(tpl?.document_type || '')
      } catch {}
    }
    findTemplate()
  }, [])

  const filtered = cusdecs.filter(c =>
    !search || c.number?.toLowerCase().includes(search.toLowerCase()) || c.exporter?.toLowerCase().includes(search.toLowerCase())
  )
  const selected = cusdecs.find(c => c.id === selectedId) || null
  const selectedCdns = selected ? cdns.filter(c => c.cusdec_number === selected.number) : []
  const capNum = Number(selected?.cap || 0)
  const cdnCount = selectedCdns.length
  // No longer blocked by CAP-mismatch or Export Release (Green/Blue) status —
  // generation should always be possible once a CUSDEC is selected. The
  // CAP/CDN-count and release-status info still shows below as a heads-up,
  // just non-blocking now.
  const eligible = !!selected
  const curIsBlue = !!selected?.export_release_passed
  const curIsGreen = !!selected && !curIsBlue && capNum > 0 && cdnCount >= capNum && selectedCdns.every(c => c.boat_note_passed)
  const curHasPartyUrl = !!(savedPartyUrl || selected?.party_copy_url)

  // "Generate Pro" — the real Party's Copy: the original CUSDEC PDF
  // (cusdec.pdf_url) followed by the filled-in template page(s), merged
  // into one PDF, CUSDEC pages first.
  async function generatePro() {
    if (!selected || !eligible || !tplDocType) return
    if (proSheetPickNeeded && (!proFillGid || !proPrintGid)) return
    setProGenerating(true); setStatus(''); setProPdf(null); setSavedPartyUrl('')
    try {
      const h = await authHeader()
      const body: Record<string, unknown> = { document_type: tplDocType, cusdec_id: selected.id }
      if (proFillGid) body.fill_sheet_gid = proFillGid
      if (proPrintGid) body.print_sheet_gid = proPrintGid
      const res = await fetch('/api/generate-parties-copy-pro', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...h },
        body: JSON.stringify(body),
      })
      const d = await res.json()
      if (!res.ok) {
        if (d.needsSheetSelection) {
          setProSheets(d.sheets || [])
          setProSheetPickNeeded(true)
          setProSheetPickMessage(d.error)
          setStatus('')
          return
        }
        throw new Error(d.error || 'Generate failed')
      }
      setProSheetPickNeeded(false)
      setProPdf({ base64: d.base64, fileName: d.fileName })
      setStatus('✓ Ready — download or send below')
    } catch (e: any) { setStatus(`✗ ${e.message}`) }
    finally { setProGenerating(false) }
  }

  function downloadProPdf() {
    if (!proPdf) return
    const bytes = Uint8Array.from(atob(proPdf.base64), c => c.charCodeAt(0))
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
    const a = document.createElement('a'); a.href = url; a.download = proPdf.fileName; a.click()
    URL.revokeObjectURL(url)
  }

  async function onSaveProModal(): Promise<{ ok: boolean; results?: SendResultFile[]; error?: string }> {
    if (!proPdf || !selected) return { ok: false, error: 'No PDF generated' }
    if (selected.party_copy_url && !window.confirm("Party's Copy link mekata dhanma save wela tiyenawa. Replace karannada?"))
      return { ok: false, error: 'Save cancelled — existing link kept as-is.' }
    try {
      const h = await authHeader()
      const dr = await fetch('/api/upload-to-drive', {
        method: 'POST', headers: { ...h, 'Content-Type': 'application/json' },
        body: JSON.stringify({ base64: proPdf.base64, fileName: proPdf.fileName, mimeType: 'application/pdf', docType: 'party_copy' }),
      })
      const dd = await dr.json()
      if (!dr.ok || !dd.driveLink) throw new Error(dd.error || 'Drive upload failed')
      const saveRes = await fetch('/api/save-parties-copy', {
        method: 'POST', headers: { ...h, 'Content-Type': 'application/json' },
        body: JSON.stringify({ cusdec_id: selected.id, drive_url: dd.driveLink, file_name: proPdf.fileName }),
      })
      const saveData = await saveRes.json()
      if (!saveRes.ok) throw new Error(saveData.error)
      setSavedPartyUrl(dd.driveLink)
      load()
      return { ok: true, results: [{ fileName: proPdf.fileName, driveLink: dd.driveLink, docType: 'party_copy' }] }
    } catch (e: any) { return { ok: false, error: e.message } }
  }
  async function onGetDriveLinksProModal(): Promise<SendResultFile[]> {
    if (savedPartyUrl && proPdf) return [{ fileName: proPdf.fileName, driveLink: savedPartyUrl, docType: 'party_copy' }]
    const res = await onSaveProModal()
    return res.results || []
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-1.5 bg-gray-100 rounded-lg p-1 w-fit">
        <button onClick={() => { setEntryMode('cusdec'); setStatus('') }}
          className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${entryMode === 'cusdec' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
          From CUSDEC
        </button>
        <button onClick={() => { setEntryMode('manual'); setStatus('') }}
          className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${entryMode === 'manual' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
          Manual Entry
        </button>
      </div>

      {entryMode === 'manual' ? (
        tplDocType
          ? <CustomDocPanel documentType={tplDocType} label="Party's Copy"/>
          : <p className="text-xs text-amber-600 flex items-center gap-1"><AlertTriangle size={12}/>No Party's Copy template configured yet — set one up in Templates first.</p>
      ) : (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
      <div className="card xl:col-span-1">
        <h2 className="font-semibold text-gray-900 text-sm mb-3">Select CUSDEC</h2>
        <div className="relative mb-3">
          <Search size={14} className="absolute left-2.5 top-2.5 text-gray-400"/>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search number or exporter..."
            className="w-full pl-8 pr-3 py-2 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-purple-400"/>
        </div>
        <div className="space-y-1 max-h-96 overflow-y-auto">
          {filtered.map(c => {
            const cCount = cdns.filter(d => d.cusdec_number === c.number).length
            const cap = Number(c.cap || 0)
            const ok = cap > 0 && cap === cCount && !c.export_release_passed
            return (
              <button key={c.id} onClick={() => { setSelectedId(c.id); setStatus(''); setProSheetPickNeeded(false); setProFillGid(''); setProPrintGid('') }}
                className={`w-full text-left p-2.5 rounded-lg border text-xs ${selectedId === c.id ? 'bg-purple-50 border-purple-300' : 'border-gray-100 hover:bg-gray-50'}`}>
                <p className="font-bold text-gray-800">E {c.number}</p>
                <p className="text-gray-600 truncate">{c.exporter?.slice(0, 36)}</p>
                <p className={`text-[10px] mt-0.5 ${ok ? 'text-green-600' : 'text-gray-400'}`}>
                  CAP {c.cap || '?'} / CDN {cCount} {ok ? '✓ eligible' : ''}
                </p>
              </button>
            )
          })}
          {filtered.length === 0 && <p className="text-xs text-gray-400 text-center py-6">No CUSDECs found</p>}
        </div>
      </div>

      <div className="xl:col-span-2">
        {!selected ? (
          <div className="card text-center py-16 text-gray-400 text-sm">Select a CUSDEC to generate its Party's Copy</div>
        ) : (
          <div className="space-y-4">
            <div className="card">
              <h3 className="font-semibold text-gray-900 text-sm mb-3">E {selected.number} — {selected.exporter?.slice(0, 50)}</h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs mb-4">
                <div><p className="text-gray-400">Vessel</p><p className="font-medium">{selected.vessel || '—'}</p></div>
                <div><p className="text-gray-400">Voyage</p><p className="font-medium">{selected.voyage_no || '—'}</p></div>
                <div><p className="text-gray-400">CAP</p><p className="font-medium">{selected.cap || '—'}</p></div>
                <div><p className="text-gray-400">CDN Count</p><p className={`font-medium ${capNum === cdnCount && capNum > 0 ? 'text-green-600' : 'text-amber-600'}`}>{cdnCount}</p></div>
                <div><p className="text-gray-400">Gross Mass</p><p className="font-medium">{selected.gross_mass || '—'}</p></div>
                <div><p className="text-gray-400">Discharge Port</p><p className="font-medium">{selected.discharge_port || '—'}</p></div>
              </div>

              {(capNum === 0 || capNum !== cdnCount || selected.export_release_passed) && (
                <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700 mb-4">
                  <AlertTriangle size={13} className="mt-0.5 flex-shrink-0"/>
                  <div>
                    {capNum === 0 && <p>CAP not set on this CUSDEC.</p>}
                    {capNum > 0 && capNum !== cdnCount && <p>CAP ({capNum}) ≠ CDN count ({cdnCount}) — generating anyway.</p>}
                    {selected.export_release_passed && <p>Export release already passed — generating anyway.</p>}
                  </div>
                </div>
              )}

              {selectedCdns.length > 0 && (
                <div className="mb-4">
                  <p className="text-xs font-medium text-gray-600 mb-2">Containers ({cdnCount})</p>
                  <div className="space-y-1 max-h-40 overflow-y-auto">
                    {selectedCdns.map((cdn, i) => (
                      <div key={cdn.id} className="flex items-center gap-3 text-xs py-1 border-t border-gray-50">
                        <span className="text-gray-400 w-4">{i + 1}.</span>
                        <span className="font-medium text-gray-800">{cdn.container_no || '—'}</span>
                        <span className="text-gray-500">CDN {cdn.cdn_no}</span>
                        <span className="text-gray-400">{cdn.gross_mass} Kg</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {status && <p className={`text-xs mb-3 font-medium ${status.startsWith('✓') ? 'text-green-600' : 'text-red-600'}`}>{status}</p>}

              {!tplDocType && (
                <p className="text-xs text-amber-600 flex items-center gap-1 mb-2">
                  <AlertTriangle size={12}/>No Party's Copy template configured yet — set one up in Templates first.
                </p>
              )}

              <button onClick={generatePro} disabled={!eligible || proGenerating || !tplDocType}
                className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm text-white font-medium disabled:opacity-40"
                style={{ background: '#1B3A5C' }}>
                {proGenerating ? <Loader size={14} className="animate-spin"/> : <FileDown size={14}/>}
                Generate Pro
              </button>
              <p className="text-[11px] text-gray-400 mt-2">Merges the original CUSDEC PDF with the template output (CUSDEC pages first).</p>

              {proSheetPickNeeded && (
                <SheetPickerModal
                  message={proSheetPickMessage}
                  sheets={proSheets}
                  fillGid={proFillGid}
                  printGid={proPrintGid}
                  onFillChange={setProFillGid}
                  onPrintChange={setProPrintGid}
                  onConfirm={generatePro}
                  onClose={() => setProSheetPickNeeded(false)}
                  busy={proGenerating}
                />
              )}

              {proPdf && (
                <div className="mt-3 pt-3 border-t border-gray-100 space-y-2">
                  <div className="flex gap-2">
                    <button onClick={downloadProPdf}
                      className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm text-white font-medium" style={{ background: '#1B3A5C' }}>
                      <FileDown size={14}/> Download
                    </button>
                    <button onClick={() => setSendModalOpen(true)}
                      className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium border border-gray-200 text-gray-700 hover:bg-gray-50">
                      <Send size={14}/> Send
                    </button>
                  </div>
                  {curHasPartyUrl && (
                    <p className="text-xs text-green-600 flex items-center gap-1">
                      <CheckCircle size={13}/>Saved{" "}
                      <a href={savedPartyUrl || selected?.party_copy_url} target="_blank" rel="noreferrer" className="underline ml-1">View in Drive</a>
                    </p>
                  )}
                </div>
              )}

              {sendModalOpen && proPdf && (
                <SendModal
                  label={proPdf.fileName}
                  docType="party_copy"
                  onSave={onSaveProModal}
                  onGetDriveLinks={onGetDriveLinksProModal}
                  onClose={() => setSendModalOpen(false)}
                  onDone={() => { setSendModalOpen(false); setPartyHistoryRefreshKey(k => k + 1) }}
                  notifyDisabled={curIsGreen || curIsBlue || curHasPartyUrl}
                  notifyDisabledReason={
                    curHasPartyUrl ? "Already saved — Notify isn't available for a replace." :
                    (curIsGreen || curIsBlue) ? 'Notify is not available once this CUSDEC is Green/Blue.' : undefined
                  }
                />
              )}

              <GenerationHistoryPanel documentType="party_copy" refreshKey={partyHistoryRefreshKey}/>
            </div>
          </div>
        )}
      </div>
    </div>
      )}
    </div>
  )
}

// ── Custom Doc Type Panel — dynamically-added tab for any document_type
// created via Templates → "+ Add New Document Type". Manual field entry
// only (no CUSDEC link), generates the Google Sheets template PDF, and
// only offers Download/Send — there's no CUSDEC record to save a Drive
// link against, same reasoning as the Boat Note tab's Manual Entry mode.
interface TemplateDocCusdec { id: string; number: string; exporter: string; code?: string; export_release_passed?: boolean; cap?: string }

// ── Trico Gate Pass ───────────────────────────────────────────────────────
// Phase 1 (per explicit scope): the Template (After-Login URL + field
// mappings, see templates.tsx's 'trico_gate_pass' format) and this queue/
// preview UI. Picks CDNs in order, one at a time, resolves this document
// type's field mappings against each CDN's (and its parent CUSDEC's) real
// data, and previews exactly what would be typed into each Trico form
// field. The actual login + autofill (a real headless-browser step) and
// the final Submit action are a separate, later phase — deliberately not
// built here, so nothing on this tab can accidentally submit a real gate
// pass to Trico.
interface TricoCdnRec { id: string; code: string; cusdec_number: string; container_no: string; [k: string]: any }
interface TricoMapping { field_label: string; data_source: 'cusdec' | 'cdn' | 'manual'; column_name: string; target_cell_or_range: string }
interface TricoCredential { id: string; identity_name: string; username: string | null }

function TricoGatePassPanel({ documentType, label }: { documentType: string; label: string }) {
  const [afterLoginUrl, setAfterLoginUrl] = useState('')
  const [mappings, setMappings] = useState<TricoMapping[]>([])
  const [tplLoadError, setTplLoadError] = useState('')
  const [credentials, setCredentials] = useState<TricoCredential[]>([])
  const [credentialId, setCredentialId] = useState('')
  const [cdns, setCdns] = useState<TricoCdnRec[]>([])
  const [cusdecs, setCusdecs] = useState<any[]>([])
  const [search, setSearch] = useState('')
  const [queue, setQueue] = useState<string[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)

  useEffect(() => {
    async function load() {
      setTplLoadError('')
      try {
        const h = await authHeader()
        const res = await fetch('/api/doc-templates', { headers: h })
        const d = await res.json()
        const tpl = (d.templates || []).find((t: any) => t.document_type === documentType)
        if (!tpl) { setTplLoadError('No template configured for this document type yet'); return }
        setAfterLoginUrl(tpl.template_url || '')
        setMappings((tpl.template_mappings || []).filter((m: any) => m.target_cell_or_range))
      } catch (e: any) {
        setTplLoadError(e.message || 'Failed to load template')
      }
    }
    load()
    fetch('/api/list-records?table=cdn&limit=500').then(r => r.json()).then(d => setCdns(d.records || [])).catch(() => {})
    fetch('/api/list-records?table=cusdec&limit=500').then(r => r.json()).then(d => setCusdecs(d.records || [])).catch(() => {})
    authHeader().then(h => fetch('/api/automation-credentials', { headers: h })).then(r => r.json())
      .then(d => setCredentials((d.credentials || []).filter((c: TricoCredential) => c.identity_name === 'Trico'))).catch(() => {})
  }, [documentType])

  const filteredCdns = cdns.filter(c =>
    !queue.includes(c.id) && search.trim() &&
    (c.container_no?.toLowerCase().includes(search.toLowerCase()) || c.cusdec_number?.toLowerCase().includes(search.toLowerCase()))
  ).slice(0, 8)

  function addToQueue(id: string) { setQueue(prev => prev.includes(id) ? prev : [...prev, id]); setSearch('') }
  function removeFromQueue(id: string) {
    setQueue(prev => prev.filter(x => x !== id))
    setCurrentIndex(i => Math.min(i, Math.max(0, queue.length - 2)))
  }

  const currentCdn = queue.length ? cdns.find(c => c.id === queue[currentIndex]) : null
  const currentCusdec = currentCdn ? cusdecs.find(c => c.code === currentCdn.code && c.number === currentCdn.cusdec_number) : null

  const preview = currentCdn ? mappings.map(m => {
    let value = ''
    if (m.data_source === 'cdn') value = currentCdn[m.column_name] ?? ''
    else if (m.data_source === 'cusdec') value = currentCusdec ? (currentCusdec[m.column_name] ?? '') : ''
    return { field_label: m.field_label, form_field: m.target_cell_or_range, value: m.data_source === 'manual' ? '(typed at run time)' : String(value) }
  }) : []

  return (
    <div className="space-y-4">
      <p className="text-gray-500 text-sm -mt-2">{label} — picks CDNs one at a time and previews the values that would be typed into each Trico form field. Login + auto-fill isn't wired up yet; this only shows what will be sent once it is.</p>

      {tplLoadError && <p className="text-xs text-amber-600 flex items-center gap-1"><AlertTriangle size={12}/>{tplLoadError}</p>}
      {afterLoginUrl && <p className="text-[11px] text-gray-400">After-login URL: <span className="font-mono">{afterLoginUrl}</span></p>}

      <div className="card max-w-xl">
        <h2 className="font-semibold text-gray-900 text-sm mb-3">Trico Login</h2>
        <select value={credentialId} onChange={e => setCredentialId(e.target.value)} className="input text-sm w-full">
          <option value="">— select credential —</option>
          {credentials.map(c => <option key={c.id} value={c.id}>{c.username || c.identity_name}</option>)}
        </select>
        {credentials.length === 0 && <p className="text-[11px] text-amber-600 mt-1.5">No Trico credentials saved — add one under Settings &gt; Credentials first.</p>}
      </div>

      <div className="card max-w-xl">
        <h2 className="font-semibold text-gray-900 text-sm mb-3">Containers (in order)</h2>
        <div className="relative mb-3">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400"/>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search container or CUSDEC no..."
            className="w-full pl-8 pr-3 py-2 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-400"/>
        </div>
        {filteredCdns.length > 0 && (
          <div className="border border-gray-100 rounded-lg divide-y divide-gray-50 max-h-40 overflow-y-auto mb-3">
            {filteredCdns.map(c => (
              <button key={c.id} onClick={() => addToQueue(c.id)} className="w-full flex items-center justify-between px-2.5 py-1.5 text-xs hover:bg-gray-50 text-left">
                <span>{c.container_no} — CUSDEC {c.cusdec_number}</span>
                <Plus size={13} className="text-blue-600 flex-shrink-0"/>
              </button>
            ))}
          </div>
        )}
        {queue.length > 0 && (
          <div className="space-y-1">
            {queue.map((id, idx) => {
              const c = cdns.find(x => x.id === id)
              return (
                <div key={id} className={`flex items-center justify-between text-xs border rounded-lg p-2 ${idx === currentIndex ? 'border-blue-300 bg-blue-50' : 'border-gray-100'}`}>
                  <span>{idx + 1}. {c?.container_no || id}</span>
                  <button onClick={() => removeFromQueue(id)} className="text-gray-300 hover:text-red-500"><X size={13}/></button>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {currentCdn && (
        <div className="card max-w-xl">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-900 text-sm">Field Preview — {currentCdn.container_no} ({currentIndex + 1}/{queue.length})</h2>
            <button onClick={() => setCurrentIndex(i => Math.min(i + 1, queue.length - 1))} disabled={currentIndex >= queue.length - 1}
              className="text-xs text-blue-600 hover:underline disabled:opacity-40 disabled:no-underline">Next Container →</button>
          </div>
          {preview.length === 0 ? (
            <p className="text-xs text-gray-400">No field mappings configured yet — set them up in Templates.</p>
          ) : (
            <div className="space-y-1">
              {preview.map((p, i) => (
                <div key={i} className="flex items-center justify-between text-xs border border-gray-100 rounded-lg p-2">
                  <span className="text-gray-500">{p.field_label} <span className="text-gray-300">({p.form_field})</span></span>
                  <span className="font-medium text-gray-800 truncate max-w-[200px]">{p.value || '—'}</span>
                </div>
              ))}
            </div>
          )}
          <button disabled className="mt-3 w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm text-white font-medium opacity-40 cursor-not-allowed" style={{ background: '#3b82f6' }}>
            Submit to Trico — not connected yet
          </button>
        </div>
      )}
    </div>
  )
}

function CustomDocPanel({ documentType, label }: { documentType: string; label: string }) {
  const [tplFields, setTplFields] = useState<{ field_label: string; is_repeating: boolean }[]>([])
  const [tplLoadError, setTplLoadError] = useState('')
  const [formValues, setFormValues] = useState<Record<string, string[]>>({})
  const [generating, setGenerating] = useState(false)
  const [status, setStatus] = useState('')
  const [pdf, setPdf] = useState<{ base64: string; fileName: string; mimeType?: string; content?: string } | null>(null)
  const [sendModalOpen, setSendModalOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0)

  // "Database" (from a selected CUSDEC) vs. "Manual Entry" (typed by hand) —
  // same toggle Boat Note/Party's Copy already have. Database mode still
  // needs tplFields loaded (for is_repeating hints etc.) but drives values
  // from the picked CUSDEC via cusdec_id instead of manual_values.
  const [entryMode, setEntryMode] = useState<'cusdec' | 'manual'>('manual')
  const [cusdecs, setCusdecs] = useState<TemplateDocCusdec[]>([])
  const [cdns, setCdns] = useState<CdnRec[]>([])
  const [cusdecSearch, setCusdecSearch] = useState('')
  const [selectedCusdecId, setSelectedCusdecId] = useState('')

  // Already-saved link for (selected CUSDEC, this document_type) — see
  // /api/document-link.ts. Drives the "already saved, replace?" confirm and
  // the Notify lock, same rules as Boat Note/Party's Copy.
  const [savedLink, setSavedLink] = useState('')

  // Manual Entry has no CUSDEC to route Fill/Print sheet by TIN VAT — ask
  // directly instead, for any template that's Google-Sheet-based.
  const [manualSheets, setManualSheets] = useState<{ title: string; sheetId: number }[]>([])
  const [fillSheetGid, setFillSheetGid] = useState('')
  const [printSheetGid, setPrintSheetGid] = useState('')

  // Database mode normally routes Fill/Print sheet by the CUSDEC's TIN VAT
  // automatically — this only turns on if that routing can't resolve a
  // sheet for the selected shipper (no route configured for them, or their
  // routed tab was deleted), so the same Fill/Print picker as Manual Entry
  // is reused rather than silently guessing a sheet.
  const [cusdecNeedsSheetPick, setCusdecNeedsSheetPick] = useState(false)
  const [sheetPickMessage, setSheetPickMessage] = useState('')

  useEffect(() => {
    async function load() {
      setTplLoadError('')
      try {
        const h = await authHeader()
        const res = await fetch('/api/doc-templates', { headers: h })
        if (!res.ok) { setTplLoadError(`Failed to load template (HTTP ${res.status})`); return }
        const d = await res.json()
        const tpl = (d.templates || []).find((t: any) => t.document_type === documentType)
        if (!tpl) { setTplLoadError('No template configured for this document type yet'); return }
        const fields = (tpl.template_mappings || []).map((m: any) => ({ field_label: m.field_label, is_repeating: !!m.is_repeating }))
        setTplFields(fields)
        const init: Record<string, string[]> = {}
        fields.forEach((f: { field_label: string }) => { init[f.field_label] = [''] })
        setFormValues(init)

        if ((tpl.template_format || 'google_sheet') === 'google_sheet' && tpl.template_url) {
          const sr = await fetch('/api/excel-template-sheets?sheet_url=' + encodeURIComponent(tpl.template_url), { headers: h })
          const sd = await sr.json()
          setManualSheets(sd.sheets || [])
        }
      } catch (e: any) {
        setTplLoadError(e.message || 'Failed to load template')
      }
    }
    load()
  }, [documentType])

  useEffect(() => {
    if (entryMode !== 'cusdec' || cusdecs.length) return
    fetch('/api/list-records?table=cusdec&limit=500').then(r => r.json()).then(d => setCusdecs(d.records || [])).catch(() => {})
    fetch('/api/list-records?table=cdn&limit=1000').then(r => r.json()).then(d => setCdns(d.records || [])).catch(() => {})
  }, [entryMode]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setSavedLink('')
    setCusdecNeedsSheetPick(false)
    setFillSheetGid('')
    setPrintSheetGid('')
    if (entryMode !== 'cusdec' || !selectedCusdecId) return
    authHeader().then(h => fetch(`/api/document-link?cusdec_id=${selectedCusdecId}&document_type=${encodeURIComponent(documentType)}`, { headers: h }))
      .then(r => r.json()).then(d => setSavedLink(d.link?.drive_url || '')).catch(() => {})
  }, [entryMode, selectedCusdecId, documentType])

  const filteredCusdecs = cusdecs.filter(c =>
    !cusdecSearch || c.number?.toLowerCase().includes(cusdecSearch.toLowerCase()) || c.exporter?.toLowerCase().includes(cusdecSearch.toLowerCase())
  )
  const selectedCusdec = cusdecs.find(c => c.id === selectedCusdecId) || null
  const selectedCdns = selectedCusdec ? cdns.filter(c => c.code === selectedCusdec.code && c.cusdec_number === selectedCusdec.number) : []
  const capNum = Number(selectedCusdec?.cap || 0)
  const cdnCount = selectedCdns.length
  const curIsBlue = !!selectedCusdec?.export_release_passed
  const curIsGreen = !!selectedCusdec && !curIsBlue && capNum > 0 && cdnCount >= capNum && selectedCdns.every(c => c.boat_note_passed)

  const manualSheetChoiceRequired = entryMode === 'manual' && manualSheets.length > 0
  const sheetPickerVisible = manualSheetChoiceRequired || (entryMode === 'cusdec' && cusdecNeedsSheetPick)
  const manualSheetChoiceMissing = sheetPickerVisible && (!fillSheetGid || !printSheetGid)

  async function generate() {
    if (entryMode === 'cusdec' && !selectedCusdecId) return
    if (manualSheetChoiceMissing) return
    setGenerating(true); setStatus(''); setPdf(null)
    try {
      const h = await authHeader()
      const body: Record<string, unknown> = { document_type: documentType }
      if (entryMode === 'cusdec') {
        body.cusdec_id = selectedCusdecId
      } else {
        const manual: Record<string, string> = {}
        Object.entries(formValues).forEach(([lbl, rows]) => { manual[lbl] = rows.join('\n') })
        body.manual_values = manual
      }
      if (fillSheetGid) body.fill_sheet_gid = fillSheetGid
      if (printSheetGid) body.print_sheet_gid = printSheetGid
      const res = await fetch('/api/doc-generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...h },
        body: JSON.stringify(body),
      })
      const d = await res.json()
      if (!res.ok) {
        if (d.needsSheetSelection) {
          setManualSheets(d.sheets || [])
          setCusdecNeedsSheetPick(true)
          setSheetPickMessage(d.error)
          setStatus('')
          return
        }
        throw new Error(d.error || 'Generate failed')
      }
      setCusdecNeedsSheetPick(false)
      setPdf({ base64: d.base64, fileName: d.fileName, mimeType: d.mimeType, content: d.content })
      setCopied(false)
      setStatus('✓ Ready — download or send below')
    } catch (e: any) { setStatus(`✗ ${e.message}`) }
    finally { setGenerating(false) }
  }

  function downloadPdf() {
    if (!pdf) return
    const bytes = Uint8Array.from(atob(pdf.base64), c => c.charCodeAt(0))
    const url = URL.createObjectURL(new Blob([bytes], { type: pdf.mimeType || 'application/pdf' }))
    const a = document.createElement('a'); a.href = url; a.download = pdf.fileName; a.click()
    URL.revokeObjectURL(url)
  }

  function copyContent() {
    if (!pdf?.content) return
    navigator.clipboard.writeText(pdf.content).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) })
  }

  async function onSaveModal(): Promise<{ ok: boolean; results?: SendResultFile[]; error?: string }> {
    if (!pdf) return { ok: false, error: 'No PDF generated' }
    if (entryMode === 'cusdec' && savedLink && !window.confirm(`${label} eka mekata dhanma save wela tiyenawa. Replace karannada?`))
      return { ok: false, error: 'Save cancelled — existing link kept as-is.' }
    try {
      const h = await authHeader()
      const dr = await fetch('/api/upload-to-drive', {
        method: 'POST', headers: { ...h, 'Content-Type': 'application/json' },
        body: JSON.stringify({ base64: pdf.base64, fileName: pdf.fileName, mimeType: pdf.mimeType || 'application/pdf', docType: documentType }),
      })
      const dd = await dr.json()
      if (!dr.ok || !dd.driveLink) throw new Error(dd.error || 'Drive upload failed')

      if (entryMode === 'cusdec' && selectedCusdecId) {
        const lr = await fetch('/api/document-link', {
          method: 'POST', headers: { ...h, 'Content-Type': 'application/json' },
          body: JSON.stringify({ cusdec_id: selectedCusdecId, document_type: documentType, drive_url: dd.driveLink, file_name: pdf.fileName }),
        })
        if (!lr.ok) throw new Error((await lr.json()).error || 'Could not record the saved link')
        setSavedLink(dd.driveLink)
      }

      return { ok: true, results: [{ fileName: pdf.fileName, driveLink: dd.driveLink, docType: documentType }] }
    } catch (e: any) { return { ok: false, error: e.message } }
  }
  async function onGetDriveLinksModal(): Promise<SendResultFile[]> {
    const res = await onSaveModal()
    return res.results || []
  }

  return (
    <div className="space-y-4">
      <p className="text-gray-500 text-sm -mt-2">{label} — generate from a CUSDEC's data or fill the template fields by hand, then download or send. Not saved to the system.</p>

      <div className="flex gap-1.5 bg-gray-100 rounded-lg p-1 w-fit">
        <button onClick={() => { setEntryMode('cusdec'); setPdf(null); setStatus('') }}
          className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${entryMode === 'cusdec' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
          Database
        </button>
        <button onClick={() => { setEntryMode('manual'); setPdf(null); setStatus('') }}
          className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${entryMode === 'manual' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
          Manual Entry
        </button>
      </div>

      {entryMode === 'cusdec' && (
        <div className="card max-w-xl">
          <h2 className="font-semibold text-gray-900 text-sm mb-3">Select CUSDEC</h2>
          <div className="relative mb-3">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400"/>
            <input value={cusdecSearch} onChange={e => setCusdecSearch(e.target.value)} placeholder="Search number or exporter..."
              className="w-full pl-8 pr-3 py-2 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-400"/>
          </div>
          <div className="space-y-1 max-h-64 overflow-y-auto mb-3">
            {filteredCusdecs.map(c => (
              <button key={c.id} onClick={() => setSelectedCusdecId(c.id)}
                className={`w-full text-left p-2.5 rounded-lg border text-xs ${selectedCusdecId === c.id ? 'bg-blue-50 border-blue-300' : 'border-gray-100 hover:bg-gray-50'}`}>
                <p className="font-bold text-gray-800">E {c.number}</p>
                <p className="text-gray-600 truncate">{c.exporter}</p>
              </button>
            ))}
            {filteredCusdecs.length === 0 && <p className="text-xs text-gray-400 text-center py-6">No CUSDECs found</p>}
          </div>
          <button onClick={generate} disabled={generating || !selectedCusdecId}
            className="flex items-center justify-center gap-2 w-full py-2.5 rounded-lg text-sm text-white font-medium disabled:opacity-40"
            style={{ background: '#3b82f6' }}>
            {generating ? <Loader size={14} className="animate-spin"/> : <FileDown size={14}/>}
            Generate {label}
          </button>
        </div>
      )}

      {cusdecNeedsSheetPick && (
        <SheetPickerModal
          message={sheetPickMessage}
          sheets={manualSheets}
          fillGid={fillSheetGid}
          printGid={printSheetGid}
          onFillChange={setFillSheetGid}
          onPrintChange={setPrintSheetGid}
          onConfirm={generate}
          onClose={() => setCusdecNeedsSheetPick(false)}
          busy={generating}
        />
      )}

      {entryMode === 'manual' && manualSheets.length > 0 && (
        <div className="card max-w-xl">
          <h2 className="font-semibold text-gray-900 text-sm mb-3">Fill Sheet &amp; Print Sheet</h2>
          <p className="text-xs text-gray-400 mb-3">No CUSDEC to auto-route by — pick which sheet tab to fill and which to print.</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Fill Sheet</label>
              <select value={fillSheetGid} onChange={e => setFillSheetGid(e.target.value)} className="input text-xs w-full">
                <option value="">— select —</option>
                {manualSheets.map(s => <option key={s.sheetId} value={s.sheetId}>{s.title}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Print Sheet</label>
              <select value={printSheetGid} onChange={e => setPrintSheetGid(e.target.value)} className="input text-xs w-full">
                <option value="">— select —</option>
                {manualSheets.map(s => <option key={s.sheetId} value={s.sheetId}>{s.title}</option>)}
              </select>
            </div>
          </div>
        </div>
      )}

      {entryMode === 'manual' && (
      <div className="card max-w-xl">
        <h2 className="font-semibold text-gray-900 text-sm mb-3">Fill Template Fields</h2>
        {tplLoadError ? (
          <p className="text-xs text-red-500 flex items-center gap-1"><AlertTriangle size={12}/>{tplLoadError}</p>
        ) : tplFields.length === 0 ? (
          <p className="text-xs text-gray-400">Loading template fields…</p>
        ) : (
          <div className="space-y-3">
            {tplFields.map(f => {
              const rows = formValues[f.field_label] || ['']
              return (
                <div key={f.field_label}>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-medium text-gray-600">{f.field_label}</label>
                    {f.is_repeating && (
                      <button onClick={() => setFormValues(p => ({ ...p, [f.field_label]: [...(p[f.field_label] || ['']), ''] }))}
                        className="flex items-center gap-1 text-[11px] text-blue-600 hover:underline">
                        <Plus size={11}/>Add Row
                      </button>
                    )}
                  </div>
                  {f.is_repeating ? (
                    <div className="space-y-1.5">
                      {rows.map((val, ri) => (
                        <div key={ri} className="flex gap-1.5">
                          <input value={val} onChange={e => setFormValues(p => {
                              const arr = [...(p[f.field_label] || [])]; arr[ri] = e.target.value
                              return { ...p, [f.field_label]: arr }
                            })} className="input text-xs flex-1" placeholder={`Row ${ri + 1}`}/>
                          {rows.length > 1 && (
                            <button onClick={() => setFormValues(p => ({ ...p, [f.field_label]: (p[f.field_label] || []).filter((_, ii) => ii !== ri) }))}
                              className="text-gray-300 hover:text-red-500"><X size={13}/></button>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <input value={rows[0] || ''} onChange={e => setFormValues(p => ({ ...p, [f.field_label]: [e.target.value] }))} className="input text-xs w-full"/>
                  )}
                </div>
              )
            })}
            <button onClick={generate} disabled={generating || manualSheetChoiceMissing}
              className="flex items-center justify-center gap-2 w-full py-2.5 rounded-lg text-sm text-white font-medium disabled:opacity-40 mt-1"
              style={{ background: '#3b82f6' }}>
              {generating ? <Loader size={14} className="animate-spin"/> : <FileDown size={14}/>}
              Generate {label}
            </button>
            {manualSheetChoiceMissing && <p className="text-[11px] text-amber-600 mt-1">Pick Fill Sheet and Print Sheet above first.</p>}
          </div>
        )}
      </div>
      )}

      {status && <p className={`text-xs font-medium ${status.startsWith('✓') ? 'text-green-600' : 'text-red-600'}`}>{status}</p>}

      {pdf && (
        <div className="card max-w-xl space-y-3">
          <div className="flex gap-2">
            <button onClick={downloadPdf}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm text-white font-medium" style={{ background: '#1B3A5C' }}>
              <FileDown size={14}/> Download
            </button>
            <button onClick={() => setSendModalOpen(true)}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium border border-gray-200 text-gray-700 hover:bg-gray-50">
              <Send size={14}/> Send
            </button>
          </div>

          {/* XML/Text templates also get a copy/paste preview, matching CDN Text tab's UX */}
          {pdf.content && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-medium text-gray-600">Text Output</label>
                <button onClick={copyContent} className="btn-secondary flex items-center gap-1.5 text-[11px] px-2 py-1">
                  <Copy size={12}/>{copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
              <textarea readOnly value={pdf.content} rows={10} className="w-full font-mono text-xs border border-gray-200 rounded-lg p-3 bg-gray-50"/>
            </div>
          )}

          {entryMode === 'cusdec' && savedLink && (
            <p className="text-xs text-green-600 flex items-center gap-1">
              <CheckCircle size={13}/>Saved!{" "}
              <a href={savedLink} target="_blank" rel="noreferrer" className="underline ml-1">View in Drive</a>
            </p>
          )}
        </div>
      )}

      {sendModalOpen && pdf && (
        <SendModal
          label={pdf.fileName}
          docType={documentType}
          onSave={onSaveModal}
          onGetDriveLinks={onGetDriveLinksModal}
          onClose={() => setSendModalOpen(false)}
          onDone={() => { setSendModalOpen(false); setHistoryRefreshKey(k => k + 1) }}
          notifyDisabled={entryMode === 'cusdec' && (curIsGreen || curIsBlue || !!savedLink)}
          notifyDisabledReason={
            entryMode !== 'cusdec' ? undefined :
            savedLink ? "Already saved — Notify isn't available for a replace." :
            (curIsGreen || curIsBlue) ? 'Notify is not available once this CUSDEC is Green/Blue.' : undefined
          }
        />
      )}

      <GenerationHistoryPanel documentType={documentType} refreshKey={historyRefreshKey}/>
    </div>
  )
}

// ── Recent Generations — shared history panel, added to every doc-generating
// tab (CustomDocPanel covers Invoice/Packing List/Cusdec XML/CDN Text/CO/
// Phyto/Party's Copy Manual/any custom type; Boat Note and Party's Copy's
// From-CUSDEC mode render it directly). Reuses uploaded_documents (already
// populated by SendModal's Save tick — see document-uploads.ts) rather than
// a new table: a generation only shows up here once actually saved via
// Send, not on every raw/test Generate click.
interface HistoryDoc { id: string; doc_type: string; file_name: string; drive_url: string; created_at: string }

function GenerationHistoryPanel({ documentType, refreshKey }: { documentType: string; refreshKey?: number }) {
  const [items, setItems] = useState<HistoryDoc[]>([])
  const [loading, setLoading] = useState(true)
  const [copyingId, setCopyingId] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [mailItem, setMailItem] = useState<HistoryDoc | null>(null)
  const hasLoadedOnce = useRef(false)

  useEffect(() => {
    if (!documentType) return
    async function load() {
      if (!hasLoadedOnce.current) setLoading(true)
      try {
        const h = await authHeader()
        const res = await fetch(`/api/list-documents?doc_type=${encodeURIComponent(documentType)}&limit=20`, { headers: h })
        const d = await res.json()
        setItems(d.records || [])
      } catch {} finally { setLoading(false); hasLoadedOnce.current = true }
    }
    load()
    // Also poll — covers a Save that happened elsewhere (another tab/user)
    // without needing a manual refresh, on top of the immediate refreshKey
    // bump right after this tab's own Send finishes.
    const t = setInterval(load, 20000)
    return () => clearInterval(t)
  }, [documentType, refreshKey])

  const isTextFile = (fileName: string) => /\.(txt|xml)$/i.test(fileName)

  async function deleteItem(item: HistoryDoc) {
    if (!window.confirm(`Delete "${item.file_name}"? This removes it from Drive and unlinks it from the database — it can't be undone.`)) return
    setDeletingId(item.id)
    try {
      const h = await authHeader()
      const res = await fetch('/api/delete-generation', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...h },
        body: JSON.stringify({ document_id: item.id }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Delete failed')
      setItems(prev => prev.filter(i => i.id !== item.id))
    } catch (e: any) {
      window.alert(e.message)
    } finally {
      setDeletingId(null)
    }
  }

  async function copyItem(item: HistoryDoc) {
    setCopyingId(item.id)
    try {
      const h = await authHeader()
      const res = await fetch(`/api/fetch-drive-text?drive_url=${encodeURIComponent(item.drive_url)}`, { headers: h })
      const d = await res.json()
      if (res.ok) { await navigator.clipboard.writeText(d.content); setCopiedId(item.id); setTimeout(() => setCopiedId(null), 2000) }
    } catch {} finally { setCopyingId(null) }
  }

  if (!documentType || loading || items.length === 0) return null

  return (
    <div className="card max-w-xl">
      <h2 className="font-semibold text-gray-900 text-sm mb-3">Recent Generations</h2>
      <div className="space-y-1.5 max-h-72 overflow-y-auto">
        {items.map(item => (
          <div key={item.id} className="flex items-center justify-between text-xs border border-gray-100 rounded-lg p-2">
            <div className="min-w-0">
              <p className="font-medium text-gray-800 truncate">{item.file_name}</p>
              <p className="text-gray-400">{new Date(item.created_at).toLocaleString('en-GB')}</p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0 ml-2">
              <a href={item.drive_url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline" title="View">View</a>
              <a href={item.drive_url} download={item.file_name} className="text-blue-600 hover:underline" title="Download"><Download size={13}/></a>
              <button onClick={() => setMailItem(item)} className="text-blue-600 hover:underline" title="Mail"><Mail size={13}/></button>
              {isTextFile(item.file_name) && (
                <button onClick={() => copyItem(item)} disabled={copyingId === item.id} className="text-blue-600 hover:underline disabled:opacity-50">
                  {copyingId === item.id ? '…' : copiedId === item.id ? 'Copied!' : 'Copy'}
                </button>
              )}
              <button onClick={() => deleteItem(item)} disabled={deletingId === item.id} className="text-gray-300 hover:text-red-500 disabled:opacity-50" title="Delete">
                {deletingId === item.id ? <Loader size={13} className="animate-spin"/> : <Trash2 size={13}/>}
              </button>
            </div>
          </div>
        ))}
      </div>
      {mailItem && (
        <EmailPdfModal
          attachments={[{ filename: mailItem.file_name, url: mailItem.drive_url }]}
          onClose={() => setMailItem(null)}
        />
      )}
    </div>
  )
}
