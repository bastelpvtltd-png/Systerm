import { useState, useEffect } from 'react'
import AdminLayout, { usePermission } from '@/components/admin/AdminLayout'
import { authHeader } from '@/lib/supabase'
import { Anchor, Loader, RefreshCw, CheckSquare, Square, FileDown, Mail, FileStack, Receipt, Package, Plus, X, Clock } from 'lucide-react'

type DocsCreateTab = 'invoice' | 'packing-list' | 'boat-note'

interface CusdecRec { id: string; number: string; exporter: string; consignee: string; vessel: string; voyage_no: string; bl_no: string; gross_mass: string; net_mass: string; discharge_port: string; location_of_goods: string; created_at: string }
interface CdnRec    { id: string; cdn_no: string; container_no: string; driver_name: string; cusdec_number: string; goods_description: string; gross_mass: string; vessel: string; voyage: string; voyage_date: string; bl_no: string; slpa_no: string; voc: string; coc: string; lorry_no: string; trailer_no: string; loading_port: string; discharge_port: string; location: string; pkg_no: string; pkg_type: string; volume: string; seal_no: string; con_type: string; marks: string }

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
  const subTabs = ([
    ['invoice', Receipt, 'Invoice', canInvoice],
    ['packing-list', Package, 'Packing List', canPackingList],
    ['boat-note', Anchor, 'Boat Note', canBoatNote],
  ] as const).filter(([, , , can]) => can)
  const [subTab, setSubTab] = useState<DocsCreateTab>(subTabs[0]?.[0] || 'boat-note')
  const [cusdecs, setCusdecs]   = useState<CusdecRec[]>([])
  const [cdns, setCdns]         = useState<CdnRec[]>([])
  const [selCusdec, setSelCusdec] = useState('')
  const [selCdns, setSelCdns]   = useState<string[]>([])
  const [boatNotes, setBoatNotes] = useState<BoatNote[]>([])
  const [cusdecNo, setCusdecNo] = useState('')
  const [loading, setLoading]   = useState(false)
  const [generating, setGen]    = useState(false)
  const [emailTo, setEmailTo]   = useState('bathiyapradeep7788@gmail.com')
  const [sending, setSending]   = useState(false)
  const [status, setStatus]     = useState('')

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
  const templateKeyword = subTab === 'invoice' ? 'inv' : 'pl'
  const matchingTemplates = templates.filter(t => t.name.toLowerCase().includes(templateKeyword))
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

  useEffect(() => { loadCusdecs() }, [])
  useEffect(() => { if (selCusdec) loadCdns() }, [selCusdec])

  async function loadCusdecs() {
    setLoading(true)
    try {
      const r = await fetch('/api/list-records?table=cusdec&limit=200')
      if (r.ok) { const d = await r.json(); setCusdecs(d.records || []) }
    } finally { setLoading(false) }
  }

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
    setGen(true); setBoatNotes([])
    try {
      const r = await fetch('/api/generate-boat-note', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ cusdec_id: selCusdec, cdn_ids: selCdns }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error)
      setBoatNotes(d.boat_notes || [])
      setCusdecNo(d.cusdec_no || '')
      setStatus(`✓ ${d.boat_notes.length} boat note(s) ready`)
    } catch (e: any) { setStatus(`✗ ${e.message}`) }
    finally { setGen(false) }
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

  async function downloadPdf() {
    if (!boatNotes.length) return
    const doc = await buildBoatNotePdf(boatNotes, cusdecNo)
    const dt = new Date().toISOString().slice(0,10)
    doc.save(`BOAT_NOTE_${cusdecNo}_${dt}.pdf`)
    setStatus('✓ PDF downloaded')
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
        <p className="text-gray-500 text-sm mb-4 -mt-2">SHIPPING NOTE / BOAT NOTE – Exp 3a format · Select CUSDEC → CDNs → Generate → Download / Email</p>
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">

          {/* Step 1 — CUSDEC */}
          {canSelectCusdec && (
          <div className="card">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-gray-900 text-sm">1 · Select CUSDEC</h2>
              <button onClick={loadCusdecs} className="text-gray-400 hover:text-gray-600"><RefreshCw size={13}/></button>
            </div>
            {loading ? (
              <div className="flex justify-center py-6"><Loader size={18} className="animate-spin text-gray-400"/></div>
            ) : cusdecs.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-6">No CUSDECs — import Excel file first</p>
            ) : (
              <div className="space-y-1 max-h-72 overflow-y-auto">
                {cusdecs.map(c => (
                  <button key={c.id}
                    onClick={() => { setSelCusdec(c.id); setSelCdns([]); setBoatNotes([]) }}
                    className={`w-full text-left p-2.5 rounded-lg border text-xs transition-all ${
                      selCusdec === c.id ? 'bg-blue-50 border-blue-300 shadow-sm' : 'border-gray-100 hover:bg-gray-50'
                    }`}>
                    <p className="font-bold text-gray-800">E {c.number}</p>
                    <p className="text-gray-600 truncate mt-0.5">{c.exporter?.slice(0,40)}</p>
                    <p className="text-gray-400 mt-0.5">{c.vessel} · {c.voyage_no}</p>
                  </button>
                ))}
              </div>
            )}
          </div>
          )}

          {/* Step 2 — CDNs */}
          {canSelectCdn && (
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

            {boatNotes.length > 0 ? (
              <>
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

                <button onClick={downloadPdf}
                  className="w-full flex items-center justify-center gap-2 py-2.5 mb-3 rounded-lg text-sm text-white font-medium"
                  style={{ background: '#1B3A5C' }}>
                  <FileDown size={14}/> Download PDF (Exp 3a format)
                </button>

                <div className="border-t border-gray-100 pt-3 space-y-2">
                  <p className="text-xs font-medium text-gray-600">Send Email</p>
                  <input value={emailTo} onChange={e => setEmailTo(e.target.value)}
                    className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-blue-400"
                    placeholder="recipient@email.com"/>
                  <button onClick={sendEmail} disabled={sending || !emailTo}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm text-white font-medium disabled:opacity-40"
                    style={{ background: '#22A87A' }}>
                    {sending ? <Loader size={14} className="animate-spin"/> : <Mail size={14}/>}
                    Send Email
                  </button>
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Anchor size={32} className="text-gray-200 mb-3"/>
                <p className="text-sm text-gray-400">Select CUSDEC + containers<br/>then click Generate</p>
              </div>
            )}
          </div>
          )}
        </div>

        {/* Format preview note */}
        <div className="mt-4 p-3 bg-blue-50 rounded-xl border border-blue-100 text-xs text-blue-700">
          <span className="font-semibold">PDF Format:</span> SHIPPING NOTE / BOAT NOTE – Exp 3a · Landscape A4 · All fields from Excel b2 sheet (Shipper, Consignee, Voyage, Vessel, Port of Loading/Discharge, Container, CDN No., Gross Weight, Cube, SLPA, Company, Declarant)
        </div>

        {/* Quick Upload — CUSDEC XML + PDF, ephemeral, admin-only */}
        {isAdmin && (
          <div className="card mt-5">
            <div className="flex items-center justify-between mb-1">
              <h2 className="font-semibold text-gray-900 text-sm flex items-center gap-2"><Anchor size={15}/>Quick Upload (CUSDEC XML + PDF)</h2>
              <button onClick={resetQuickUpload} className="text-xs text-gray-400 hover:text-gray-600">Reset</button>
            </div>
            <p className="text-xs text-gray-500 mb-3">Admin only · Temporary — nothing uploaded here is saved to the database or Drive. Upload a CUSDEC XML to auto-fill what it has, fill in the rest, then Generate & Download. Refresh the page and it's all gone.</p>

            {quickStatus && (
              <p className={`text-xs mb-3 font-medium ${quickStatus.startsWith('✓') ? 'text-green-600' : 'text-red-600'}`}>{quickStatus}</p>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">CUSDEC XML</label>
                <div className="flex items-center gap-2">
                  <input type="file" accept=".xml" onChange={e => setQuickXmlFile(e.target.files?.[0] || null)} className="text-xs flex-1"/>
                  <button onClick={parseQuickXml} disabled={!quickXmlFile || quickParsing} className="btn-secondary text-xs px-3 py-1.5 flex items-center gap-1.5 flex-shrink-0">
                    {quickParsing ? <Loader size={12} className="animate-spin"/> : null}Parse
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Supporting PDF (kept on this page only, not uploaded anywhere)</label>
                <input type="file" accept=".pdf" onChange={e => setQuickPdfFile(e.target.files?.[0] || null)} className="text-xs"/>
                {quickPdfFile && <p className="text-[11px] text-gray-400 mt-1">{quickPdfFile.name}</p>}
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-3">
              <Field label="Shipper"><input value={quickFields.shipper} onChange={e => setQuickField('shipper', e.target.value)} className="input text-xs"/></Field>
              <Field label="Consignee"><input value={quickFields.consignee} onChange={e => setQuickField('consignee', e.target.value)} className="input text-xs"/></Field>
              <Field label="Entry No."><input value={quickFields.entry_no} onChange={e => setQuickField('entry_no', e.target.value)} className="input text-xs"/></Field>
              <Field label="B/L No."><input value={quickFields.bl_no} onChange={e => setQuickField('bl_no', e.target.value)} className="input text-xs"/></Field>
              <Field label="Vessel"><input value={quickFields.vessel} onChange={e => setQuickField('vessel', e.target.value)} className="input text-xs"/></Field>
              <Field label="Voyage / Date"><input value={quickFields.voyage} onChange={e => setQuickField('voyage', e.target.value)} className="input text-xs"/></Field>
              <Field label="Gross Weight (Kg)"><input value={quickFields.gross_mass} onChange={e => setQuickField('gross_mass', e.target.value)} className="input text-xs"/></Field>
              <Field label="Goods Description"><input value={quickFields.goods} onChange={e => setQuickField('goods', e.target.value)} className="input text-xs"/></Field>
              <Field label="Container No."><input value={quickFields.container_no} onChange={e => setQuickField('container_no', e.target.value)} className="input text-xs"/></Field>
              <Field label="CDN No."><input value={quickFields.cdn_no} onChange={e => setQuickField('cdn_no', e.target.value)} className="input text-xs"/></Field>
              <Field label="Seal No."><input value={quickFields.seal_no} onChange={e => setQuickField('seal_no', e.target.value)} className="input text-xs"/></Field>
              <Field label="SLPA No."><input value={quickFields.slpa_no} onChange={e => setQuickField('slpa_no', e.target.value)} className="input text-xs"/></Field>
              <Field label="Terminal"><input value={quickFields.terminal} onChange={e => setQuickField('terminal', e.target.value)} className="input text-xs"/></Field>
              <Field label="Loading Port"><input value={quickFields.loading_port} onChange={e => setQuickField('loading_port', e.target.value)} className="input text-xs"/></Field>
              <Field label="Discharge Port"><input value={quickFields.discharge_port} onChange={e => setQuickField('discharge_port', e.target.value)} className="input text-xs"/></Field>
              <Field label="Lorry / Trailer"><input value={quickFields.lorry_no} onChange={e => setQuickField('lorry_no', e.target.value)} className="input text-xs"/></Field>
              <Field label="Driver"><input value={quickFields.driver_name} onChange={e => setQuickField('driver_name', e.target.value)} className="input text-xs"/></Field>
            </div>

            <button onClick={generateQuickBoatNote} disabled={quickGenerating}
              className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm text-white font-medium disabled:opacity-40"
              style={{ background: '#1B3A5C' }}>
              {quickGenerating ? <Loader size={14} className="animate-spin"/> : <FileDown size={14}/>}
              Generate & Download PDF
            </button>
          </div>
        )}
        </>
        )}
      </div>
  )
}
