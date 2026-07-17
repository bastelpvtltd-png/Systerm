import { useState, useEffect, useRef } from 'react'
import AdminLayout, { usePermission } from '@/components/admin/AdminLayout'
import { authHeader } from '@/lib/supabase'
import { Anchor, Loader, RefreshCw, CheckSquare, Square, FileDown, Mail, FileStack, Receipt, Package, Plus, X, Clock, ClipboardCheck, Search, FileCode, ScanText, Copy, Save, Download, AlertTriangle, CheckCircle, Send } from 'lucide-react'
import SendModal, { type SendResultFile } from '@/components/admin/SendModal'
import { emptyXmlValues, buildAsycudaXml, type XmlValues } from '@/lib/asycudaXml'

// Custom document types (from Templates → "+ Add New Document Type") get a
// dynamically-added tab id of the form `custom:${document_type}` — string
// keeps that open-ended rather than a fixed union.
type DocsCreateTab = 'invoice' | 'packing-list' | 'boat-note' | 'done-boat-note' | 'cusdec-xml' | 'cdn-text' | 'parties-copy' | string

interface CusdecRec { id: string; code?: string; number: string; exporter: string; consignee: string; vessel: string; voyage_no: string; bl_no: string; gross_mass: string; net_mass: string; discharge_port: string; location_of_goods: string; created_at: string; cap?: string; export_release_passed?: boolean; boat_note_url?: string }
interface CdnRec    { id: string; code?: string; cdn_no: string; container_no: string; driver_name: string; cusdec_number: string; goods_description: string; gross_mass: string; vessel: string; voyage: string; voyage_date: string; bl_no: string; slpa_no: string; voc: string; coc: string; lorry_no: string; trailer_no: string; loading_port: string; discharge_port: string; location: string; pkg_no: string; pkg_type: string; volume: string; seal_no: string; con_type: string; marks: string; boat_note_passed?: boolean; shipper?: string; consignee?: string }

interface DocTemplate { id: string; name: string; file_name: string; drive_url: string | null; raw_text: string; placeholders: string[]; created_at: string }

interface BoatNote { shipper: string; consignee: string; entry_no: string; bl_no: string; slpa_no: string; voyage: string; voyage_date: string; vessel: string; terminal: string; lorry_no: string; trailer_no: string; driver_name: string; container_no: string; con_type: string; seal_no: string; goods: string; gross_mass: string; net_mass: string; cdn_no: string; pkg_no: string; pkg_type: string; voc: string; coc: string; loading_port: string; discharge_port: string; volume: string; marks: string }

// Invoice + Packing List share one form — both PDFs pull from the same
// state so nothing has to be typed twice. Fields not listed per-item
// (Terms of Delivery, Payment Type, Bank Details, ...) live at the top level;
// Item Description and Payment Type are repeatable (spec explicitly calls
// for "more than one" of each).
interface DocLineItem { description: string; packages: string; pkgType: string; gw: string; nw: string; unitPrice: string; totalValue: string }
const emptyLineItem = (): DocLineItem => ({ description: '', packages: '', pkgType: '', gw: '', nw: '', unitPrice: '', totalValue: '' })

