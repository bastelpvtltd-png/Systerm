import { useState, useEffect, useRef } from 'react'
import AdminLayout, { usePermission } from '@/components/admin/AdminLayout'
import { authHeader } from '@/lib/supabase'
import { Anchor, Loader, RefreshCw, CheckSquare, Square, FileDown, Mail, FileStack, Receipt, Package, Plus, X, Clock, ClipboardCheck, Search, FileCode, ScanText, Copy, Save, Download, AlertTriangle, CheckCircle, Send, Trash2 } from 'lucide-react'
import SendModal, { type SendResultFile } from '@/components/admin/SendModal'
import SheetPickerModal from '@/components/admin/SheetPickerModal'
import EmailPdfModal from '@/components/admin/EmailPdfModal'
import { emptyXmlValues, buildAsycudaXml, XML_FIELD_DEFS, defaultXmlMappings, type XmlValues, type XmlMappingRow } from '@/lib/asycudaXml'
import { ALWAYS_TAB_TYPES, DEDICATED_TAB_TYPES } from '@/lib/docTypes'
import { normalizeGrossMass } from '@/lib/grossMassFormat'

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

// ── Sheet Routing (set up on Templates → Google Sheet → "Sheet Routing") ──
// The SERVER is the single place that decides which Fill/Print tab a
// document uses (lib/docGenerate.ts). A route matched by the CUSDEC's TIN VAT
// (or an "All Shippers" route) is used silently — no popup. Only when it
// can't resolve a tab does it answer 409 { needsSheetSelection, needFill,
// needPrint, sheets }, and the client shows SheetPickerModal.
//
// Whatever is picked in that popup applies to THAT ONE generate only: it is
// passed as an argument to the retry, never kept in state that later
// generates would re-send, and it is cleared the moment the generate ends.
export type SheetChoice = { fill?: string; print?: string }

async function postGenerate(url: string, headers: Record<string, string>, body: Record<string, unknown>) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })
  const d = await res.json().catch(() => ({} as any))
  return { res, d }
}

function applySheetChoice(body: Record<string, unknown>, choice?: SheetChoice) {
  if (choice?.fill) body.fill_sheet_gid = choice.fill
  if (choice?.print) body.print_sheet_gid = choice.print
}

// One instance per generate flow (Boat Note, Party's Copy Pro, each custom doc).
function useSheetPick() {
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [sheets, setSheets] = useState<{ title: string; sheetId: number }[]>([])
  const [needFill, setNeedFill] = useState(true)
  const [needPrint, setNeedPrint] = useState(true)
  const [fillGid, setFillGid] = useState('')
  const [printGid, setPrintGid] = useState('')
  // d = the 409 body from the server
  function show(d: any) {
    setMessage(d?.error || ''); setSheets(d?.sheets || [])
    setNeedFill(d?.needFill !== false); setNeedPrint(d?.needPrint !== false)
    setFillGid(''); setPrintGid(''); setOpen(true)
  }
  function close() { setOpen(false); setFillGid(''); setPrintGid('') }
  const choice: SheetChoice = { fill: needFill ? fillGid : undefined, print: needPrint ? printGid : undefined }
  return { open, message, sheets, needFill, needPrint, fillGid, printGid, setFillGid, setPrintGid, show, close, choice }
}

function SheetPick({ pick, onConfirm, busy }: { pick: ReturnType<typeof useSheetPick>; onConfirm: (choice: SheetChoice) => void; busy: boolean }) {
  if (!pick.open) return null
  return (
    <SheetPickerModal
      message={pick.message} sheets={pick.sheets}
      needFill={pick.needFill} needPrint={pick.needPrint}
      fillGid={pick.fillGid} printGid={pick.printGid}
      onFillChange={pick.setFillGid} onPrintChange={pick.setPrintGid}
      onConfirm={() => onConfirm(pick.choice)} onClose={pick.close} busy={busy}
    />
  )
}

// Drive upload only — nothing is written to the database. Used by the Send
// flow's "Mail/Notify without Save" path (SendModal's onGetDriveLinks), which
// must never save or link the document as a side effect.
async function uploadPdfToDrive(base64: string, fileName: string, docType: string, mimeType = 'application/pdf'): Promise<string> {
  const h = await authHeader()
  const dr = await fetch('/api/upload-to-drive', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...h },
    body: JSON.stringify({ base64, fileName, mimeType, docType }),
  })
  const dd = await dr.json()
  if (!dr.ok || !dd.driveLink) throw new Error(dd.error || 'Drive upload failed')
  return dd.driveLink as string
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

// Real "was this exact document already Notified?" check, read from
// Processed History's own raw log (pick_history_log via the dedicated
// /api/check-notify-history endpoint) — NOT guessed from "it already has a
// saved Drive link", which is what notifyDisabled used to be based on and
// was wrong whenever a document had been Saved (or resaved) without ever
// actually being Notified. Re-runs whenever the identifying params change;
// resolves to false (Notify stays enabled) while unknown/in flight or if
// the check itself fails, so a slow network never blocks a real Notify —
// the server-side check in document-uploads.ts is still the authoritative
// gate either way.
function useNotifyAlreadySent(params: { file_name?: string; doc_type?: string; cusdec_id?: string; single_per_cusdec?: boolean } | null) {
  const [alreadyNotified, setAlreadyNotified] = useState(false)
  useEffect(() => {
    if (!params || (!params.file_name && !(params.cusdec_id && params.doc_type))) { setAlreadyNotified(false); return }
    let cancelled = false
    authHeader().then(h => fetch('/api/check-notify-history', {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...h },
      body: JSON.stringify(params),
    }))
      .then(r => r.json())
      .then(d => { if (!cancelled) setAlreadyNotified(!!d.alreadyNotified) })
      .catch(() => { if (!cancelled) setAlreadyNotified(false) })
    return () => { cancelled = true }
  }, [params?.file_name, params?.doc_type, params?.cusdec_id, params?.single_per_cusdec])
  return alreadyNotified
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