interface DocForm {
  invoiceNumber: string; referenceNumber: string; date: string
  exporter: string; consignee: string; containerMark: string
  items: DocLineItem[]
  totalGross: string; totalNet: string
  termsOfDelivery: string; paymentTypes: string[]; bankDetails: string
  booking: string; vessel: string; voyage: string; coc: string; voc: string
  discharge: string; loading: string; origin: string
}
const emptyDocForm = (): DocForm => ({
  invoiceNumber: '', referenceNumber: '', date: new Date().toISOString().slice(0, 10),
  exporter: '', consignee: '', containerMark: '',
  items: [emptyLineItem()],
  totalGross: '', totalNet: '',
  termsOfDelivery: '', paymentTypes: [''], bankDetails: '',
  booking: '', vessel: '', voyage: '', coc: '', voc: '',
  discharge: '', loading: '', origin: '',
})
// Fields that can be auto-filled (from the shipper profile, or auto-summed
// from item rows) and therefore need "Edited" tag tracking.
type AutoFillableKey = 'consignee' | 'bankDetails' | 'totalGross' | 'totalNet'

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
  const [customDocTypes, setCustomDocTypes] = useState<{ value: string; label: string }[]>([])
  useEffect(() => {
    async function loadCustomTypes() {
      try {
        const h = await authHeader()
        const res = await fetch('/api/doc-templates', { headers: h })
        if (!res.ok) return
        const d = await res.json()
        const built_in = new Set(['boat_note', 'invoice', 'packing_list'])
        const extras = ((d.templates || []) as any[])
          .map(t => t.document_type as string)
          .filter(v => v && !built_in.has(v))
          .filter((v, i, arr) => arr.indexOf(v) === i)
          .map(v => ({ value: v, label: v.split('_').filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(' ') }))
        setCustomDocTypes(extras)
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
    setBnManualGenerating(true); setStatus(''); setBnPdf(null); setSavedBnUrl(''); setBnReason(''); setBoatNotes([]); setCusdecNo('')
    try {
      const manual: Record<string, string> = {}
      Object.entries(bnFormValues).forEach(([label, rows]) => { manual[label] = rows.join('\n') })
      const h = await authHeader()
      const res = await fetch('/api/doc-generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...h },
        body: JSON.stringify({ document_type: 'boat_note', manual_values: manual }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Generate failed')
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

  // ── Invoice / Packing List (shared form) ──────────────────────────────
  const [docForm, setDocForm] = useState<DocForm>(emptyDocForm())
  const [autoValues, setAutoValues] = useState<Partial<Record<AutoFillableKey, string>>>({})
  const [editedFields, setEditedFields] = useState<Set<AutoFillableKey>>(new Set())
  const [docStatus, setDocStatus] = useState('')
  const [docBusy, setDocBusy] = useState<'invoice' | 'packing-list' | 'invoice-temp' | 'packing-list-temp' | 'template' | ''>('')

  // Templates uploaded on the Templates tab (Word docs with {{placeholder}}
  // tags) — shown here filtered by name so "INVOICE ..." templates only
  // offer themselves on the Invoice tab, "PACKING LIST ..." only on Packing
  // List, matching how the user names them when saving.
  const [templates, setTemplates] = useState<DocTemplate[]>([])
  const [selectedTemplateId, setSelectedTemplateId] = useState('')
  useEffect(() => {
    fetch('/api/list-templates').then(r => r.json()).then(d => setTemplates(d.templates || [])).catch(() => {})
  }, [])
  useEffect(() => {
    authHeader().then(h => fetch('/api/document-templates', { headers: h }))
      .then(r => r.json()).then(d => setExcelTemplates(d.templates || [])).catch(() => {})
  }, [])
  const templateKeyword = subTab === 'invoice' ? 'inv' : 'pl'
  const matchingTemplates = templates.filter(t => t.name?.toLowerCase().includes(templateKeyword))
  useEffect(() => { setSelectedTemplateId('') }, [subTab])
  const selectedTemplate = matchingTemplates.find(t => t.id === selectedTemplateId) || null

  // Maps the shared Invoice/Packing List form onto the plain-text placeholder
  // names a saved template is expected to use — {{invoice_number}},
  // {{exporter}}, etc. Item rows and payment types don't have a single value,
  // so they're flattened into one multi-line block per {{items}}/{{payment_type}}.
  function buildTemplateValues(): Record<string, string> {
    const grand = docForm.items.reduce((acc, it) => acc + (parseFloat(it.totalValue) || 0), 0)
    return {
      invoice_number: docForm.invoiceNumber, reference_number: docForm.referenceNumber, date: docForm.date,
      exporter: docForm.exporter, consignee: docForm.consignee, container_mark: docForm.containerMark,
      items: docForm.items.map(it => `${it.description} | ${it.packages} ${it.pkgType} | G/W ${it.gw} | N/W ${it.nw}${subTab === 'invoice' ? ` | ${it.unitPrice} | ${it.totalValue}` : ''}`).join('\n'),
      total_gross: docForm.totalGross, total_net: docForm.totalNet, grand_total: grand ? grand.toFixed(2) : '',
      terms_of_delivery: docForm.termsOfDelivery, payment_type: docForm.paymentTypes.filter(Boolean).join(', '), bank_details: docForm.bankDetails,
      booking: docForm.booking, vessel: docForm.vessel, voyage: docForm.voyage, coc: docForm.coc, voc: docForm.voc,
      discharge: docForm.discharge, loading: docForm.loading, origin: docForm.origin,
    }
  }

  async function generateFromTemplate() {
    if (!selectedTemplate) return
    setDocStatus('')
    setDocBusy('template')
    try {
      const values = buildTemplateValues()
      const filled = selectedTemplate.raw_text.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => values[key] ?? '')
      const { jsPDF } = await import('jspdf')
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
      const M = 15
      let y = M
      doc.setFont('helvetica', 'normal').setFontSize(10)
      for (const paragraph of filled.split('\n')) {
        const lines = doc.splitTextToSize(paragraph || ' ', 210 - M * 2)
        for (const line of lines) {
          if (y > 280) { doc.addPage(); y = M }
          doc.text(line, M, y)
          y += 5.5
        }
      }
      const dt = new Date().toISOString().slice(0, 10)
      const fileName = `${selectedTemplate.name.replace(/[^\w.-]+/g, '_')}_${docForm.invoiceNumber || 'TEMP'}_${dt}.pdf`
      doc.save(fileName)
      setDocStatus(`✓ Generated from template "${selectedTemplate.name}"`)
    } catch (e: any) {
      setDocStatus(`✗ ${e.message}`)
    } finally {
      setDocBusy('')
    }
  }

  function setDocField<K extends keyof DocForm>(key: K, value: DocForm[K]) {
    setDocForm(f => ({ ...f, [key]: value }))
    if ((autoValues as any)[key] !== undefined && (autoValues as any)[key] !== value) {
      setEditedFields(prev => new Set(prev).add(key as AutoFillableKey))
    }
  }

  function updateLineItem(idx: number, patch: Partial<DocLineItem>) {
    setDocForm(f => ({ ...f, items: f.items.map((it, i) => i === idx ? { ...it, ...patch } : it) }))
  }
  function addLineItem() { setDocForm(f => ({ ...f, items: [...f.items, emptyLineItem()] })) }
  function removeLineItem(idx: number) { setDocForm(f => ({ ...f, items: f.items.length > 1 ? f.items.filter((_, i) => i !== idx) : f.items })) }

  function updatePaymentType(idx: number, value: string) {
    setDocForm(f => ({ ...f, paymentTypes: f.paymentTypes.map((p, i) => i === idx ? value : p) }))
  }
  function addPaymentType() { setDocForm(f => ({ ...f, paymentTypes: [...f.paymentTypes, ''] })) }
  function removePaymentType(idx: number) { setDocForm(f => ({ ...f, paymentTypes: f.paymentTypes.length > 1 ? f.paymentTypes.filter((_, i) => i !== idx) : f.paymentTypes })) }

  // Auto-sum Total Gross/Net from item rows, unless the user has manually
  // overridden them (tracked the same way as the shipper auto-fill below).
  useEffect(() => {
    const sum = (key: 'gw' | 'nw') => docForm.items.reduce((acc, it) => acc + (parseFloat(it[key]) || 0), 0)
    const gross = sum('gw') ? String(sum('gw')) : ''
    const net = sum('nw') ? String(sum('nw')) : ''
    setAutoValues(prev => ({ ...prev, totalGross: gross, totalNet: net }))
    setDocForm(f => ({
      ...f,
      totalGross: editedFields.has('totalGross') ? f.totalGross : gross,
      totalNet: editedFields.has('totalNet') ? f.totalNet : net,
    }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(docForm.items)])

  // Shipper auto-fill: on picking/typing an Exporter that has a saved
  // profile, pull in its last-used Consignee + Bank Details.
  async function handleExporterBlur() {
    const shipper = docForm.exporter.trim()
    if (!shipper) return
    try {
      const res = await fetch(`/api/shipper-profile?shipper=${encodeURIComponent(shipper)}`)
      const d = await res.json()
      const profile = d.profile
      if (!profile) return
      setAutoValues(prev => ({ ...prev, consignee: profile.consignee || '', bankDetails: profile.bank_details || '' }))
      setDocForm(f => ({
        ...f,
        consignee: editedFields.has('consignee') ? f.consignee : (profile.consignee || f.consignee),
        bankDetails: editedFields.has('bankDetails') ? f.bankDetails : (profile.bank_details || f.bankDetails),
      }))
    } catch {}
  }

  function isEdited(key: AutoFillableKey) { return editedFields.has(key) }

  async function fileToBase64FromBlob(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve((reader.result as string).split(',')[1])
      reader.onerror = reject
      reader.readAsDataURL(blob)
    })
  }

  async function buildDocPdf(kind: 'invoice' | 'packing-list') {
    const { jsPDF } = await import('jspdf')
    const autoTable = (await import('jspdf-autotable')).default
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    const M = 12
    let y = M

    doc.setFont('helvetica', 'bold').setFontSize(13)
    doc.text(COMPANY.name, M, y); y += 5
    doc.setFontSize(11)
    doc.text(kind === 'invoice' ? 'COMMERCIAL INVOICE' : 'PACKING LIST', M, y); y += 7

    doc.setFont('helvetica', 'normal').setFontSize(9)
    doc.text(`Invoice No: ${docForm.invoiceNumber || '-'}`, M, y)
    doc.text(`Reference No: ${docForm.referenceNumber || '-'}`, M + 90, y); y += 5
    doc.text(`Date: ${docForm.date || '-'}`, M, y); y += 7

    doc.setFont('helvetica', 'bold').setFontSize(9)
    doc.text('Exporter:', M, y)
    doc.text('Consignee:', M + 95, y); y += 4
    doc.setFont('helvetica', 'normal')
    const expLines = doc.splitTextToSize(docForm.exporter || '-', 88)
    const conLines = doc.splitTextToSize(docForm.consignee || '-', 88)
    doc.text(expLines, M, y)
    doc.text(conLines, M + 95, y)
    y += Math.max(expLines.length, conLines.length) * 4 + 4

    doc.text(`Container Mark: ${docForm.containerMark || '-'}`, M, y); y += 6

    const cols = kind === 'invoice'
      ? ['Description', 'Packages', 'Type', 'G/W', 'N/W', 'Unit Price', 'Total Value']
      : ['Description', 'Packages', 'Type', 'G/W', 'N/W']
    const rows = docForm.items.map(it => kind === 'invoice'
      ? [it.description, it.packages, it.pkgType, it.gw, it.nw, it.unitPrice, it.totalValue]
      : [it.description, it.packages, it.pkgType, it.gw, it.nw])

    autoTable(doc, {
      startY: y, margin: { left: M, right: M }, styles: { fontSize: 8, cellPadding: 1.5 },
      headStyles: { fillColor: [27, 58, 92] },
      head: [cols], body: rows,
    })
    // @ts-ignore - jspdf-autotable augments doc with lastAutoTable at runtime
    y = (doc as any).lastAutoTable.finalY + 6

    doc.setFont('helvetica', 'bold').setFontSize(9)
    doc.text(`Total Gross: ${docForm.totalGross || '-'} Kg`, M, y)
    doc.text(`Total Net: ${docForm.totalNet || '-'} Kg`, M + 70, y)
    if (kind === 'invoice') {
      const grand = docForm.items.reduce((acc, it) => acc + (parseFloat(it.totalValue) || 0), 0)
      doc.text(`Grand Total: ${grand ? grand.toFixed(2) : '-'}`, M + 140, y)
    }
    y += 7

    doc.setFont('helvetica', 'normal').setFontSize(8.5)
    const meta = [
      ['Terms of Delivery', docForm.termsOfDelivery],
      ['Payment Type', docForm.paymentTypes.filter(Boolean).join(', ')],
      ['Bank Details', docForm.bankDetails],
      ['Booking', docForm.booking], ['Vessel', docForm.vessel], ['Voyage', docForm.voyage],
      ['COC', docForm.coc], ['VOC', docForm.voc],
      ['Loading', docForm.loading], ['Discharge', docForm.discharge], ['Origin', docForm.origin],
    ].filter(([, v]) => v)
    meta.forEach(([label, value]) => {
      const lines = doc.splitTextToSize(`${label}: ${value}`, 186)
      doc.text(lines, M, y)
      y += lines.length * 4
    })

    y = Math.max(y + 10, 270)
    doc.setFont('helvetica', 'italic').setFontSize(7)
    doc.text(`Generated by Export Management System · ${new Date().toLocaleDateString('en-GB')}`, M, 290)
    doc.line(M + 120, y, M + 186, y)
    doc.text('Authorized Signature', M + 140, y + 4)

    return doc
  }

  async function generateDoc(kind: 'invoice' | 'packing-list', temporary: boolean) {
    setDocStatus('')
    if (!temporary && !docForm.invoiceNumber.trim()) {
      setDocStatus('⚠ Invoice Number is required to save/attach this document (use "Temporary" if it isn\'t generated yet)')
      return
    }
    setDocBusy(temporary ? (kind === 'invoice' ? 'invoice-temp' : 'packing-list-temp') : kind)
    try {
      const doc = await buildDocPdf(kind)
      const dt = new Date().toISOString().slice(0, 10)
      const fileName = `${kind === 'invoice' ? 'INVOICE' : 'PACKING_LIST'}_${docForm.invoiceNumber || 'TEMP'}_${dt}.pdf`
      doc.save(fileName)

      if (temporary) {
        setDocStatus('✓ Temporary PDF downloaded (not saved — will clear on refresh)')
        return
      }

      // Persist shipper defaults for next time (Bank Details / Consignee auto-fill).
      if (docForm.exporter.trim()) {
        authHeader().then(h => fetch('/api/shipper-profile', {
          method: 'POST', headers: { 'Content-Type': 'application/json', ...h },
          body: JSON.stringify({ shipper: docForm.exporter.trim(), consignee: docForm.consignee, bank_details: docForm.bankDetails }),
        })).catch(() => {})
      }

      // Auto-attach: upload to Drive, log it, then link onto the matching shipment.
      const base64 = await fileToBase64FromBlob(doc.output('blob'))
      const docType = kind === 'invoice' ? 'invoice' : 'packing_list'
      const dr = await fetch('/api/upload-to-drive', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ base64, fileName, mimeType: 'application/pdf', docType }),
      })
      const dd = await dr.json()
      if (!dr.ok || !dd.driveLink) throw new Error(dd.error || 'Drive upload failed')

      await fetch('/api/save-document', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ doc_type: docType, file_name: fileName, drive_url: dd.driveLink, extracted_data: { invoice_number: docForm.invoiceNumber } }),
      })

      const at = await fetch('/api/attach-shipment-pdf', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoice_number: docForm.invoiceNumber, doc_type: docType, url: dd.driveLink }),
      })
      const ad = await at.json()
      setDocStatus(ad.attached
        ? `✓ ${kind === 'invoice' ? 'Invoice' : 'Packing List'} PDF saved to Drive and attached to shipment ${docForm.invoiceNumber}`
        : `✓ ${kind === 'invoice' ? 'Invoice' : 'Packing List'} PDF saved to Drive (no open shipment found for ${docForm.invoiceNumber} to attach to)`)
    } catch (e: any) {
      setDocStatus(`✗ ${e.message}`)
    } finally {
      setDocBusy('')
    }
  }

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

    setGen(true); setBoatNotes([]); setBnPdf(null); setSavedBnUrl(''); setBnReason('')
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
      // Generate PDF from Google Sheets template
      const pdfRes = await fetch('/api/doc-generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...h },
        body: JSON.stringify({ document_type: 'boat_note', cusdec_id: selCusdec, cdn_ids: selCdns }),
      })
      const pdfD = await pdfRes.json()
      if (!pdfRes.ok) throw new Error(pdfD.error || 'Template PDF generate failed')
      const cusdecDigits = cusdecNoVal.replace(/[^0-9]/g, '')
      const fileName = `B${cusdecDigits || cusdecNoVal || 'UNKNOWN'}.pdf`
      setBnPdf({ base64: pdfD.base64, fileName })
      setStatus(`✓ ${d.boat_notes.length} container(s) — PDF ready`)
    } catch (e: any) { setStatus(`✗ ${e.message}`) }
    finally { setGen(false) }
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
          <div className="space-y-4">
            {docStatus && (
              <p className={`text-xs font-medium ${docStatus.startsWith('✓') ? 'text-green-600' : docStatus.startsWith('⚠') ? 'text-amber-600' : 'text-red-600'}`}>{docStatus}</p>
            )}

            <div className="card">
              <h2 className="font-semibold text-gray-900 text-sm mb-3">Document Details</h2>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Field label="Invoice Number *"><input value={docForm.invoiceNumber} onChange={e => setDocField('invoiceNumber', e.target.value)} className="input"/></Field>
                <Field label="Reference Number"><input value={docForm.referenceNumber} onChange={e => setDocField('referenceNumber', e.target.value)} className="input"/></Field>
                <Field label="Date"><input type="date" value={docForm.date} onChange={e => setDocField('date', e.target.value)} className="input"/></Field>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
                <Field label="Exporter (Shipper)"><input value={docForm.exporter} onChange={e => setDocField('exporter', e.target.value)} onBlur={handleExporterBlur} className="input"/></Field>
                <Field label="Consignee" edited={isEdited('consignee')}><input value={docForm.consignee} onChange={e => setDocField('consignee', e.target.value)} className="input"/></Field>
                <Field label="Container Mark"><input value={docForm.containerMark} onChange={e => setDocField('containerMark', e.target.value)} className="input"/></Field>
              </div>
            </div>

            <div className="card">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-semibold text-gray-900 text-sm">Item Description</h2>
                <button onClick={addLineItem} className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1"><Plus size={13}/>Add Row</button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead><tr className="text-left text-gray-500">
                    <th className="pb-2 pr-2">Description</th><th className="pb-2 pr-2">Packages</th><th className="pb-2 pr-2">Type</th>
                    <th className="pb-2 pr-2">G/W</th><th className="pb-2 pr-2">N/W</th><th className="pb-2 pr-2">Unit Price</th><th className="pb-2 pr-2">Total Value</th><th/>
                  </tr></thead>
                  <tbody>
                    {docForm.items.map((it, idx) => (
                      <tr key={idx}>
                        <td className="pr-2 pb-2"><input value={it.description} onChange={e => updateLineItem(idx, { description: e.target.value })} className="input"/></td>
                        <td className="pr-2 pb-2"><input value={it.packages} onChange={e => updateLineItem(idx, { packages: e.target.value })} className="input w-20"/></td>
                        <td className="pr-2 pb-2"><input value={it.pkgType} onChange={e => updateLineItem(idx, { pkgType: e.target.value })} className="input w-20"/></td>
                        <td className="pr-2 pb-2"><input value={it.gw} onChange={e => updateLineItem(idx, { gw: e.target.value })} className="input w-20"/></td>
                        <td className="pr-2 pb-2"><input value={it.nw} onChange={e => updateLineItem(idx, { nw: e.target.value })} className="input w-20"/></td>
                        <td className="pr-2 pb-2"><input value={it.unitPrice} onChange={e => updateLineItem(idx, { unitPrice: e.target.value })} className="input w-24"/></td>
                        <td className="pr-2 pb-2"><input value={it.totalValue} onChange={e => updateLineItem(idx, { totalValue: e.target.value })} className="input w-24"/></td>
                        <td className="pb-2">{docForm.items.length > 1 && <button onClick={() => removeLineItem(idx)} className="text-gray-300 hover:text-red-500"><X size={14}/></button>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="grid grid-cols-2 gap-3 mt-3">
                <Field label="Total Gross" edited={isEdited('totalGross')}><input value={docForm.totalGross} onChange={e => setDocField('totalGross', e.target.value)} className="input"/></Field>
                <Field label="Total Net" edited={isEdited('totalNet')}><input value={docForm.totalNet} onChange={e => setDocField('totalNet', e.target.value)} className="input"/></Field>
              </div>
            </div>

            <div className="card">
              <h2 className="font-semibold text-gray-900 text-sm mb-3">Terms & Shipping Details</h2>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Field label="Terms of Delivery"><input value={docForm.termsOfDelivery} onChange={e => setDocField('termsOfDelivery', e.target.value)} className="input"/></Field>
                <Field label="Bank Details" edited={isEdited('bankDetails')}><input value={docForm.bankDetails} onChange={e => setDocField('bankDetails', e.target.value)} className="input"/></Field>
                <Field label="Booking"><input value={docForm.booking} onChange={e => setDocField('booking', e.target.value)} className="input"/></Field>
                <Field label="Vessel"><input value={docForm.vessel} onChange={e => setDocField('vessel', e.target.value)} className="input"/></Field>
                <Field label="Voyage"><input value={docForm.voyage} onChange={e => setDocField('voyage', e.target.value)} className="input"/></Field>
                <Field label="COC"><input value={docForm.coc} onChange={e => setDocField('coc', e.target.value)} className="input"/></Field>
                <Field label="VOC"><input value={docForm.voc} onChange={e => setDocField('voc', e.target.value)} className="input"/></Field>
                <Field label="Loading"><input value={docForm.loading} onChange={e => setDocField('loading', e.target.value)} className="input"/></Field>
                <Field label="Discharge"><input value={docForm.discharge} onChange={e => setDocField('discharge', e.target.value)} className="input"/></Field>
                <Field label="Origin"><input value={docForm.origin} onChange={e => setDocField('origin', e.target.value)} className="input"/></Field>
              </div>
              <div className="mt-3">
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-medium text-gray-600">Payment Type</label>
                  <button onClick={addPaymentType} className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1"><Plus size={13}/>Add</button>
                </div>
                <div className="space-y-2">
                  {docForm.paymentTypes.map((p, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <input value={p} onChange={e => updatePaymentType(idx, e.target.value)} className="input"/>
                      {docForm.paymentTypes.length > 1 && <button onClick={() => removePaymentType(idx)} className="text-gray-300 hover:text-red-500"><X size={14}/></button>}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {matchingTemplates.length > 0 && (
              <div className="card">
                <h2 className="font-semibold text-gray-900 text-sm mb-3">Use a Template</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-start">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Template</label>
                    <select value={selectedTemplateId} onChange={e => setSelectedTemplateId(e.target.value)} className="input">
                      <option value="">Don't use a template (form layout below)</option>
                      {matchingTemplates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </div>
                  {selectedTemplate && (
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Spaces in this template</label>
                      <div className="flex flex-wrap gap-1.5">
                        {selectedTemplate.placeholders.map(p => (
                          <span key={p} className="text-[11px] font-mono bg-blue-50 text-blue-700 px-2 py-0.5 rounded">{'{{' + p + '}}'}</span>
                        ))}
                        {selectedTemplate.placeholders.length === 0 && <span className="text-xs text-gray-400">No {'{{tags}}'} detected</span>}
                      </div>
                    </div>
                  )}
                </div>
                {selectedTemplate && (
                  <button onClick={generateFromTemplate} disabled={!!docBusy}
                    className="btn-secondary mt-3 flex items-center gap-2">
                    {docBusy === 'template' ? <Loader size={14} className="animate-spin"/> : <FileStack size={14}/>}
                    Generate PDF from Template
                  </button>
                )}
              </div>
            )}

            <div className="card flex flex-col sm:flex-row gap-3">
              {subTab === 'invoice' ? (
                <button onClick={() => generateDoc('invoice', false)} disabled={!!docBusy}
                  className="btn-primary flex items-center justify-center gap-2 flex-1">
                  {docBusy === 'invoice' ? <Loader size={14} className="animate-spin"/> : <FileDown size={14}/>}Generate Invoice PDF
                </button>
              ) : (
                <button onClick={() => generateDoc('packing-list', false)} disabled={!!docBusy}
                  className="btn-primary flex items-center justify-center gap-2 flex-1">
                  {docBusy === 'packing-list' ? <Loader size={14} className="animate-spin"/> : <FileDown size={14}/>}Generate Packing List PDF
                </button>
              )}
              <button onClick={() => generateDoc(subTab === 'invoice' ? 'invoice' : 'packing-list', true)} disabled={!!docBusy}
                className="btn-secondary flex items-center justify-center gap-2 flex-1">
                {(docBusy === 'invoice-temp' || docBusy === 'packing-list-temp') ? <Loader size={14} className="animate-spin"/> : <Clock size={14}/>}
                Temporary (no save, cleared on refresh)
              </button>
            </div>
          </div>
        ) : null}

        {subTab === 'boat-note' && canBoatNote && (
        <>
        <p className="text-gray-500 text-sm mb-3 -mt-2">SHIPPING NOTE / BOAT NOTE – Exp 3a format · Select CUSDEC → CDNs → Generate → Download / Email</p>

        <div className="flex gap-1.5 mb-4 bg-gray-100 rounded-lg p-1 w-fit">
          <button onClick={() => { setBnEntryMode('cusdec'); setBnPdf(null); setBoatNotes([]); setStatus(''); setSavedBnUrl(''); setBnReason('') }}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${bnEntryMode === 'cusdec' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
            From CUSDEC
          </button>
          <button onClick={() => { setBnEntryMode('manual'); setBnPdf(null); setBoatNotes([]); setStatus(''); setSavedBnUrl(''); setBnReason('') }}
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
                    onClick={() => { setSelCusdec(c.id); setSelCdns([]); setBoatNotes([]) }}
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
                    onDone={() => { setSendModalBnOpen(false); loadCusdecs(true) }}
                  />
                )}
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

        </>
        )}

        {subTab === 'cusdec-xml' && canCusdecXml && <CusdecXmlPanel/>}
        {subTab === 'cdn-text' && canCdnText && <CdnTextPanel/>}
        {subTab === 'parties-copy' && canPartiesCopy && <PartiesCopyPanel/>}
        {subTab.startsWith('custom:') && canBoatNote && (() => {
          const value = subTab.slice('custom:'.length)
          const d = customDocTypes.find(c => c.value === value)
          return d ? <CustomDocPanel documentType={d.value} label={d.label}/> : null
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
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [values, setValues] = useState<XmlValues>(emptyXmlValues())
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('')

  useEffect(() => {
    function load() {
      fetch('/api/list-records?table=cusdec&limit=500').then(r => r.json()).then(d => setCusdecs(d.records || [])).catch(() => {})
    }
    load()
    const t = setInterval(load, 20000)
    return () => clearInterval(t)
  }, [])

  const filtered = cusdecs.filter(c =>
    !search || c.number?.toLowerCase().includes(search.toLowerCase()) || c.exporter?.toLowerCase().includes(search.toLowerCase())
  )
  const selected = cusdecs.find(c => c.id === selectedId) || null

  async function selectCusdec(id: string) {
    setSelectedId(id); setStatus('')
    const cusdec = cusdecs.find(c => c.id === id)
    if (!cusdec) return
    setLoading(true)
    try {
      const res = await fetch(`/api/cusdec-xml?id=${id}`)
      const d = await res.json()
      const saved: Partial<XmlValues> = d.xml_data || {}
      setValues({
        ...emptyXmlValues(), ...saved,
        regNumber: cusdec.number || '', regDate: cusdec.date || '',
        exporterName: cusdec.exporter || '', consigneeName: cusdec.consignee || '',
        vesselIdentity: cusdec.vessel || '',
        deliveryTermsCode: cusdec.delivery_terms || saved.deliveryTermsCode || 'CIF',
        locationOfGoods: cusdec.location_of_goods || '',
        cap: cusdec.cap || saved.cap || '01',
        hsCode: cusdec.hs_code || '', preferenceCode: cusdec.preference || saved.preferenceCode || 'APTA',
        extendedProcedure: cusdec.procedure_code || saved.extendedProcedure || '1000',
        totalWeight: cusdec.gross_mass || '', grossWeightItm: cusdec.gross_mass || '', netWeightItm: cusdec.net_mass || '',
        numberOfPackages: cusdec.pkges || '', totalPackages: cusdec.pkges || '',
      })
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

  const FIELD_GROUPS: { title: string; fields: [keyof XmlValues, string][] }[] = [
    { title: 'Registration / Assessment / Receipt', fields: [
      ['regSerial', 'Registration Serial'], ['regNumber', 'Registration Number'], ['regDate', 'Registration Date'],
      ['assessSerial', 'Assessment Serial'], ['assessNumber', 'Assessment Number'], ['assessDate', 'Assessment Date'],
      ['receiptSerial', 'Receipt Serial'], ['receiptNumber', 'Receipt Number'], ['receiptDate', 'Receipt Date'],
    ]},
    { title: 'Traders / Declarant', fields: [
      ['exporterCode', 'Exporter Code'], ['exporterName', 'Exporter Name'], ['consigneeName', 'Consignee Name'],
      ['declarantCode', 'Declarant Code'], ['declarantName', 'Declarant Name'], ['declarantReference', 'Declarant Reference'],
    ]},
    { title: 'Country / General', fields: [
      ['countryFirstDestination', 'Country of First Destination'], ['tradingCountry', 'Trading Country'],
      ['destinationCountryCode', 'Destination Country Code'], ['destinationCountryName', 'Destination Country Name'],
      ['cap', 'CAP'],
    ]},
    { title: 'Transport', fields: [
      ['vesselIdentity', 'Vessel'], ['borderInfoIdentity', 'Border Info (Voyage/Date)'],
      ['deliveryTermsCode', 'Delivery Terms'], ['placeOfLoadingCode', 'Place of Loading Code'],
      ['placeOfLoadingName', 'Place of Loading Name'], ['locationOfGoods', 'Location of Goods'],
    ]},
    { title: 'Financial', fields: [
      ['bankCode', 'Bank Code'], ['bankName', 'Bank Name'], ['bankBranch', 'Bank Branch'], ['bankReference', 'Bank Reference'],
      ['modeOfPayment', 'Mode of Payment'], ['globalTaxes', 'Global Taxes'], ['totalTaxes', 'Total Taxes'],
    ]},
    { title: 'Valuation', fields: [
      ['totalCif', 'Total CIF'], ['invoiceAmountNational', 'Invoice Amount (LKR)'], ['invoiceAmountForeign', 'Invoice Amount (Foreign)'],
      ['currencyCode', 'Currency Code'], ['totalInvoice', 'Total Invoice'], ['totalWeight', 'Total Weight'],
    ]},
    { title: 'Item / Packages', fields: [
      ['numberOfPackages', 'Number of Packages'], ['marks1', 'Marks 1'], ['marks2', 'Marks 2'],
      ['attachedDocReference', 'Attached Document Reference'], ['attachedDocDate', 'Attached Document Date'],
    ]},
    { title: 'Tarification / Goods', fields: [
      ['hsCode', 'HS Code'], ['itemPrice', 'Item Price'], ['descriptionOfGoods', 'Description of Goods'],
      ['previousDocSummaryDeclaration', 'Previous Doc (Summary Declaration)'],
      ['licenceNumber', 'Licence Number'], ['quantityDeductedFromLicence', 'Quantity Deducted from Licence'],
    ]},
    { title: 'Taxation', fields: [
      ['itemTaxesAmount', 'Item Taxes Amount'],
      ['dutyTaxBase1', 'Duty Tax Base (CC1)'], ['dutyTaxAmount1', 'Duty Tax Amount (CC1)'],
      ['dutyTaxBase2', 'Duty Tax Base (CED)'], ['dutyTaxAmount2', 'Duty Tax Amount (CED)'],
    ]},
    { title: 'Item Weight/Value', fields: [
      ['grossWeightItm', 'Gross Weight (Item)'], ['netWeightItm', 'Net Weight (Item)'], ['statisticalValue', 'Statistical Value'],
    ]},
  ]

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
    setFields({
      officeCode: cusdec?.code || cdn.code || '', year: new Date().getFullYear().toString(), serial: 'C', number: cdn.cdn_no || '',
      shipper: cdn.shipper || '', consignee: cdn.consignee || '',
      linkedCusdecRef: cusdec?.number || '', voyageDate: cdn.voyage_date || '', bl: cdn.bl_no || '',
      driver: cdn.driver_name || '', terminal: '', lorry: cdn.lorry_no || '', trailer: cdn.trailer_no || '',
      loadPort: cdn.loading_port || '', dischPort: cdn.discharge_port || '', vessel: cdn.vessel || '',
      voc: cdn.voc || '', coc: cdn.coc || '', slpa: cdn.slpa_no || '',
      pkgNo: cdn.pkg_no || '', pkgType: cdn.pkg_type || '', volume: cdn.volume || '',
      goods: cdn.goods_description || '', container: cdn.container_no || '', conType: cdn.con_type || '',
      seal: cdn.seal_no || '', marks: cdn.marks || '', gross: cdn.gross_mass || '',
      preparedBy: '', declarantCode: '',
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
  )
}

// ── Party's Copy Tab ──────────────────────────────────────────────────────
interface PartiesCopyCusdec extends CusdecRec { cap?: string }

function PartiesCopyPanel() {
  const [cusdecs, setCusdecs] = useState<PartiesCopyCusdec[]>([])
  const [cdns, setCdns] = useState<CdnRec[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [search, setSearch] = useState('')
  const [generating, setGenerating] = useState(false)
  const [status, setStatus] = useState('')

  useEffect(() => {
    function load() {
      fetch('/api/list-records?table=cusdec&limit=500').then(r => r.json()).then(d => setCusdecs(d.records || [])).catch(() => {})
      fetch('/api/list-records?table=cdn&limit=500').then(r => r.json()).then(d => setCdns(d.records || [])).catch(() => {})
    }
    load()
    const t = setInterval(load, 20000)
    return () => clearInterval(t)
  }, [])

  const filtered = cusdecs.filter(c =>
    !search || c.number?.toLowerCase().includes(search.toLowerCase()) || c.exporter?.toLowerCase().includes(search.toLowerCase())
  )
  const selected = cusdecs.find(c => c.id === selectedId) || null
  const selectedCdns = selected ? cdns.filter(c => c.cusdec_number === selected.number) : []
  const capNum = Number(selected?.cap || 0)
  const cdnCount = selectedCdns.length
  const eligible = selected && capNum > 0 && capNum === cdnCount && !selected.export_release_passed

  async function generate() {
    if (!selected || !eligible) return
    setGenerating(true); setStatus('')
    try {
      const { jsPDF } = await import('jspdf')
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
      const PW = 210, M = 15
      let y = M

      doc.setFontSize(13).setFont('helvetica', 'bold')
      doc.text("PARTY'S COPY", PW / 2, y, { align: 'center' }); y += 7
      doc.setFontSize(9).setFont('helvetica', 'normal')
      doc.text('PRIYANTHI AGENCY', PW / 2, y, { align: 'center' }); y += 10

      const row = (label: string, value: string) => {
        doc.setFont('helvetica', 'bold').setFontSize(8)
        doc.text(label, M, y)
        doc.setFont('helvetica', 'normal')
        doc.text(value || '—', M + 45, y)
        y += 6
      }

      row('CUSDEC No.:', `E ${selected.number}`)
      row('Exporter:', selected.exporter)
      row('Consignee:', selected.consignee)
      row('Vessel:', selected.vessel)
      row('Voyage:', selected.voyage_no)
      row('B/L No.:', selected.bl_no)
      row('Gross Mass:', selected.gross_mass ? `${selected.gross_mass} Kg` : '')
      row('Net Mass:', selected.net_mass ? `${selected.net_mass} Kg` : '')
      row('Discharge Port:', selected.discharge_port)
      row('Location of Goods:', selected.location_of_goods)
      row('CAP:', selected.cap || '')
      y += 4

      doc.setFont('helvetica', 'bold').setFontSize(8)
      doc.text('Containers (CDN):', M, y); y += 6
      doc.setFont('helvetica', 'normal').setFontSize(7)
      selectedCdns.forEach((cdn, i) => {
        doc.text(`${i + 1}. ${cdn.container_no || '—'}  CDN: ${cdn.cdn_no || '—'}  Seal: ${cdn.seal_no || '—'}  ${cdn.gross_mass || ''} Kg`, M + 3, y)
        y += 5
      })

      y += 6
      doc.setFontSize(7).setTextColor(150)
      doc.text(`Generated: ${new Date().toLocaleString('en-GB')}`, M, y)
      doc.setTextColor(0)

      doc.save(`P${selected.number}.pdf`)
      setStatus(`✓ P${selected.number}.pdf downloaded`)
    } catch (e: any) {
      setStatus(`✗ ${e.message}`)
    } finally {
      setGenerating(false)
    }
  }

  return (
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
              <button key={c.id} onClick={() => { setSelectedId(c.id); setStatus('') }}
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

              {!eligible && (
                <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700 mb-4">
                  <AlertTriangle size={13} className="mt-0.5 flex-shrink-0"/>
                  <div>
                    {capNum === 0 && <p>CAP not set on this CUSDEC.</p>}
                    {capNum > 0 && capNum !== cdnCount && <p>CAP ({capNum}) ≠ CDN count ({cdnCount}). All containers must be entered before generating.</p>}
                    {selected.export_release_passed && <p>Export release already passed — Party's Copy locked.</p>}
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

              <button onClick={generate} disabled={!eligible || generating}
                className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm text-white font-medium disabled:opacity-40"
                style={{ background: '#8b5cf6' }}>
                {generating ? <Loader size={14} className="animate-spin"/> : <FileDown size={14}/>}
                Generate P{selected.number}.pdf
              </button>
              <p className="text-[11px] text-gray-400 mt-2">In-memory only — PDF is downloaded directly, not saved anywhere.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Custom Doc Type Panel — dynamically-added tab for any document_type
// created via Templates → "+ Add New Document Type". Manual field entry
// only (no CUSDEC link), generates the Google Sheets template PDF, and
// only offers Download/Send — there's no CUSDEC record to save a Drive
// link against, same reasoning as the Boat Note tab's Manual Entry mode.
function CustomDocPanel({ documentType, label }: { documentType: string; label: string }) {
  const [tplFields, setTplFields] = useState<{ field_label: string; is_repeating: boolean }[]>([])
  const [tplLoadError, setTplLoadError] = useState('')
  const [formValues, setFormValues] = useState<Record<string, string[]>>({})
  const [generating, setGenerating] = useState(false)
  const [status, setStatus] = useState('')
  const [pdf, setPdf] = useState<{ base64: string; fileName: string } | null>(null)
  const [sendModalOpen, setSendModalOpen] = useState(false)

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
      } catch (e: any) {
        setTplLoadError(e.message || 'Failed to load template')
      }
    }
    load()
  }, [documentType])

  async function generate() {
    setGenerating(true); setStatus(''); setPdf(null)
    try {
      const manual: Record<string, string> = {}
      Object.entries(formValues).forEach(([lbl, rows]) => { manual[lbl] = rows.join('\n') })
      const h = await authHeader()
      const res = await fetch('/api/doc-generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...h },
        body: JSON.stringify({ document_type: documentType, manual_values: manual }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Generate failed')
      setPdf({ base64: d.base64, fileName: d.fileName })
      setStatus('✓ PDF ready — download or send below')
    } catch (e: any) { setStatus(`✗ ${e.message}`) }
    finally { setGenerating(false) }
  }

  function downloadPdf() {
    if (!pdf) return
    const bytes = Uint8Array.from(atob(pdf.base64), c => c.charCodeAt(0))
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
    const a = document.createElement('a'); a.href = url; a.download = pdf.fileName; a.click()
    URL.revokeObjectURL(url)
  }

  async function onSaveModal(): Promise<{ ok: boolean; results?: SendResultFile[]; error?: string }> {
    if (!pdf) return { ok: false, error: 'No PDF generated' }
    try {
      const h = await authHeader()
      const dr = await fetch('/api/upload-to-drive', {
        method: 'POST', headers: { ...h, 'Content-Type': 'application/json' },
        body: JSON.stringify({ base64: pdf.base64, fileName: pdf.fileName, mimeType: 'application/pdf', docType: documentType }),
      })
      const dd = await dr.json()
      if (!dr.ok || !dd.driveLink) throw new Error(dd.error || 'Drive upload failed')
      return { ok: true, results: [{ fileName: pdf.fileName, driveLink: dd.driveLink, docType: documentType }] }
    } catch (e: any) { return { ok: false, error: e.message } }
  }
  async function onGetDriveLinksModal(): Promise<SendResultFile[]> {
    const res = await onSaveModal()
    return res.results || []
  }

  return (
    <div className="space-y-4">
      <p className="text-gray-500 text-sm -mt-2">{label} — fill in the template fields, generate, then download or send. Not saved to the system.</p>
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
            <button onClick={generate} disabled={generating}
              className="flex items-center justify-center gap-2 w-full py-2.5 rounded-lg text-sm text-white font-medium disabled:opacity-40 mt-1"
              style={{ background: '#3b82f6' }}>
              {generating ? <Loader size={14} className="animate-spin"/> : <FileDown size={14}/>}
              Generate {label}
            </button>
          </div>
        )}

        {status && <p className={`text-xs mt-3 font-medium ${status.startsWith('✓') ? 'text-green-600' : 'text-red-600'}`}>{status}</p>}

        {pdf && (
          <div className="flex gap-2 mt-3 pt-3 border-t border-gray-100">
            <button onClick={downloadPdf}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm text-white font-medium" style={{ background: '#1B3A5C' }}>
              <FileDown size={14}/> Download
            </button>
            <button onClick={() => setSendModalOpen(true)}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium border border-gray-200 text-gray-700 hover:bg-gray-50">
              <Send size={14}/> Send
            </button>
          </div>
        )}

        {sendModalOpen && pdf && (
          <SendModal
            label={pdf.fileName}
            docType={documentType}
            onSave={onSaveModal}
            onGetDriveLinks={onGetDriveLinksModal}
            onClose={() => setSendModalOpen(false)}
            onDone={() => setSendModalOpen(false)}
          />
        )}
      </div>
    </div>
  )
}