// Mirrors docGenerate.ts's resolveColumnValue — same "col[n]" composite-value
// split support AND the same gross_mass/net_mass normalization — so
// Database mode's field preview shows exactly what generation would
// resolve, before any edits.
const WEIGHT_COLUMNS = new Set(['gross_mass', 'net_mass'])
function resolveClientValue(row: Record<string, any> | null | undefined, columnName: string): string {
  if (!row || !columnName) return ''
  const m = columnName.match(/^([a-zA-Z0-9_]+)\[(\d+)\]$/)
  const base = m ? m[1] : columnName
  const raw = m ? (String(row[m[1]] ?? '').trim().split(/\s+/)[Number(m[2])] ?? '') : (row[columnName] ?? '')
  if (WEIGHT_COLUMNS.has(base)) {
    const { formatted, ok } = normalizeGrossMass(raw)
    return ok ? formatted : raw
  }
  return raw
}

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
  const [savedBnUrl, setSavedBnUrl] = useState('')
  const [sendModalBnOpen, setSendModalBnOpen] = useState(false)
  const [bnHistoryRefreshKey, setBnHistoryRefreshKey] = useState(0)

  // Fill/Print sheet popup — shown only when the server can't resolve a tab
  // from Sheet Routing; its pick is for one generate only (see useSheetPick).
  const bnPick = useSheetPick()

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

  async function generateManualBn(choice?: SheetChoice) {
    setBnManualGenerating(true); setStatus(''); setBnPdf(null); setSavedBnUrl(''); setBoatNotes([]); setCusdecNo('')
    try {
      const manual: Record<string, string> = {}
      Object.entries(bnFormValues).forEach(([label, rows]) => { manual[label] = rows.join('\n') })
      const h = await authHeader()
      const body: Record<string, unknown> = { document_type: 'boat_note', manual_values: manual }
      applySheetChoice(body, choice)
      // Manual Entry has no TIN VAT — only an "All Shippers" route can apply;
      // otherwise the server asks (409) and the popup appears.
      const { res, d } = await postGenerate('/api/doc-generate', h, body)
      if (!res.ok) {
        if (d.needsSheetSelection) { bnPick.show(d); setStatus(''); return }
        throw new Error(d.error || 'Generate failed')
      }
      bnPick.close()
      setBnPdf({ base64: d.base64, fileName: d.fileName })
      setStatus('✓ PDF ready — download or send below')
    } catch (e: any) { bnPick.close(); setStatus(`✗ ${e.message}`) }
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
      const h = await authHeader()
      const [cr, dr] = await Promise.all([
        fetch('/api/list-records?table=cusdec&limit=200', { headers: h }),
        fetch('/api/list-records?table=cdn&limit=1000', { headers: h }),
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
      const r = await fetch(`/api/list-records?table=cdn&filter=cusdec_number&value=${cur.number}`, { headers: await authHeader() })
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

    setGen(true); setBoatNotes([]); setBnPdf(null); setSavedBnUrl(''); bnPick.close()
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

  // Split out of generate() so the Fill/Print sheet popup (shown only when
  // Sheet Routing can't resolve a tab for this shipper) can retry just the
  // PDF step, without re-running generate-boat-note again. `choice` is the
  // popup's pick for THIS call only.
  async function generateBnPdf(cusdecNoVal: string, containerCount: number, choice?: SheetChoice) {
    const h = await authHeader()
    const body: Record<string, unknown> = { document_type: 'boat_note', cusdec_id: selCusdec, cdn_ids: selCdns }
    applySheetChoice(body, choice)
    const { res: pdfRes, d: pdfD } = await postGenerate('/api/doc-generate', h, body)
    if (!pdfRes.ok) {
      if (pdfD.needsSheetSelection) { bnPick.show(pdfD); setStatus(''); return }
      throw new Error(pdfD.error || 'Template PDF generate failed')
    }
    bnPick.close()
    const cusdecDigits = cusdecNoVal.replace(/[^0-9]/g, '')
    const fileName = `B${cusdecDigits || cusdecNoVal || 'UNKNOWN'}.pdf`
    setBnPdf({ base64: pdfD.base64, fileName })
    setStatus(`✓ ${containerCount} container(s) — PDF ready`)
  }

  // Popup "Generate" for a CUSDEC-based Boat Note (Manual Entry retries via
  // generateManualBn instead).
  async function retryBnPdf(choice: SheetChoice) {
    setGen(true)
    try { await generateBnPdf(cusdecNo, boatNotes.length, choice) }
    catch (e: any) { bnPick.close(); setStatus(`✗ ${e.message}`) }
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

  // Send is the ONE way to save a Boat Note now (Save / Mail / Notify + Reason,
  // exactly like Upload Docs). The old separate "Save to System" panel is gone —
  // Send already has the Save tick, so it only duplicated it.
  async function onSaveBnModal(): Promise<{ ok: boolean; results?: SendResultFile[]; error?: string }> {
    if (!bnPdf || !selCusdec) return { ok: false, error: 'No PDF or CUSDEC selected' }
    const alreadySaved = !!(savedBnUrl || cusdecs.find(c => c.id === selCusdec)?.boat_note_url)
    if (alreadySaved && !window.confirm('Boat Note eka mekata dhanma save wela tiyenawa.\n\nOK = existing eka udin replace karanna (aluth entry ekak hadenne nha)\nCancel = skip karanna (existing eka thiyenawa)'))
      return { ok: false, error: 'Save cancelled — existing link kept as-is.' }
    try {
      const h = await authHeader()
      const driveLink = await uploadPdfToDrive(bnPdf.base64, bnPdf.fileName, 'boat_note')
      const res = await fetch('/api/save-boat-note', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...h },
        body: JSON.stringify({ cusdec_id: selCusdec, drive_url: driveLink, file_name: bnPdf.fileName }),
      })
      const sd = await res.json()
      if (!res.ok) throw new Error(sd.error)
      setSavedBnUrl(driveLink)
      return { ok: true, results: [{ fileName: bnPdf.fileName, driveLink, docType: 'boat_note', cusdecId: selCusdec, resaved: alreadySaved, singlePerCusdec: true }] }
    } catch (e: any) {
      return { ok: false, error: e.message }
    }
  }

  // Mail/Notify with Save unticked: Drive copy only — never touches the
  // database or the CUSDEC's saved Boat Note link.
  async function onGetDriveLinksBnModal(): Promise<SendResultFile[]> {
    if (!bnPdf) return []
    const driveLink = savedBnUrl || await uploadPdfToDrive(bnPdf.base64, bnPdf.fileName, 'boat_note')
    return [{ fileName: bnPdf.fileName, driveLink, docType: 'boat_note' }]
  }
  // Mail-only: attach the PDF bytes directly (nothing uploaded, nothing to clean up).
  async function onGetMailFilesBn() {
    return bnPdf ? [{ filename: bnPdf.fileName, base64: bnPdf.base64 }] : []
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
  // Real Processed History check — replaces the old "already has a saved
  // link => never Notify again" assumption (curHasBnUrl/savedBnUrl), which
  // was wrong for a Boat Note that was Saved but never actually Notified.
  const bnAlreadyNotified = useNotifyAlreadySent(
    bnEntryMode === 'cusdec' && selCusdec ? { cusdec_id: selCusdec, doc_type: 'boat_note', single_per_cusdec: true } : null
  )

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
          <button onClick={() => { setBnEntryMode('cusdec'); setBnPdf(null); setBoatNotes([]); setStatus(''); setSavedBnUrl(''); bnPick.close() }}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${bnEntryMode === 'cusdec' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
            From CUSDEC
          </button>
          <button onClick={() => { setBnEntryMode('manual'); setBnPdf(null); setBoatNotes([]); setStatus(''); setSavedBnUrl(''); bnPick.close() }}
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
                <button onClick={() => generateManualBn()} disabled={bnManualGenerating}
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
                    onClick={() => { setSelCusdec(c.id); setSelCdns([]); setBoatNotes([]); bnPick.close() }}
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
            <h2 className="font-semibold text-gray-900 text-sm mb-3">3 · Download / Send</h2>

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

                {bnEntryMode === 'cusdec' && savedBnUrl && (
                  <p className="text-xs text-green-600 flex items-center gap-1 mb-3">
                    <CheckCircle size={13}/>Saved!{" "}
                    <a href={savedBnUrl} target="_blank" rel="noreferrer" className="underline ml-1">View in Drive</a>
                  </p>
                )}

                {/* SendModal */}
                {sendModalBnOpen && bnPdf && (
                  <SendModal
                    label={bnPdf.fileName}
                    docType="boat_note"
                    requireReason
                    cusdecId={bnEntryMode === 'cusdec' ? selCusdec : undefined}
                    cusdecNumber={bnEntryMode === 'cusdec' ? cur?.number : undefined}
                    hideSaveAndNotify={bnEntryMode === 'manual'}
                    onSave={onSaveBnModal}
                    onGetDriveLinks={onGetDriveLinksBnModal}
                    onGetMailFiles={onGetMailFilesBn}
                    notifyDisabled={bnEntryMode === 'cusdec' && bnAlreadyNotified}
                    notifyDisabledReason="Already notified — Notify isn't available for a replace."
                    onClose={() => setSendModalBnOpen(false)}
                    onDone={() => { setSendModalBnOpen(false); loadCusdecs(true); setBnHistoryRefreshKey(k => k + 1) }}
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
            <GenerationHistoryPanel documentType="boat_note" refreshKey={bnHistoryRefreshKey}/>
          </div>
          )}
        </div>

        {/* Format preview note */}
        <div className="mt-4 p-3 bg-blue-50 rounded-xl border border-blue-100 text-xs text-blue-700">
          <span className="font-semibold">PDF Format:</span> SHIPPING NOTE / BOAT NOTE – Exp 3a · Landscape A4 · All fields from Excel b2 sheet (Shipper, Consignee, Voyage, Vessel, Port of Loading/Discharge, Container, CDN No., Gross Weight, Cube, SLPA, Company, Declarant)
        </div>

        <SheetPick
          pick={bnPick}
          onConfirm={choice => bnEntryMode === 'cusdec' ? retryBnPdf(choice) : generateManualBn(choice)}
          busy={generating || bnManualGenerating}
        />

        </>
        )}

        {subTab === 'cusdec-xml' && canCusdecXml && <CusdecXmlPanel/>}
        {subTab === 'cdn-text' && canCdnText && <CustomDocPanel documentType="cdn_text" label="CDN Text"/>}
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
      authHeader().then(h => fetch('/api/list-records?table=cusdec&limit=500', { headers: h })).then(r => r.json()).then(d => setCusdecs(d.records || [])).catch(() => {})
      authHeader().then(h => fetch('/api/list-records?table=cdn&limit=1000', { headers: h })).then(r => r.json()).then(d => setCdns(d.records || [])).catch(() => {})
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
      const res = await fetch(`/api/cusdec-xml?id=${id}`, { headers: await authHeader() })
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
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
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
        <GenerationHistoryPanel documentType="cusdec_xml"/>
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

  // Fill/Print sheet popup — shown only if the server can't resolve a tab
  // from Sheet Routing; its pick is for one generate only (see useSheetPick).
  const proPick = useSheetPick()

  // A Google Sheets template saved under a "Party's Copy"-ish document_type
  // (see isPartiesCopySlug) — Generate always produces this template's PDF;
  // there's no built-in jsPDF fallback layout anymore.
  const [tplDocType, setTplDocType] = useState('')

  function load() {
    authHeader().then(h => fetch('/api/list-records?table=cusdec&limit=500', { headers: h })).then(r => r.json()).then(d => setCusdecs(d.records || [])).catch(() => {})
    authHeader().then(h => fetch('/api/list-records?table=cdn&limit=500', { headers: h })).then(r => r.json()).then(d => setCdns(d.records || [])).catch(() => {})
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
  // Real Processed History check — replaces the old "already has a saved
  // link => never Notify again" assumption (curHasPartyUrl), which was
  // wrong for a Party's Copy that was Saved but never actually Notified.
  const partyAlreadyNotified = useNotifyAlreadySent(
    selected?.id ? { cusdec_id: selected.id, doc_type: 'party_copy', single_per_cusdec: true } : null
  )

  // "Generate Pro" — the real Party's Copy: the original CUSDEC PDF
  // (cusdec.pdf_url) followed by the filled-in template page(s), merged
  // into one PDF, CUSDEC pages first.
  async function generatePro(choice?: SheetChoice) {
    if (!selected || !eligible || !tplDocType) return
    setProGenerating(true); setStatus(''); setProPdf(null); setSavedPartyUrl('')
    try {
      const h = await authHeader()
      const body: Record<string, unknown> = { document_type: tplDocType, cusdec_id: selected.id }
      applySheetChoice(body, choice)
      const { res, d } = await postGenerate('/api/generate-parties-copy-pro', h, body)
      if (!res.ok) {
        if (d.needsSheetSelection) { proPick.show(d); setStatus(''); return }
        throw new Error(d.error || 'Generate failed')
      }
      proPick.close()
      setProPdf({ base64: d.base64, fileName: d.fileName })
      setStatus('✓ Ready — download or send below')
    } catch (e: any) { proPick.close(); setStatus(`✗ ${e.message}`) }
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
    if (selected.party_copy_url && !window.confirm("Party's Copy eka mekata dhanma save wela tiyenawa.\n\nOK = existing eka udin replace karanna (aluth entry ekak hadenne nha)\nCancel = skip karanna (existing eka thiyenawa)"))
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
      return { ok: true, results: [{ fileName: proPdf.fileName, driveLink: dd.driveLink, docType: 'party_copy', cusdecId: selected.id, resaved: !!(selected.party_copy_url || savedPartyUrl), singlePerCusdec: true }] }
    } catch (e: any) { return { ok: false, error: e.message } }
  }
  // Mail/Notify with Save unticked: Drive copy only — no database write, no saved link.
  async function onGetDriveLinksProModal(): Promise<SendResultFile[]> {
    if (!proPdf) return []
    const driveLink = savedPartyUrl || await uploadPdfToDrive(proPdf.base64, proPdf.fileName, 'party_copy')
    return [{ fileName: proPdf.fileName, driveLink, docType: 'party_copy' }]
  }
  async function onGetMailFilesPro() {
    return proPdf ? [{ filename: proPdf.fileName, base64: proPdf.base64 }] : []
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
              <button key={c.id} onClick={() => { setSelectedId(c.id); setStatus(''); proPick.close() }}
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

      <div className="xl:col-span-2 space-y-4">
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

              <button onClick={() => generatePro()} disabled={!eligible || proGenerating || !tplDocType}
                className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm text-white font-medium disabled:opacity-40"
                style={{ background: '#1B3A5C' }}>
                {proGenerating ? <Loader size={14} className="animate-spin"/> : <FileDown size={14}/>}
                Generate Pro
              </button>
              <p className="text-[11px] text-gray-400 mt-2">Merges the original CUSDEC PDF with the template output (CUSDEC pages first).</p>

              <SheetPick pick={proPick} onConfirm={choice => generatePro(choice)} busy={proGenerating} />

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
                  requireReason
                  cusdecId={selected?.id}
                  cusdecNumber={selected?.number}
                  onSave={onSaveProModal}
                  onGetDriveLinks={onGetDriveLinksProModal}
                  onGetMailFiles={onGetMailFilesPro}
                  onClose={() => setSendModalOpen(false)}
                  onDone={() => { setSendModalOpen(false); setPartyHistoryRefreshKey(k => k + 1) }}
                  notifyDisabled={curIsGreen || curIsBlue || partyAlreadyNotified}
                  notifyDisabledReason={
                    partyAlreadyNotified ? "Already notified — Notify isn't available for a replace." :
                    (curIsGreen || curIsBlue) ? 'Notify is not available once this CUSDEC is Green/Blue.' : undefined
                  }
                />
              )}
            </div>
          </div>
        )}
        <GenerationHistoryPanel documentType="party_copy" refreshKey={partyHistoryRefreshKey}/>
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
    authHeader().then(h => fetch('/api/list-records?table=cdn&limit=500', { headers: h })).then(r => r.json()).then(d => setCdns(d.records || [])).catch(() => {})
    authHeader().then(h => fetch('/api/list-records?table=cusdec&limit=500', { headers: h })).then(r => r.json()).then(d => setCusdecs(d.records || [])).catch(() => {})
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
  const [tplFields, setTplFields] = useState<{ field_label: string; is_repeating: boolean; data_source?: string; column_name?: string }[]>([])
  const [templateFormat, setTemplateFormat] = useState('google_sheet')
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
  // A CUSDEC can have several CDNs (one per container) — when the template
  // maps any field from 'cdn', which specific CDN's data goes in matters
  // (e.g. CDN Text is inherently per-container), so it needs its own pick
  // rather than always silently taking the first matching row.
  const [selectedCdnId, setSelectedCdnId] = useState('')

  // Already-saved link for (selected CUSDEC, this document_type) — see
  // /api/document-link.ts. Drives the "already saved, replace?" confirm and
  // the Notify lock, same rules as Boat Note/Party's Copy.
  const [savedLink, setSavedLink] = useState('')

  // Fill/Print sheet popup — shown only when the server can't resolve a tab
  // from Sheet Routing (no route for this shipper, routed tab deleted, or
  // Manual Entry with no All-Shippers route). Its pick is for one generate
  // only (see useSheetPick).
  const pick = useSheetPick()

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
        const fields = (tpl.template_mappings || []).map((m: any) => ({ field_label: m.field_label, is_repeating: !!m.is_repeating, data_source: m.data_source, column_name: m.column_name }))
        setTplFields(fields)
        setTemplateFormat(tpl.template_format || 'google_sheet')
        const init: Record<string, string[]> = {}
        fields.forEach((f: { field_label: string }) => { init[f.field_label] = [''] })
        setFormValues(init)
      } catch (e: any) {
        setTplLoadError(e.message || 'Failed to load template')
      }
    }
    load()
  }, [documentType])

  useEffect(() => {
    if (entryMode !== 'cusdec' || cusdecs.length) return
    authHeader().then(h => fetch('/api/list-records?table=cusdec&limit=500', { headers: h })).then(r => r.json()).then(d => setCusdecs(d.records || [])).catch(() => {})
    authHeader().then(h => fetch('/api/list-records?table=cdn&limit=1000', { headers: h })).then(r => r.json()).then(d => setCdns(d.records || [])).catch(() => {})
  }, [entryMode]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setSavedLink('')
    pick.close()
    if (entryMode !== 'cusdec' || !selectedCusdecId) return
    authHeader().then(h => fetch(`/api/document-link?cusdec_id=${selectedCusdecId}&document_type=${encodeURIComponent(documentType)}`, { headers: h }))
      .then(r => r.json()).then(d => setSavedLink(d.link?.drive_url || '')).catch(() => {})
  }, [entryMode, selectedCusdecId, documentType]) // eslint-disable-line react-hooks/exhaustive-deps

  const filteredCusdecs = cusdecs.filter(c =>
    !cusdecSearch || c.number?.toLowerCase().includes(cusdecSearch.toLowerCase()) || c.exporter?.toLowerCase().includes(cusdecSearch.toLowerCase())
  )
  const selectedCusdec = cusdecs.find(c => c.id === selectedCusdecId) || null
  const selectedCdns = selectedCusdec ? cdns.filter(c => c.code === selectedCusdec.code && c.cusdec_number === selectedCusdec.number) : []
  const needsCdnPick = tplFields.some(f => f.data_source === 'cdn')

  // Re-pick whenever the CUSDEC changes: auto-select the only CDN if
  // there's just one, otherwise leave it for the picker below.
  useEffect(() => {
    setSelectedCdnId(selectedCdns.length === 1 ? selectedCdns[0].id : '')
  }, [selectedCusdecId, cdns]) // eslint-disable-line react-hooks/exhaustive-deps

  // Database mode: pre-fill the same field grid Manual Entry uses, resolved
  // from the picked CUSDEC/CDN(s) — editable before Generate, same as typing
  // it by hand, just starting from real data instead of blank.
  useEffect(() => {
    if (entryMode !== 'cusdec' || !selectedCusdec || !tplFields.length) return
    const singleCdn = selectedCdns.find(c => c.id === selectedCdnId) || selectedCdns[0] || null
    const resolved: Record<string, string[]> = {}
    for (const f of tplFields) {
      if (f.data_source === 'cusdec') {
        resolved[f.field_label] = [resolveClientValue(selectedCusdec, f.column_name || '')]
      } else if (f.data_source === 'cdn') {
        resolved[f.field_label] = f.is_repeating && selectedCdns.length
          ? selectedCdns.map(c => resolveClientValue(c, f.column_name || ''))
          : [resolveClientValue(singleCdn, f.column_name || '')]
      } else {
        resolved[f.field_label] = ['']
      }
    }
    setFormValues(resolved)
  }, [entryMode, selectedCusdecId, selectedCdnId, tplFields]) // eslint-disable-line react-hooks/exhaustive-deps

  const capNum = Number(selectedCusdec?.cap || 0)
  const cdnCount = selectedCdns.length
  const curIsBlue = !!selectedCusdec?.export_release_passed
  const curIsGreen = !!selectedCusdec && !curIsBlue && capNum > 0 && cdnCount >= capNum && selectedCdns.every(c => c.boat_note_passed)
  // Real Processed History check — replaces the old "already has a saved
  // link => never Notify again" assumption (savedLink), which was wrong
  // for a document that was Saved but never actually Notified.
  const mainAlreadyNotified = useNotifyAlreadySent(
    entryMode === 'cusdec' && selectedCusdecId ? { cusdec_id: selectedCusdecId, doc_type: documentType, single_per_cusdec: true } : null
  )

  const cdnPickMissing = entryMode === 'cusdec' && needsCdnPick && selectedCdns.length > 0 && !selectedCdnId

  async function generate(choice?: SheetChoice) {
    if (entryMode === 'cusdec' && !selectedCusdecId) return
    if (cdnPickMissing) return
    setGenerating(true); setStatus(''); setPdf(null)
    try {
      const h = await authHeader()
      const body: Record<string, unknown> = { document_type: documentType }
      // Sent either way — in Database mode this doubles as the edited
      // field-preview override (see the resolve-on-select effect above);
      // the server prefers an explicit value here over the CUSDEC/CDN
      // column whenever one's present.
      const manual: Record<string, string> = {}
      Object.entries(formValues).forEach(([lbl, rows]) => { manual[lbl] = rows.join('\n') })
      body.manual_values = manual
      if (entryMode === 'cusdec') {
        body.cusdec_id = selectedCusdecId
        if (selectedCdnId) body.cdn_ids = [selectedCdnId]
      }
      applySheetChoice(body, choice)
      const { res, d } = await postGenerate('/api/doc-generate', h, body)
      if (!res.ok) {
        if (d.needsSheetSelection) { pick.show(d); setStatus(''); return }
        throw new Error(d.error || 'Generate failed')
      }
      pick.close()
      setPdf({ base64: d.base64, fileName: d.fileName, mimeType: d.mimeType, content: d.content })
      setCopied(false)
      setStatus('✓ Ready — download or send below')
    } catch (e: any) { pick.close(); setStatus(`✗ ${e.message}`) }
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
    if (entryMode === 'cusdec' && savedLink && !window.confirm(`${label} eka mekata dhanma save wela tiyenawa.\n\nOK = existing eka udin replace karanna (aluth entry ekak hadenne nha)\nCancel = skip karanna (existing eka thiyenawa)`))
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

      return { ok: true, results: [{ fileName: pdf.fileName, driveLink: dd.driveLink, docType: documentType, cusdecId: entryMode === 'cusdec' ? selectedCusdecId : undefined, resaved: entryMode === 'cusdec' && !!savedLink, singlePerCusdec: true }] }
    } catch (e: any) { return { ok: false, error: e.message } }
  }
  // Mail/Notify with Save unticked: Drive copy only — never records the saved link.
  async function onGetDriveLinksModal(): Promise<SendResultFile[]> {
    if (!pdf) return []
    const driveLink = await uploadPdfToDrive(pdf.base64, pdf.fileName, documentType, pdf.mimeType || 'application/pdf')
    return [{ fileName: pdf.fileName, driveLink, docType: documentType }]
  }
  async function onGetMailFilesModal() {
    return pdf ? [{ filename: pdf.fileName, base64: pdf.base64 }] : []
  }

  return (
    <div className="space-y-4">
      <p className="text-gray-500 text-sm -mt-2">{label} — generate from a CUSDEC's data or fill the template fields by hand, then download, or Send (tick Save there to keep it in the system).</p>

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

          {needsCdnPick && selectedCdns.length > 0 && (
            <div className="mb-3">
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Container / CDN {selectedCdns.length > 1 && <span className="text-gray-400 font-normal">— this CUSDEC has {selectedCdns.length}, pick which one</span>}
              </label>
              <select value={selectedCdnId} onChange={e => setSelectedCdnId(e.target.value)} className="input text-xs w-full">
                <option value="">— select —</option>
                {selectedCdns.map(c => <option key={c.id} value={c.id}>{c.container_no || c.id}</option>)}
              </select>
              {cdnPickMissing && <p className="text-[11px] text-amber-600 mt-1">Pick a container above first.</p>}
            </div>
          )}
          {needsCdnPick && selectedCusdec && selectedCdns.length === 0 && (
            <p className="text-[11px] text-amber-600 mb-3">No CDN found yet for this CUSDEC — container-specific fields will be blank.</p>
          )}
          {!selectedCusdecId && <p className="text-[11px] text-gray-400">Pick a CUSDEC above to see and edit its fields below.</p>}
        </div>
      )}

      <SheetPick pick={pick} onConfirm={choice => generate(choice)} busy={generating} />

      {(entryMode === 'manual' || (entryMode === 'cusdec' && selectedCusdecId && !cdnPickMissing)) && (() => {
        const isGrid = templateFormat === 'google_sheet'
        return (
        <div className={`card ${isGrid ? 'max-w-4xl' : 'max-w-xl'}`}>
        <h2 className="font-semibold text-gray-900 text-sm mb-3">
          {entryMode === 'cusdec' ? 'Fields (pulled from the database — edit any of them before generating)' : 'Fill Template Fields'}
        </h2>
        {tplLoadError ? (
          <p className="text-xs text-red-500 flex items-center gap-1"><AlertTriangle size={12}/>{tplLoadError}</p>
        ) : tplFields.length === 0 ? (
          <p className="text-xs text-gray-400">Loading template fields…</p>
        ) : (
          <div className={isGrid ? 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3' : 'space-y-3'}>
            {tplFields.map(f => {
              const rows = formValues[f.field_label] || ['']
              return (
                <div key={f.field_label} className={isGrid && f.is_repeating ? 'sm:col-span-2 lg:col-span-3' : ''}>
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
            <div className={isGrid ? 'sm:col-span-2 lg:col-span-3' : ''}>
              <button onClick={() => generate()} disabled={generating || (entryMode === 'cusdec' && (!selectedCusdecId || cdnPickMissing))}
                className="flex items-center justify-center gap-2 w-full py-2.5 rounded-lg text-sm text-white font-medium disabled:opacity-40 mt-1"
                style={{ background: '#3b82f6' }}>
                {generating ? <Loader size={14} className="animate-spin"/> : <FileDown size={14}/>}
                Generate {label}
              </button>
            </div>
          </div>
        )}
        </div>
        )
      })()}

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
          requireReason
          cusdecId={entryMode === 'cusdec' ? selectedCusdecId : undefined}
          cusdecNumber={entryMode === 'cusdec' ? selectedCusdec?.number : undefined}
          hideSaveAndNotify={entryMode === 'manual'}
          onSave={onSaveModal}
          onGetDriveLinks={onGetDriveLinksModal}
          onGetMailFiles={onGetMailFilesModal}
          onClose={() => setSendModalOpen(false)}
          onDone={() => { setSendModalOpen(false); setHistoryRefreshKey(k => k + 1) }}
          notifyDisabled={entryMode === 'cusdec' && (curIsGreen || curIsBlue || mainAlreadyNotified)}
          notifyDisabledReason={
            entryMode !== 'cusdec' ? undefined :
            mainAlreadyNotified ? "Already notified — Notify isn't available for a replace." :
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
interface HistoryDoc { id: string; doc_type: string; file_name: string; drive_url: string; created_at: string; updated_at?: string }

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

  if (!documentType) return null

  // Always rendered as its own distinct panel — not just content that
  // appears once something's been generated — so History reads as a
  // separate, permanent section per document type rather than transient
  // output tacked onto the generate flow.
  return (
    <div className="card max-w-xl mt-5">
      <h2 className="font-semibold text-gray-900 text-sm mb-3">History</h2>
      {loading ? (
        <p className="text-xs text-gray-400 flex items-center gap-1.5"><Loader size={12} className="animate-spin"/>Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-xs text-gray-400 text-center py-4">No documents generated yet</p>
      ) : (
      <div className="space-y-1.5 max-h-72 overflow-y-auto">
        {items.map(item => (
          <div key={item.id} className="flex items-center justify-between text-xs border border-gray-100 rounded-lg p-2">
            <div className="min-w-0">
              <p className="font-medium text-gray-800 truncate">{item.file_name}</p>
              <p className="text-gray-400">{new Date(item.updated_at || item.created_at).toLocaleString('en-GB')}</p>
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
      )}
      {mailItem && (
        <EmailPdfModal
          attachments={[{ filename: mailItem.file_name, url: mailItem.drive_url }]}
          onClose={() => setMailItem(null)}
        />
      )}
    </div>
  )
}