import { useCallback, useEffect, useRef, useState } from 'react'
import AdminLayout, { usePermission } from '@/components/admin/AdminLayout'
import { authHeader, supabase } from '@/lib/supabase'
import { applyTextRules } from '@/lib/textClean'
import EmailPdfModal, { type EmailAttachment } from '@/components/admin/EmailPdfModal'
import {
  Upload, FileText, Package, ScanLine, Ship, Copy, Receipt,
  CheckCircle, Loader, Save, ExternalLink, AlertTriangle, X,
  Trash2, Pencil, FileWarning, Eye, RefreshCw, Plus, Lock, Unlock, Mail,
  CheckSquare, Square, History, Send, Search, ChevronDown,
} from 'lucide-react'
import SendModal, { type SendResultFile } from '@/components/admin/SendModal'

// Three panels here, each gated by its own permission:
// - Upload PDFs + Uploaded (normal access — simple view/rename/save/delete)
// - All Documents preview (saved documents, from anyone, read-only)
// - Admin Edit (full box/template editor — same as /admin/documents, kept
//   separate so admin can grant it selectively; regular users only ever get
//   the Upload + Uploaded panels via allowed_tabs)

type DocType = 'cusdec' | 'cdn' | 'barcode' | 'boat_note' | 'party_copy' | 'bill'
type PdfField = {
  key: string; label: string; value: string
  rawValue?: string
  excludeWords?: string
  formula?: string
  // A free-text note on what this box's data is supposed to look like (e.g.
  // "numbers only", "DD/MM/YYYY") — documentation for whoever draws/redraws
  // the box next, not an enforced validator. Saved/loaded the same
  // merge-safe way as excludeWords/formula (see save-field-rules.ts).
  specNote?: string
  locked?: boolean
}
type Panel = 'upload' | 'preview' | 'admin-edit' | 'bills'
type ItemStatus = 'reading' | 'extracting' | 'ready' | 'saving' | 'saved' | 'error' | 'skipped'

// CDN's container_no is expected to be the standard ISO 6346 shape (4
// letters + 7 digits, no space — see textClean.ts's CONTAINERNO() formula).
// Flagged here as a visible error rather than silently accepted/rejected —
// the field stays a normal editable textarea either way, this only warns
// when what's currently in it doesn't look right so it can be hand-corrected
// before Save/Send.
function isBadContainerNo(docType: string | undefined, field: PdfField): boolean {
  if (docType !== 'cdn' || field.key !== 'container_no') return false
  const v = field.value.trim()
  return !!v && !/^[A-Z]{4}\d{7}$/.test(v.toUpperCase())
}

// CUSDEC number must have at least one English letter AND at least one digit.
// Typical: "E 38812", "CE 12345". All-digit or all-letter values are wrong.
function isBadCusdecNumber(docType: string | undefined, field: PdfField): boolean {
  if (docType !== 'cusdec' || field.key !== 'number') return false
  const v = field.value.replace(/\s/g, '')
  if (!v) return false
  return !/[A-Za-z]/.test(v) || !/\d/.test(v)
}

// Auto-normalize known fields immediately after extraction (both native + scanned).
// CDN container_no: strip all spaces and uppercase → "MSCU 1234567" → "MSCU1234567".
function normalizeFieldValue(docType: string, key: string, value: string): string {
  if (docType === 'cdn' && key === 'container_no') {
    return value.replace(/\s+/g, '').toUpperCase()
  }
  return value
}

interface PctBox { x: number; y: number; w: number; h: number; page?: number }

interface UploadItem {
  id: string
  file: File
  fileName: string
  base64: string
  status: ItemStatus
  detectedType: DocType | ''
  fields: PdfField[]
  rawText: string
  scanned: boolean
  driveLink: string
  error: string
  pageImages: Record<number, string>
  numPages: number
  boxes: Record<string, PctBox>
  variant: 'native' | 'scanned'
  savedReference?: string
}

interface DbRecord {
  id: string; doc_type: string; file_name: string
  drive_url: string; extracted_data: Record<string, string> | null; created_at: string
}

const DOC_TYPES: { key: DocType; label: string; icon: any; color: string }[] = [
  { key: 'cusdec',     label: 'CUSDEC',       icon: FileText, color: '#1B3A5C' },
  { key: 'cdn',        label: 'CDN',           icon: Package,  color: '#22A87A' },
  { key: 'barcode',    label: 'Barcode',       icon: ScanLine, color: '#f59e0b' },
  { key: 'boat_note',  label: 'Boat Note',     icon: Ship,     color: '#3b82f6' },
  { key: 'party_copy', label: "Party's Copy",  icon: Copy,     color: '#8b5cf6' },
  { key: 'bill',       label: 'Bill',          icon: Receipt,  color: '#ef4444' },
]

const TYPE_COLORS: Record<string, string> = {
  cusdec: '#1B3A5C', cdn: '#22A87A', barcode: '#f59e0b',
  boat_note: '#3b82f6', party_copy: '#8b5cf6', bill: '#ef4444',
}

// Mirrors DOC_TYPE_TABLE from lib/docTables.ts (server-only, can't be
// imported client-side) — just for routing the match-edit PATCH to the
// right table.
const DOC_TYPE_TABLE: Record<string, string> = { cusdec: 'cusdec', cdn: 'cdn', barcode: 'barcode', boat_note: 'boat_notes' }

function docDef(key: string) {
  return DOC_TYPES.find(d => d.key === key)
}

function statusLabel(it: UploadItem) {
  switch (it.status) {
    case 'reading':    return 'Reading...'
    case 'extracting': return 'Detecting type...'
    case 'ready':      return it.scanned ? 'Scanned — select type' : 'Ready to save'
    case 'saving':     return 'Saving...'
    case 'saved':      return it.savedReference ? `Saved → ${it.savedReference}` : 'Saved'
    case 'error':      return it.error || 'Error'
    case 'skipped':    return 'Skipped — not saved'
  }
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve((reader.result as string).split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

// getLayout (see _app.tsx) keeps AdminLayout mounted across navigations
// instead of remounting the sidebar on every tab click.
export default function DocumentsUploadPage() {
  return <DocumentsUploadContent/>
}
DocumentsUploadPage.getLayout = (page: React.ReactElement) => <AdminLayout>{page}</AdminLayout>

function DocumentsUploadContent() {
  const { has, isAdmin } = usePermission()
  const canUpload = has('section:documents-upload.upload')
  const canSeeUploaded = has('section:documents-upload.uploaded')
  const canPreview = has('section:documents-upload.preview')
  const canAdminEdit = has('section:documents-upload.admin-edit')
  const canBills = isAdmin || has('section:documents-upload.bills')
  const [uploaderName, setUploaderName] = useState('')
  const [uploaderId, setUploaderId] = useState('')
  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return
      setUploaderId(user.id)
      const { data } = await supabase.from('profiles').select('username, full_name').eq('id', user.id).single()
      setUploaderName(data?.full_name || data?.username || '')
    })
  }, [])

  // uploaderName/uploaderId above are populated by an async effect on mount —
  // if a save happens before that resolves (very first upload right after
  // page load), fall back to fetching the session directly here so we never
  // send an empty/garbage uploaded_by. This is what previously caused the
  // "first PDF upload fails, needs a refresh" bug: uploaded_documents.uploaded_by
  // is a uuid column, so an unresolved/empty value threw "invalid input syntax
  // for type uuid" — refreshing just gave the effect time to finish first.
  async function getUploader(): Promise<{ id: string; name: string }> {
    if (uploaderId) return { id: uploaderId, name: uploaderName }
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { id: '', name: uploaderName }
    const { data } = await supabase.from('profiles').select('username, full_name').eq('id', user.id).single()
    const name = data?.full_name || data?.username || ''
    setUploaderId(user.id)
    setUploaderName(name)
    return { id: user.id, name }
  }
  const [panel, setPanel] = useState<Panel>('upload')
  const [items, setItems] = useState<UploadItem[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // Which popup to show for the currently-selected item: the plain viewer
  // (opened from Uploaded) or the full box/template editor (opened from Admin Edit)
  const [popupMode, setPopupMode] = useState<'simple' | 'full'>('simple')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [viewPage, setViewPage] = useState(0)
  const [error, setError] = useState('')
  // Duplicate/CAP conflict resolution — shown instead of saving immediately
  // when the extracted data matches something already saved.
  const [matchModal, setMatchModal] = useState<{ item: UploadItem; matches: any[]; capInfo: any; table: string } | null>(null)
  const [capModal, setCapModal] = useState<{ item: UploadItem; capInfo: any } | null>(null)
  // Shown after a CUSDEC save when its Invoice Number didn't auto-match any
  // pending Shipment entry — lets the user pick the right one by hand.
  const [shipmentPickModal, setShipmentPickModal] = useState<{ cusdecId: string; shipments: any[] } | null>(null)
  const [resolvingConflict, setResolvingConflict] = useState(false)
  // Email is a standalone action, not a gate in the save flow — a plain
  // Email button shows up on any saved item (here and in Preview/Shipment
  // Overview) instead of interrupting every save with a Yes/No prompt.
  const [emailAttachments, setEmailAttachments] = useState<EmailAttachment[] | null>(null)
  // Upload workflow's Save/Mail/Notify "Send" modal (replaces the old
  // immediate one-click Save in the simple popup).
  const [sendModalItem, setSendModalItem] = useState<UploadItem | null>(null)
  // Preview's "select just the PDFs you need" multi-email, mirroring Shipment
  // Overview's picker.
  const [selectedPreviewDocs, setSelectedPreviewDocs] = useState<Record<string, EmailAttachment>>({})
  function togglePreviewDoc(id: string, attachment: EmailAttachment) {
    setSelectedPreviewDocs(prev => {
      const next = { ...prev }
      if (next[id]) delete next[id]; else next[id] = attachment
      return next
    })
  }
  // Mail History — only this signed-in user's own sent mail (email-history.ts).
  const [showMailHistory, setShowMailHistory] = useState(false)
  const [mailHistory, setMailHistory] = useState<any[]>([])
  const [loadingMailHistory, setLoadingMailHistory] = useState(false)
  async function loadMailHistory() {
    setLoadingMailHistory(true)
    try {
      const res = await fetch('/api/email-history', { headers: await authHeader() })
      const d = await res.json()
      if (res.ok) setMailHistory(d.items || [])
    } finally { setLoadingMailHistory(false) }
  }
  const fileRef = useRef<HTMLInputElement>(null)

  // Full editor state (box drawing, field table) — same as /admin/documents
  const [activeFieldIdx, setActiveFieldIdx] = useState<number | null>(null)
  const [drag, setDrag] = useState<{ fieldIdx: number; mode: 'draw' | 'move' | 'resize'; startMouse: { x: number; y: number }; startBox: PctBox } | null>(null)
  const [liveBox, setLiveBox] = useState<PctBox | null>(null)
  const [extractingBox, setExtractingBox] = useState(false)
  const [savingFormat, setSavingFormat] = useState(false)
  const [copyingBoxes, setCopyingBoxes] = useState(false)
  const imageAreaRef = useRef<HTMLDivElement>(null)
  const fieldsScrollRef = useRef<HTMLDivElement>(null)

  // "All Documents" preview — saved documents from anyone, not just this session
  const [records, setRecords] = useState<DbRecord[]>([])
  const [loadingRecs, setLoadingRecs] = useState(false)
  const [selectedRec, setSelectedRec] = useState<DbRecord | null>(null)
  const [filterType, setFilterType] = useState('all')
  const [recPage, setRecPage] = useState(0)
  const [recPageImages, setRecPageImages] = useState<Record<string, Record<number, string>>>({})
  const [recNumPages, setRecNumPages] = useState(1)
  const [recLoadingImg, setRecLoadingImg] = useState(false)

  const loadRecords = useCallback(async (silent = false) => {
    if (!silent) setLoadingRecs(true)
    try {
      const url = filterType === 'all' ? '/api/list-documents' : `/api/list-documents?doc_type=${filterType}`
      const res = await fetch(url, { headers: await authHeader() })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Failed to load documents')
      setRecords(d.records || [])
    } catch (e: any) {
      if (!silent) setError(e.message)
    } finally {
      if (!silent) setLoadingRecs(false)
    }
  }, [filterType])

  useEffect(() => {
    if (panel !== 'preview') return
    loadRecords()
    // Live — a document someone else just saved shows up here without a
    // refresh; an open preview (selectedRec below) is separate state.
    const t = setInterval(() => loadRecords(true), 15000)
    return () => clearInterval(t)
  }, [panel, loadRecords])
  useEffect(() => { setRecPage(0) }, [selectedRec?.id])
  useEffect(() => {
    if (!selectedRec || !selectedRec.drive_url) return
    if (recPageImages[selectedRec.id]?.[recPage]) return
    setRecLoadingImg(true)
    authHeader().then(h => fetch('/api/render-drive-page', {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...h },
      body: JSON.stringify({ driveUrl: selectedRec.drive_url, page: recPage }),
    }))
      .then(r => r.json())
      .then(d => {
        if (d.png) {
          setRecPageImages(prev => ({ ...prev, [selectedRec.id]: { ...(prev[selectedRec.id] || {}), [recPage]: d.png } }))
          setRecNumPages(d.numPages || 1)
        }
      })
      .catch(() => {})
      .finally(() => setRecLoadingImg(false))
  }, [selectedRec?.id, selectedRec?.drive_url, recPage])

  function updateItem(id: string, patch: Partial<UploadItem>) {
    setItems(prev => prev.map(it => it.id === id ? { ...it, ...patch } : it))
  }

  // Shared by the initial upload and Retry — Retry reuses the base64 already
  // read off the file the first time, so a transient "invalid pdf structure"
  // (see extract-pdf.ts's own retry — this is the rare case that still slips
  // through) can be tried again without asking the user to re-select the file.
  async function extractOne(itemId: string, base64: string) {
    updateItem(itemId, { base64, status: 'extracting', error: '' })
    try {
      const res = await fetch('/api/extract-pdf', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ base64 }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Extraction failed')
      updateItem(itemId, {
        status: 'ready',
        detectedType: (json.detectedDocType as DocType) || '',
        fields: (json.fields || []).map((f: PdfField) => {
          const normalized = normalizeFieldValue(json.detectedDocType || '', f.key, f.value)
          return { ...f, rawValue: f.value, value: normalized }
        }),
        rawText: json.rawText || '',
        scanned: !!json.scanned,
        boxes: json.boxes || {},
        variant: json.variant === 'scanned' ? 'scanned' : 'native',
      })
    } catch (e: any) {
      updateItem(itemId, { status: 'error', error: e.message })
      setError(e.message)
    }
  }

  async function retryExtraction(item: UploadItem) {
    if (item.base64) return extractOne(item.id, item.base64)
    // Fallback for the rare case the base64 wasn't captured before the error
    // (e.g. FileReader itself failed) — re-read straight from the same File.
    const base64 = await fileToBase64(item.file)
    return extractOne(item.id, base64)
  }

  // A file that keeps failing shouldn't block the rest of a "Save All" batch
  // — marking it skipped removes it from that batch (handleSaveAll only
  // picks up 'ready'/'error') while keeping it visible in the list instead of
  // silently deleting it.
  function skipItem(id: string) {
    updateItem(id, { status: 'skipped' })
  }

  async function handleFiles(fileList: FileList | null) {
    if (!fileList || !fileList.length) return
    const pdfFiles = Array.from(fileList).filter(f => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'))
    const newItems: UploadItem[] = pdfFiles.map(file => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      file, fileName: file.name, base64: '', status: 'reading',
      detectedType: '', fields: [], rawText: '', scanned: false, driveLink: '', error: '', boxes: {},
      pageImages: {}, numPages: 1, variant: 'native',
    }))
    if (!newItems.length) return
    setItems(prev => [...prev, ...newItems])

    for (const item of newItems) {
      const base64 = await fileToBase64(item.file)
      await extractOne(item.id, base64)
    }
  }

  function removeItem(id: string) {
    setItems(prev => prev.filter(it => it.id !== id))
    if (selectedId === id) setSelectedId(null)
  }

  function startRename(item: UploadItem, e?: React.MouseEvent) {
    e?.stopPropagation()
    setRenamingId(item.id)
    setRenameValue(item.fileName)
  }
  function commitRename(id: string) {
    updateItem(id, { fileName: renameValue.trim() || 'document.pdf' })
    setRenamingId(null)
  }

  function updateItemField(id: string, idx: number, val: string) {
    setItems(prev => prev.map(it => {
      if (it.id !== id) return it
      return {
        ...it, fields: it.fields.map((f, i) => {
          if (i !== idx) return f
          const normalized = normalizeFieldValue(it.detectedType, f.key, val)
          return { ...f, value: normalized, rawValue: val }
        }),
      }
    }))
  }

  function updateFieldRuleText(id: string, idx: number, patch: Partial<Pick<PdfField, 'excludeWords' | 'formula' | 'specNote'>>) {
    setItems(prev => prev.map(it => it.id === id
      ? { ...it, fields: it.fields.map((f, i) => i === idx ? { ...f, ...patch } : f) }
      : it))
  }

  async function commitFieldRules(id: string, idx: number) {
    let updatedField: PdfField | undefined
    let docType = ''
    let variant: 'native' | 'scanned' = 'native'
    setItems(prev => prev.map(it => {
      if (it.id !== id) return it
      docType = it.detectedType
      variant = it.variant
      return {
        ...it, fields: it.fields.map((f, i) => {
          if (i !== idx) return f
          updatedField = { ...f, value: applyTextRules(f.rawValue ?? f.value, f.formula, f.excludeWords) }
          return updatedField
        }),
      }
    }))
    if (!docType || !updatedField) return
    try {
      const res = await fetch('/api/save-field-rules', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({
          doc_type: docType, key: updatedField.key, label: updatedField.label,
          excludeWords: updatedField.excludeWords, formula: updatedField.formula, specNote: updatedField.specNote, variant,
        }),
      })
      const d = await res.json()
      if (!res.ok) setError(d.error || 'Rule save failed')
    } catch (e: any) {
      setError(e.message)
    }
  }

  function setFieldFromOcr(id: string, idx: number, rawText: string) {
    setItems(prev => prev.map(it => {
      if (it.id !== id) return it
      return {
        ...it, fields: it.fields.map((f, i) => {
          if (i !== idx) return f
          const applied = applyTextRules(rawText, f.formula, f.excludeWords)
          const normalized = normalizeFieldValue(it.detectedType, f.key, applied)
          return { ...f, rawValue: rawText, value: normalized }
        }),
      }
    }))
  }

  async function useSharedBox(id: string, idx: number, sourceIdx: number) {
    const item = items.find(it => it.id === id)
    if (!item || sourceIdx < 0) return
    const sourceField = item.fields[sourceIdx]
    const sourceBox = item.boxes[sourceField.key]
    if (!sourceBox) return
    const targetKey = item.fields[idx].key
    updateItem(id, { boxes: { ...item.boxes, [targetKey]: sourceBox } })
    setFieldFromOcr(id, idx, sourceField.rawValue ?? sourceField.value)
    await commitFieldRules(id, idx)
  }

  // Actually uploads to Drive + writes the generic uploaded_documents row +
  // the doc-type's structured table row. mode/replaceId decide whether
  // save-to-table deletes a matched row first (+ its Drive file) or just
  // inserts alongside what's already there.
  async function persistItem(item: UploadItem, mode: 'insert' | 'replace', replaceId?: string, referenceOverride?: string) {
    const docType = item.detectedType || 'cusdec'
    updateItem(item.id, { status: 'saving' })
    try {
      const uploader = await getUploader()
      let link = ''
      try {
        const dr = await fetch('/api/upload-to-drive', {
          method: 'POST', headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
          body: JSON.stringify({ base64: item.base64, fileName: item.fileName, mimeType: 'application/pdf', docType }),
        })
        const dd = await dr.json()
        if (dr.ok && dd.driveLink) link = dd.driveLink
      } catch {}

      // uploaded_documents (the generic log) and the structured table row are
      // independent writes — neither depends on the other's result, so run
      // them together instead of one-after-the-other.
      const savePromise = fetch('/api/save-document', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({
          // uploaded_documents.uploaded_by is a uuid column — must be the
          // user's id, not their display name (that was the invalid-input-
          // syntax bug on every save).
          doc_type: docType, file_name: item.fileName, file_url: '', drive_url: link, uploaded_by: uploader.id || null,
          extracted_data: item.fields.length ? Object.fromEntries(item.fields.map(f => [`grid_${f.key}`, f.value])) : null,
        }),
      })
      // A reference passed in from SendModal's "CUSDEC Passed" flow (already
      // confirmed to match an open Shipment Entry) rides along on the row
      // itself so matchAndMergeShipment finds and merges it on save.
      const tableData = Object.fromEntries(item.fields.map(f => [f.key, f.value]))
      if (referenceOverride && docType === 'cusdec') tableData.reference = referenceOverride
      const tablePromise = item.fields.length
        ? fetch('/api/save-to-table', {
            method: 'POST', headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
            body: JSON.stringify({ doc_type: docType, data: tableData, drive_url: link, mode, replace_id: replaceId }),
          })
        : null

      const sr = await savePromise
      const sd = await sr.json()
      if (!sr.ok) throw new Error(sd.error || 'Save failed')

      let cusdecId: string | undefined
      if (tablePromise) {
        const tr = await tablePromise
        const td = await tr.json()
        if (!tr.ok) setError(td.error || 'Table save failed')
        else if (docType === 'cusdec' && td.cusdecId) {
          cusdecId = td.cusdecId
          if (td.shipmentMatch && !td.shipmentMatch.matched) {
            // No auto-match — offer manual matching against open shipment entries.
            fetch('/api/temp-shipments', { headers: await authHeader() })
              .then(r => r.json())
              .then(d => { if (d.shipments?.length) setShipmentPickModal({ cusdecId: td.cusdecId, shipments: d.shipments }) })
              .catch(() => {})
          }
        }
      }

      updateItem(item.id, { status: 'saved', driveLink: link, savedReference: referenceOverride || undefined })
      return { ok: true, driveLink: link, cusdecId }
    } catch (e: any) {
      updateItem(item.id, { status: 'error', error: e.message })
      setError(e.message)
      return { ok: false, error: e.message }
    }
  }

  // Send modal's "Mail/Notify without Save" path — uploads to Drive so the
  // file has a real, viewable link, but never touches uploaded_documents or
  // the structured table (that's what makes it distinct from a real Save).
  async function uploadToDriveOnly(item: UploadItem): Promise<string> {
    const res = await fetch('/api/upload-to-drive', {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
      body: JSON.stringify({ base64: item.base64, fileName: item.fileName, mimeType: 'application/pdf', docType: item.detectedType || 'cusdec' }),
    })
    const d = await res.json()
    if (!res.ok || !d.driveLink) throw new Error(d.error || 'Drive upload failed')
    return d.driveLink
  }

  // Before actually saving: check whether this looks like a document that's
  // already been saved (CUSDEC: code+number+date, CDN/Barcode: container_no).
  // If so, show every match instead of silently creating a duplicate. For
  // CDN, also check the CUSDEC's CAP (how many CDN rows it should have)
  // before allowing a brand-new row.
  async function saveOne(item: UploadItem, referenceOverride?: string) {
    // A PDF whose type couldn't be identified, or whose fields came back
    // empty (nothing extracted), must not be saved — it would create a
    // structured-table row with no real data. The user has to fix
    // identification/extraction (pick the type manually, draw boxes in
    // Admin Edit) before it can go through.
    if (!item.detectedType) {
      setError(`"${item.fileName}" — document type could not be identified. Select it manually before saving.`)
      updateItem(item.id, { status: 'error', error: 'Type not identified' })
      return { ok: false, error: 'Type not identified' }
    }
    if (!item.fields.some(f => f.value && f.value.trim())) {
      setError(`"${item.fileName}" — no data could be extracted from this PDF. It can't be saved until fields have values (draw boxes in Admin Edit).`)
      updateItem(item.id, { status: 'error', error: 'No data extracted' })
      return { ok: false, error: 'No data extracted' }
    }
    const docType = item.detectedType || 'cusdec'

    // Field format warnings — shown before save, user can proceed or cancel.
    for (const f of item.fields) {
      if (isBadContainerNo(item.detectedType, f)) {
        const go = window.confirm(
          `⚠ Container No. "${f.value}" does not match ISO 6346 format (4 letters + 7 digits, e.g. MSCU1234567).\n\nSave anyway?`
        )
        if (!go) return { ok: false, error: 'Cancelled — fix Container No. first' }
      }
      if (isBadCusdecNumber(item.detectedType, f)) {
        const go = window.confirm(
          `⚠ CUSDEC No. "${f.value}" looks wrong — it should have both English letters and digits (e.g. E 38812).\n\nSave anyway?`
        )
        if (!go) return { ok: false, error: 'Cancelled — fix CUSDEC No. first' }
      }
    }
    const data = Object.fromEntries(item.fields.map(f => [f.key, f.value]))
    try {
      const res = await fetch('/api/check-document-match', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ doc_type: docType, data }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Duplicate check failed')
      if (d.cusdecMissing) {
        const num = data.cusdec_number || ''
        const msg = `CDN eka save karana pita, paha CUSDEC eka (${num}) add karanna. CUSDEC eka system eke naha.`
        setError(msg)
        updateItem(item.id, { status: 'error', error: msg })
        return { ok: false, error: msg }
      }
      if (d.cdnMissing) {
        const cno = data.container_no || ''
        const msg = `Barcode eka save karana pita, paha CDN eka (${cno}) add karanna. Meka container eke CDN eka system eke naha.`
        setError(msg)
        updateItem(item.id, { status: 'error', error: msg })
        return { ok: false, error: msg }
      }
      if (d.matches?.length) {
        setMatchModal({ item, matches: d.matches, capInfo: d.capInfo, table: DOC_TYPE_TABLE[docType] })
        return { ok: false, error: 'A matching document already exists — resolve it above, then Send again.' }
      }
      if (d.capInfo && d.capInfo.currentCount >= d.capInfo.cap) {
        setCapModal({ item, capInfo: d.capInfo })
        return { ok: false, error: "This CUSDEC's CAP is already full — resolve it above, then Send again." }
      }
    } catch (e: any) {
      setError(e.message)
      return { ok: false, error: e.message }
    }
    return await persistItem(item, 'insert', undefined, referenceOverride)
  }

  // A batch Send steps through one SendModal per file (see batchQueue below)
  // — but match/cap conflicts are resolved through matchModal/capModal, a
  // separate popup outside that SendModal entirely. Once one of those
  // resolves the CURRENT batch item, the stuck SendModal (still showing
  // "resolve it above" from the original check-document-match failure)
  // needs to be swapped out for the next file instead of sitting there.
  function settleBatchItem(itemId: string) {
    setBatchQueue(prev => (prev && prev[0]?.id === itemId) ? (prev.length > 1 ? prev.slice(1) : null) : prev)
  }

  async function resolveMatchReplace(matchId: string) {
    if (!matchModal) return
    const { item } = matchModal
    setMatchModal(null)
    await persistItem(item, 'replace', matchId)
    settleBatchItem(item.id)
  }

  async function resolveMatchAddNew() {
    if (!matchModal) return
    const { item, capInfo } = matchModal
    setMatchModal(null)
    if (capInfo && capInfo.currentCount >= capInfo.cap) {
      setCapModal({ item, capInfo })
      return
    }
    await persistItem(item, 'insert')
    settleBatchItem(item.id)
  }

  function updateMatchDraft(matchId: string, key: string, value: string) {
    setMatchModal(prev => prev && ({
      ...prev,
      matches: prev.matches.map((m: any) => m.id === matchId ? { ...m, [key]: value } : m),
    }))
  }

  async function saveMatchEdit(match: any) {
    if (!matchModal) return
    setResolvingConflict(true)
    try {
      const { id, created_at, uploaded_at, ...updates } = match
      const res = await fetch('/api/admin-data', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ table: matchModal.table, id, updates }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Save failed')
    } catch (e: any) {
      setError(e.message)
    } finally {
      setResolvingConflict(false)
    }
  }

  async function resolveManualMatch(shipmentId: string) {
    if (!shipmentPickModal) return
    try {
      const res = await fetch('/api/manual-match-shipment', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ cusdec_id: shipmentPickModal.cusdecId, shipment_id: shipmentId }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Match failed')
    } catch (e: any) {
      setError(e.message)
    } finally {
      setShipmentPickModal(null)
    }
  }

  async function freeCdnSlot(rowId: string) {
    if (!capModal) return
    setResolvingConflict(true)
    try {
      await fetch('/api/delete-row', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ table: 'cdn', id: rowId }),
      })
      setCapModal(prev => prev && ({
        ...prev,
        capInfo: { ...prev.capInfo, currentCount: prev.capInfo.currentCount - 1, rows: prev.capInfo.rows.filter((r: any) => r.id !== rowId) },
      }))
    } catch (e: any) {
      setError(e.message)
    } finally {
      setResolvingConflict(false)
    }
  }

  async function retryAfterFreeingSlot() {
    if (!capModal) return
    const { item } = capModal
    setCapModal(null)
    await persistItem(item, 'insert')
    settleBatchItem(item.id)
  }

  const selectedItem = items.find(it => it.id === selectedId) || null
  const showFullEditor = popupMode === 'full' && canAdminEdit

  useEffect(() => { setViewPage(0) }, [selectedId])

  useEffect(() => {
    if (!selectedItem || selectedItem.pageImages[viewPage] || !selectedItem.base64) return
    const id = selectedItem.id
    authHeader().then(h => fetch('/api/render-page', {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...h },
      body: JSON.stringify({ base64: selectedItem.base64, page: viewPage }),
    }))
      .then(r => r.json())
      .then(d => {
        if (d.png) updateItem(id, {
          pageImages: { ...(items.find(it => it.id === id)?.pageImages || {}), [viewPage]: d.png },
          numPages: d.numPages || 1,
        })
      })
      .catch(() => {})
  }, [selectedItem?.id, viewPage])

  function pctFromEvent(e: React.MouseEvent) {
    const el = imageAreaRef.current
    if (!el) return { x: 0, y: 0 }
    const rect = el.getBoundingClientRect()
    const x = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100))
    const y = Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100))
    return { x, y }
  }

  function handleContainerMouseDown(e: React.MouseEvent) {
    if (activeFieldIdx === null) return
    const p = pctFromEvent(e)
    const start = { x: p.x, y: p.y, w: 0, h: 0, page: viewPage }
    setDrag({ fieldIdx: activeFieldIdx, mode: 'draw', startMouse: p, startBox: start })
    setLiveBox(start)
  }

  function startMoveBox(e: React.MouseEvent, fieldIdx: number, box: PctBox) {
    e.stopPropagation()
    setDrag({ fieldIdx, mode: 'move', startMouse: pctFromEvent(e), startBox: box })
    setLiveBox(box)
  }

  function startResizeBox(e: React.MouseEvent, fieldIdx: number, box: PctBox) {
    e.stopPropagation()
    setDrag({ fieldIdx, mode: 'resize', startMouse: pctFromEvent(e), startBox: box })
    setLiveBox(box)
  }

  function handleContainerMouseMove(e: React.MouseEvent) {
    if (!drag) return
    const p = pctFromEvent(e)
    if (drag.mode === 'draw') {
      setLiveBox({
        x: Math.min(drag.startMouse.x, p.x), y: Math.min(drag.startMouse.y, p.y),
        w: Math.abs(p.x - drag.startMouse.x), h: Math.abs(p.y - drag.startMouse.y),
        page: drag.startBox.page,
      })
    } else if (drag.mode === 'move') {
      const dx = p.x - drag.startMouse.x, dy = p.y - drag.startMouse.y
      setLiveBox({
        x: Math.max(0, Math.min(100 - drag.startBox.w, drag.startBox.x + dx)),
        y: Math.max(0, Math.min(100 - drag.startBox.h, drag.startBox.y + dy)),
        w: drag.startBox.w, h: drag.startBox.h, page: drag.startBox.page,
      })
    } else if (drag.mode === 'resize') {
      const dx = p.x - drag.startMouse.x, dy = p.y - drag.startMouse.y
      setLiveBox({
        x: drag.startBox.x, y: drag.startBox.y,
        w: Math.max(1, Math.min(100 - drag.startBox.x, drag.startBox.w + dx)),
        h: Math.max(1, Math.min(100 - drag.startBox.y, drag.startBox.h + dy)),
        page: drag.startBox.page,
      })
    }
  }

  async function handleContainerMouseUp() {
    if (!drag || !liveBox || !selectedItem || liveBox.w < 1 || liveBox.h < 1) {
      setDrag(null); setLiveBox(null)
      return
    }
    const idx = drag.fieldIdx
    const box = liveBox
    const item = selectedItem
    setDrag(null)
    setLiveBox(null)
    setActiveFieldIdx(null)
    setExtractingBox(true)
    try {
      const res = await fetch('/api/extract-box', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ base64: item.base64, box }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Extract failed')
      setFieldFromOcr(item.id, idx, d.text)
      const fieldKey = item.fields[idx].key
      updateItem(item.id, { boxes: { ...item.boxes, [fieldKey]: box } })
    } catch (e: any) {
      setError(e.message)
    } finally {
      setExtractingBox(false)
    }
  }

  function slugify(label: string): string {
    return label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'field'
  }

  async function addCustomField() {
    if (!selectedItem) return
    const label = window.prompt('Aluth field eke nama danna (eg. Marks & Numbers) — meka thamai database column name eka:')
    if (!label || !label.trim()) return
    let key = slugify(label)
    const existingKeys = new Set(selectedItem.fields.map(f => f.key))
    let n = 2
    while (existingKeys.has(key)) { key = `${slugify(label)}_${n++}` }
    const docType = selectedItem.detectedType
    if (!docType) { alert('Document type select karanna kalin'); return }
    if (!confirm(`"${label.trim()}" field eka add kalama, "${docType}" table ekata aluth column ekak ("${key}") ekamama add wenawa. Continue karanna da?`)) return

    updateItem(selectedItem.id, { fields: [...selectedItem.fields, { key, label: label.trim(), value: '' }] })
    setActiveFieldIdx(selectedItem.fields.length)
    requestAnimationFrame(() => {
      fieldsScrollRef.current?.scrollTo({ top: fieldsScrollRef.current.scrollHeight, behavior: 'smooth' })
    })

    try {
      const res = await fetch('/api/ensure-column', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ doc_type: docType, key }),
      })
      const d = await res.json()
      if (!res.ok) setError(d.error || 'Column create failed')
    } catch (e: any) {
      setError(e.message)
    }
  }

  function renameField(id: string, idx: number, newLabel: string) {
    if (!newLabel.trim()) return
    setItems(prev => prev.map(it => {
      if (it.id !== id) return it
      const oldField = it.fields[idx]
      if (oldField.locked) return it
      const newKey = slugify(newLabel)
      const fields = it.fields.map((f, i) => i === idx ? { ...f, label: newLabel.trim(), key: newKey } : f)
      const boxes = { ...it.boxes }
      if (oldField.key !== newKey && boxes[oldField.key]) {
        boxes[newKey] = boxes[oldField.key]
        delete boxes[oldField.key]
      }
      return { ...it, fields, boxes }
    }))
  }

  function toggleLock(id: string, idx: number) {
    setItems(prev => prev.map(it => it.id === id
      ? { ...it, fields: it.fields.map((f, i) => i === idx ? { ...f, locked: !f.locked } : f) }
      : it))
  }

  async function deleteField(id: string, idx: number) {
    const item = items.find(it => it.id === id)
    if (!item) return
    const field = item.fields[idx]
    if (field.locked) { alert('Meka field eka locked wela thiyenawa — mudalin unlock karanna.'); return }
    const docType = item.detectedType
    const warning = docType
      ? `"${field.label}" field eka delete kalama, "${docType}" table eke "${field.key}" column ekath (thibba nam) delete wenawa — meka undo karanna bæ. Continue karanna da?`
      : `"${field.label}" field eka delete karanna da?`
    if (!confirm(warning)) return

    setItems(prev => prev.map(it => {
      if (it.id !== id) return it
      const removedKey = it.fields[idx].key
      const boxes = { ...it.boxes }
      delete boxes[removedKey]
      return { ...it, fields: it.fields.filter((_, i) => i !== idx), boxes }
    }))
    if (activeFieldIdx === idx) setActiveFieldIdx(null)

    if (docType) {
      try {
        const res = await fetch('/api/delete-field', {
          method: 'POST', headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
          body: JSON.stringify({ doc_type: docType, key: field.key }),
        })
        const d = await res.json()
        if (!res.ok) setError(d.error || 'Column delete failed')
      } catch (e: any) {
        setError(e.message)
      }
    }
  }

  async function handleSaveFormat() {
    if (!selectedItem || !selectedItem.detectedType) { alert('Document type select karanna kalin'); return }
    const boxEntries = Object.entries(selectedItem.boxes)
    if (!boxEntries.length) { alert('Box ekakwath draw karala nane — field ekak select karala PDF eke box ekak drag karanna'); return }
    setSavingFormat(true)
    try {
      const boxedFields = selectedItem.fields.filter(f => selectedItem.boxes[f.key])
      const labels = Object.fromEntries(boxedFields.map(f => [f.key, f.label]))
      const excludeWords = Object.fromEntries(boxedFields.filter(f => f.excludeWords?.trim()).map(f => [f.key, f.excludeWords]))
      const formulas = Object.fromEntries(boxedFields.filter(f => f.formula?.trim()).map(f => [f.key, f.formula]))
      const res = await fetch('/api/save-field-boxes', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ doc_type: selectedItem.detectedType, boxes: selectedItem.boxes, labels, excludeWords, formulas, variant: selectedItem.variant }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Save failed')
      alert(`Format saved for "${selectedItem.detectedType}" (${selectedItem.variant === 'scanned' ? 'Scanned/OCR' : 'Native Text'}) — future uploads of this variant will auto-use these boxes.`)
    } catch (e: any) {
      setError(e.message)
      alert('Error: ' + e.message)
    } finally {
      setSavingFormat(false)
    }
  }

  async function copyBoxesFromOtherVariant() {
    if (!selectedItem || !selectedItem.detectedType) { alert('Document type select karanna kalin'); return }
    const otherVariant = selectedItem.variant === 'scanned' ? 'native' : 'scanned'
    setCopyingBoxes(true)
    try {
      const res = await fetch('/api/copy-field-boxes', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ doc_type: selectedItem.detectedType, fromVariant: otherVariant, toVariant: selectedItem.variant }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Copy failed')

      const boxes: Record<string, PctBox> = d.boxes || {}
      const labels: Record<string, string> = d.labels || {}
      const excludeWords: Record<string, string> = d.excludeWords || {}
      const formulas: Record<string, string> = d.formulas || {}

      setItems(prev => prev.map(it => {
        if (it.id !== selectedItem.id) return it
        const existingByKey = new Map(it.fields.map(f => [f.key, f]))
        const fields = it.fields.map(f => boxes[f.key]
          ? { ...f, label: labels[f.key] || f.label, excludeWords: excludeWords[f.key] ?? f.excludeWords, formula: formulas[f.key] ?? f.formula }
          : f)
        for (const key of Object.keys(boxes)) {
          if (!existingByKey.has(key)) {
            fields.push({ key, label: labels[key] || key, value: '', excludeWords: excludeWords[key], formula: formulas[key] })
          }
        }
        return { ...it, boxes, fields }
      }))
      alert(`${otherVariant === 'scanned' ? 'Scanned/OCR' : 'Native Text'} variant eke boxes ${boxes && Object.keys(boxes).length} copy kalā — dhan positions adjust karanna PDF eke box tika drag karala.`)
    } catch (e: any) {
      setError(e.message)
      alert('Error: ' + e.message)
    } finally {
      setCopyingBoxes(false)
    }
  }

  const readyCount = items.filter(it => it.status === 'ready').length

  // Bulk actions — shown on both the normal "Uploaded" list and the "Admin
  // Edit" list, since they're two views onto the same uploaded items.
  const [savingAll, setSavingAll] = useState(false)
  async function handleSaveAll() {
    setSavingAll(true)
    const toSave = items.filter(it => it.status === 'ready' || it.status === 'error')
    for (const it of toSave) await saveOne(it)
    setSavingAll(false)
  }

  // "Send All" used to run every ready/error item through ONE shared
  // Save/Mail/Notify/Reason choice in a tight non-interactive loop — a
  // duplicate found mid-batch (check-document-match) popped matchModal but
  // the loop kept going regardless, so that file silently never actually
  // got resolved one way or the other. Batch send now steps through the
  // exact same single-file SendModal (+ its matchModal/capModal/
  // shipmentPickModal handling, unchanged) once per file — every file gets
  // its own real Skip/Save/Notify/Mail decision, resolved before the next
  // one opens. Order matters for CDN's CAP check (needs its CUSDEC to
  // already exist) and Barcode matching CDN's container_no, so the queue is
  // sorted cusdec -> cdn -> barcode -> everything else, not upload order.
  const BATCH_SAVE_ORDER: Record<string, number> = { cusdec: 0, cdn: 1, barcode: 2 }
  const [batchQueue, setBatchQueue] = useState<UploadItem[] | null>(null)
  function startBatchSend() {
    const toSend = items.filter(it => it.status === 'ready' || it.status === 'error')
    const sorted = [...toSend].sort((a, b) =>
      (BATCH_SAVE_ORDER[a.detectedType || ''] ?? 99) - (BATCH_SAVE_ORDER[b.detectedType || ''] ?? 99))
    if (sorted.length) setBatchQueue(sorted)
  }
  function advanceBatch() {
    setBatchQueue(prev => {
      if (!prev || prev.length <= 1) return null
      return prev.slice(1)
    })
  }
  function handleDeleteAll() {
    if (!items.length) return
    if (!confirm(`${items.length} file${items.length !== 1 ? 's' : ''} okkoma me list eken ain karannada? (Dhannma save unu dewal database eke thiyenawa — meken ain wenne me upload session eke list eka witharai.)`)) return
    setItems([])
    setSelectedId(null)
  }

  const canSeePreview = canUpload || canSeeUploaded || canPreview || isAdmin
  const panelOptions: Panel[] = (['upload', 'bills', 'preview', 'admin-edit'] as Panel[]).filter(p =>
    p === 'upload' ? (canUpload || canSeeUploaded) :
    p === 'bills' ? canBills :
    p === 'preview' ? canSeePreview : canAdminEdit
  )

  return (
    <>
      <div className="p-6 max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-gray-900">Documents</h1>
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-blue-100 text-blue-700">Upload</span>
          </div>
          {panelOptions.length > 1 && (
            <div className="flex bg-gray-100 rounded-lg p-0.5">
              {panelOptions.map(p => (
                <button key={p} onClick={() => setPanel(p)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors capitalize ${
                    panel === p ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                  }`}>{p === 'admin-edit' ? 'Admin Edit' : p === 'bills' ? 'Bills' : p}</button>
              ))}
            </div>
          )}
        </div>
        <p className="text-gray-500 text-sm mb-5">Upload a PDF, check its detected type, rename or remove it, then save.</p>

        {error && (
          <div className="mb-4 flex items-center justify-between bg-red-50 border border-red-100 rounded-lg px-3 py-2">
            <span className="text-xs text-red-600 flex items-center gap-1.5"><AlertTriangle size={13}/>{error}</span>
            <button onClick={() => setError('')}><X size={14} className="text-red-400"/></button>
          </div>
        )}

        {/* === UPLOAD panel: dropzone + normal-access list === */}
        {panel === 'upload' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {canUpload && (
          <div className={canSeeUploaded ? 'lg:col-span-2 card' : 'lg:col-span-3 card'}>
            <h2 className="font-semibold text-gray-900 text-sm mb-3">Upload PDFs</h2>
            <div
              onClick={() => fileRef.current?.click()}
              onDragOver={e => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={e => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files) }}
              className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors ${
                dragOver ? 'border-blue-400 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'
              }`}>
              <div className="flex flex-col items-center gap-3">
                <Upload size={28} className="text-gray-300"/>
                <div>
                  <p className="text-sm font-medium text-gray-600">Click or drag PDFs here</p>
                  <p className="text-xs text-gray-400 mt-0.5">Multiple files supported — type auto-detected per file</p>
                </div>
              </div>
            </div>
            <input ref={fileRef} type="file" accept=".pdf" multiple className="hidden"
              onChange={e => { handleFiles(e.target.files); e.target.value = '' }}/>
            {items.length > 0 && (
              <p className="text-xs text-gray-400 mt-3">{items.length} file{items.length !== 1 ? 's' : ''} · {readyCount} ready</p>
            )}
          </div>
          )}

          {canSeeUploaded && (
          <div className={canUpload ? 'card' : 'lg:col-span-3 card'}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-gray-900 text-sm">Uploaded ({items.length})</h2>
              {items.length > 0 && (
                <div className="flex items-center gap-1.5">
                  <button onClick={startBatchSend} disabled={!!batchQueue || readyCount === 0}
                    title="Step through each file — Skip/Save/Notify/Mail per file, cusdec first then cdn then barcode" className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium text-white bg-[#1B3A5C] disabled:opacity-40">
                    {batchQueue ? <Loader size={11} className="animate-spin"/> : <Send size={11}/>} Send All
                  </button>
                  <button onClick={handleDeleteAll}
                    title="Remove all from this list" className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium text-red-600 border border-red-200 hover:bg-red-50">
                    <Trash2 size={11}/> Delete All
                  </button>
                </div>
              )}
            </div>
            {items.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-14 text-center">
                <FileText size={30} className="text-gray-200 mb-2"/>
                <p className="text-xs text-gray-400">No files yet</p>
              </div>
            ) : (
              <div className="space-y-1.5 max-h-[520px] overflow-y-auto">
                {items.map(it => {
                  const def = it.detectedType ? docDef(it.detectedType) : null
                  const Icon = def?.icon || FileWarning
                  const color = def?.color || '#9ca3af'
                  const openable = it.status !== 'reading' && it.status !== 'extracting'
                  return (
                    <div key={it.id}
                      onClick={() => openable && (setPopupMode('simple'), setSelectedId(it.id))}
                      className={`flex items-center gap-2 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                        selectedId === it.id && popupMode === 'simple' ? 'border-2' : 'border-gray-100 hover:bg-gray-50'
                      }`}
                      style={selectedId === it.id && popupMode === 'simple' ? { borderColor: color, backgroundColor: `${color}10` } : {}}>
                      <div className="w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0" style={{ background: `${color}20` }}>
                        {it.status === 'reading' || it.status === 'extracting' || it.status === 'saving'
                          ? <Loader size={13} className="animate-spin" style={{ color }}/>
                          : it.status === 'error'
                            ? <AlertTriangle size={13} className="text-red-500"/>
                            : it.status === 'saved'
                              ? <CheckCircle size={13} className="text-green-500"/>
                              : <Icon size={13} style={{ color }}/>}
                      </div>
                      <div className="flex-1 min-w-0">
                        {renamingId === it.id ? (
                          <input autoFocus value={renameValue}
                            onClick={e => e.stopPropagation()}
                            onChange={e => setRenameValue(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') commitRename(it.id); if (e.key === 'Escape') setRenamingId(null) }}
                            onBlur={() => commitRename(it.id)}
                            className="w-full text-xs border border-gray-300 rounded px-1.5 py-0.5"/>
                        ) : (
                          <p className="text-xs font-medium text-gray-800 truncate">{it.fileName}</p>
                        )}
                        <p className={`text-xs mt-0.5 truncate ${it.status === 'error' ? 'text-red-500' : 'text-gray-400'}`}>
                          {statusLabel(it)}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {it.status === 'error' && (
                          <>
                            <button onClick={e => { e.stopPropagation(); retryExtraction(it) }} title="Retry (same file, no re-upload)" className="text-gray-300 hover:text-amber-600 p-1">
                              <RefreshCw size={12}/>
                            </button>
                            <button onClick={e => { e.stopPropagation(); skipItem(it.id) }} title="Skip this file — keep saving the rest" className="text-gray-300 hover:text-gray-600 p-1">
                              <X size={12}/>
                            </button>
                          </>
                        )}
                        {it.status === 'saved' && it.driveLink && (
                          <button onClick={e => { e.stopPropagation(); setEmailAttachments([{ filename: it.fileName, url: it.driveLink }]) }} title="Email this document" className="text-gray-300 hover:text-green-600 p-1">
                            <Mail size={12}/>
                          </button>
                        )}
                        <button onClick={e => startRename(it, e)} title="Rename" className="text-gray-300 hover:text-gray-600 p-1">
                          <Pencil size={12}/>
                        </button>
                        <button onClick={e => { e.stopPropagation(); openable && (setPopupMode('simple'), setSelectedId(it.id)) }} title="View" className="text-gray-300 hover:text-blue-600 p-1">
                          <Eye size={12}/>
                        </button>
                        <button onClick={e => { e.stopPropagation(); removeItem(it.id) }} title="Delete" className="text-gray-300 hover:text-red-500 p-1">
                          <Trash2 size={12}/>
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
          )}
        </div>
        )}

        {/* === BILLS panel === */}
        {panel === 'bills' && canBills && <BillsPanel/>}

        {/* === PREVIEW panel: saved documents from anyone, read-only === */}
        {panel === 'preview' && canSeePreview && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="card">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold text-gray-900">All Documents</h2>
                <div className="flex items-center gap-2">
                  <button onClick={() => { setShowMailHistory(x => !x); if (!showMailHistory) loadMailHistory() }}
                    className={`flex items-center gap-1 text-xs px-2 py-1.5 rounded-lg border ${showMailHistory ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}>
                    <History size={13}/> Mail History
                  </button>
                  <select value={filterType} onChange={e => setFilterType(e.target.value)}
                    className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white text-gray-600">
                    <option value="all">All types</option>
                    {DOC_TYPES.map(d => <option key={d.key} value={d.key}>{d.label}</option>)}
                  </select>
                  <button onClick={() => loadRecords()} className="text-gray-400 hover:text-gray-700">
                    <RefreshCw size={14}/>
                  </button>
                </div>
              </div>

              {showMailHistory ? (
                loadingMailHistory ? (
                  <div className="flex justify-center py-10"><Loader size={20} className="animate-spin text-gray-400"/></div>
                ) : mailHistory.length === 0 ? (
                  <div className="text-center py-10 text-gray-400 text-sm">You haven't sent any mail yet</div>
                ) : (
                  <div className="space-y-1.5 max-h-[500px] overflow-y-auto">
                    {mailHistory.map(h => (
                      <div key={h.id} className="border border-gray-100 rounded-xl p-3 text-xs">
                        <p className="font-medium text-gray-800">{h.subject}</p>
                        <p className="text-gray-500 mt-0.5">To: {h.to_addresses}{h.cc_addresses ? ` · Cc: ${h.cc_addresses}` : ''}{h.bcc_addresses ? ` · Bcc: ${h.bcc_addresses}` : ''}</p>
                        {h.attachment_names && <p className="text-gray-400 mt-0.5">Attached: {h.attachment_names}</p>}
                        <p className="text-gray-400 mt-0.5">{new Date(h.sent_at).toLocaleString('en-GB')}</p>
                      </div>
                    ))}
                  </div>
                )
              ) : loadingRecs ? (
                <div className="flex justify-center py-10"><Loader size={20} className="animate-spin text-gray-400"/></div>
              ) : records.length === 0 ? (
                <div className="text-center py-10 text-gray-400 text-sm">No documents found</div>
              ) : (
                <div className="space-y-1.5 max-h-[500px] overflow-y-auto">
                  {records.map(rec => {
                    const color = TYPE_COLORS[rec.doc_type] || '#6b7280'
                    const Def = docDef(rec.doc_type)
                    const Icon = Def?.icon || FileText
                    return (
                      <div key={rec.id} role="button" tabIndex={0} onClick={() => setSelectedRec(rec)}
                        onKeyDown={e => { if (e.key === 'Enter') setSelectedRec(rec) }}
                        className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-all text-left cursor-pointer ${
                          selectedRec?.id === rec.id ? 'border-2' : 'border-gray-100 hover:border-gray-200 hover:bg-gray-50'
                        }`}
                        style={selectedRec?.id === rec.id ? { borderColor: color, backgroundColor: `${color}10` } : {}}>
                        {rec.drive_url && (
                          <button onClick={e => { e.stopPropagation(); togglePreviewDoc(rec.id, { filename: rec.file_name, url: rec.drive_url }) }}
                            className="flex-shrink-0 text-gray-300 hover:text-green-600">
                            {selectedPreviewDocs[rec.id] ? <CheckSquare size={15} className="text-green-600"/> : <Square size={15}/>}
                          </button>
                        )}
                        <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: `${color}20` }}>
                          <Icon size={15} style={{ color }}/>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-800 truncate">{rec.file_name}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-xs px-1.5 py-0.5 rounded font-medium" style={{ background: `${color}20`, color }}>
                              {rec.doc_type.replace('_', ' ').toUpperCase()}
                            </span>
                            <span className="text-xs text-gray-400">{new Date(rec.created_at).toLocaleDateString('en-GB')}</span>
                          </div>
                        </div>
                        {rec.drive_url && <ExternalLink size={13} className="text-gray-300 flex-shrink-0"/>}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            <div className="card">
              {!selectedRec ? (
                <div className="flex flex-col items-center justify-center py-20 text-center">
                  <Eye size={36} className="text-gray-200 mb-3"/>
                  <p className="text-sm text-gray-400">Select a document to preview</p>
                </div>
              ) : (
                <>
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <h2 className="font-semibold text-gray-900 truncate max-w-[260px]">{selectedRec.file_name}</h2>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {selectedRec.doc_type.replace('_', ' ').toUpperCase()} · {new Date(selectedRec.created_at).toLocaleString('en-GB')}
                      </p>
                    </div>
                    {selectedRec.drive_url && (
                      <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                        <a href={selectedRec.drive_url} target="_blank" rel="noreferrer"
                          className="flex items-center gap-1.5 text-xs text-white px-3 py-1.5 rounded-lg"
                          style={{ background: TYPE_COLORS[selectedRec.doc_type] || '#1B3A5C' }}>
                          <ExternalLink size={12}/> Open in Drive
                        </a>
                        <button onClick={() => setEmailAttachments([{ filename: selectedRec.file_name, url: selectedRec.drive_url }])}
                          className="flex items-center gap-1.5 text-xs text-white px-3 py-1.5 rounded-lg" style={{ background: '#22A87A' }}>
                          <Mail size={12}/> Email
                        </button>
                      </div>
                    )}
                  </div>

                  {selectedRec.drive_url ? (
                    <div className="mb-4">
                      <div className="bg-gray-100 rounded-lg flex items-center justify-center min-h-[300px] overflow-auto">
                        {recLoadingImg && !recPageImages[selectedRec.id]?.[recPage] ? (
                          <Loader size={20} className="animate-spin text-gray-400"/>
                        ) : recPageImages[selectedRec.id]?.[recPage] ? (
                          <img src={`data:image/png;base64,${recPageImages[selectedRec.id][recPage]}`} className="max-w-full rounded" alt="Document page"/>
                        ) : (
                          <span className="text-xs text-gray-400">Could not render this page</span>
                        )}
                      </div>
                      {recNumPages > 1 && (
                        <div className="flex items-center justify-center gap-3 mt-2 text-xs">
                          <button onClick={() => setRecPage(p => Math.max(0, p - 1))} disabled={recPage === 0}
                            className="px-2 py-1 rounded border border-gray-200 disabled:opacity-30 hover:bg-gray-50">← Prev</button>
                          <span className="text-gray-500 font-medium">Page {recPage + 1} / {recNumPages}</span>
                          <button onClick={() => setRecPage(p => Math.min(recNumPages - 1, p + 1))} disabled={recPage >= recNumPages - 1}
                            className="px-2 py-1 rounded border border-gray-200 disabled:opacity-30 hover:bg-gray-50">Next →</button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="text-center py-6 text-gray-400 text-xs mb-2">No file link stored for this record</div>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {/* === ADMIN EDIT panel: same uploaded items, full box/template editor === */}
        {panel === 'admin-edit' && canAdminEdit && (
          <div className="card">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-gray-900 text-sm flex items-center gap-2">
                Admin Edit ({items.length})
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700">Full access</span>
              </h2>
              {items.length > 0 && (
                <div className="flex items-center gap-1.5">
                  <button onClick={startBatchSend} disabled={!!batchQueue || readyCount === 0}
                    title="Step through each file — Skip/Save/Notify/Mail per file, cusdec first then cdn then barcode" className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium text-white bg-[#1B3A5C] disabled:opacity-40">
                    {batchQueue ? <Loader size={11} className="animate-spin"/> : <Send size={11}/>} Send All
                  </button>
                  <button onClick={handleDeleteAll}
                    title="Remove all from this list" className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium text-red-600 border border-red-200 hover:bg-red-50">
                    <Trash2 size={11}/> Delete All
                  </button>
                </div>
              )}
            </div>
            {items.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-14 text-center">
                <ScanLine size={30} className="text-gray-200 mb-2"/>
                <p className="text-xs text-gray-400">No files yet — upload one from the Upload panel first</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {items.map(it => {
                  const def = it.detectedType ? docDef(it.detectedType) : null
                  const Icon = def?.icon || FileWarning
                  const color = def?.color || '#9ca3af'
                  const openable = it.status !== 'reading' && it.status !== 'extracting'
                  return (
                    <div key={it.id}
                      onClick={() => openable && (setPopupMode('full'), setSelectedId(it.id))}
                      className={`flex items-center gap-2 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                        selectedId === it.id && popupMode === 'full' ? 'border-2' : 'border-gray-100 hover:bg-gray-50'
                      }`}
                      style={selectedId === it.id && popupMode === 'full' ? { borderColor: color, backgroundColor: `${color}10` } : {}}>
                      <div className="w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0" style={{ background: `${color}20` }}>
                        {it.status === 'reading' || it.status === 'extracting' || it.status === 'saving'
                          ? <Loader size={13} className="animate-spin" style={{ color }}/>
                          : it.status === 'error'
                            ? <AlertTriangle size={13} className="text-red-500"/>
                            : it.status === 'saved'
                              ? <CheckCircle size={13} className="text-green-500"/>
                              : <Icon size={13} style={{ color }}/>}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-gray-800 truncate">{it.fileName}</p>
                        <p className={`text-xs mt-0.5 truncate ${it.status === 'error' ? 'text-red-500' : 'text-gray-400'}`}>
                          {statusLabel(it)} · {Object.keys(it.boxes).length} box{Object.keys(it.boxes).length === 1 ? '' : 'es'}
                        </p>
                      </div>
                      {it.status === 'error' && (
                        <>
                          <button onClick={e => { e.stopPropagation(); retryExtraction(it) }} title="Retry (same file, no re-upload)" className="text-gray-300 hover:text-amber-600 p-1 flex-shrink-0">
                            <RefreshCw size={13}/>
                          </button>
                          <button onClick={e => { e.stopPropagation(); skipItem(it.id) }} title="Skip this file — keep saving the rest" className="text-gray-300 hover:text-gray-600 p-1 flex-shrink-0">
                            <X size={13}/>
                          </button>
                        </>
                      )}
                      {it.status === 'saved' && it.driveLink && (
                        <button onClick={e => { e.stopPropagation(); setEmailAttachments([{ filename: it.fileName, url: it.driveLink }]) }} title="Email this document" className="text-gray-300 hover:text-green-600 p-1 flex-shrink-0">
                          <Mail size={13}/>
                        </button>
                      )}
                      <ScanLine size={13} className="text-gray-300 flex-shrink-0"/>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* === Popup — simple viewer or full box/template editor, depending on how it was opened === */}
      {selectedItem && (
        <div className={`fixed inset-0 bg-black/40 flex items-center justify-center z-50 ${showFullEditor ? 'p-6' : 'p-0 sm:p-4'}`}
          onClick={() => setSelectedId(null)}>
          <div className={`bg-white sm:rounded-2xl shadow-2xl w-full flex flex-col overflow-hidden ${
            showFullEditor ? 'max-w-6xl max-h-[90vh] rounded-2xl' : 'h-full sm:h-auto sm:max-w-lg sm:max-h-[85vh]'
          }`}
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <div className="min-w-0">
                <h3 className="font-semibold text-gray-900 truncate">{selectedItem.fileName}</h3>
                <p className="text-xs text-gray-400 mt-0.5">{statusLabel(selectedItem)}</p>
              </div>
              <button onClick={() => setSelectedId(null)} className="text-gray-400 hover:text-gray-600 flex-shrink-0">
                <X size={18}/>
              </button>
            </div>

            <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-2">
              <span className="text-xs text-gray-500">Type:</span>
              <select value={selectedItem.detectedType}
                onChange={e => updateItem(selectedItem.id, { detectedType: e.target.value as DocType })}
                className="text-xs font-medium border border-gray-200 rounded-md px-2 py-1 bg-white">
                <option value="">— select —</option>
                {DOC_TYPES.map(d => <option key={d.key} value={d.key}>{d.label}</option>)}
              </select>
              <span
                className={`text-[11px] font-semibold px-2 py-1 rounded-md ${selectedItem.variant === 'scanned' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                {selectedItem.variant === 'scanned' ? '📷 Scanned / OCR' : '📄 Native Text'}
              </span>
              {selectedItem.driveLink && (
                <a href={selectedItem.driveLink} target="_blank" rel="noreferrer"
                  className="ml-auto flex items-center gap-1 text-xs text-blue-600 hover:underline">
                  <ExternalLink size={12}/> View in Drive
                </a>
              )}
            </div>

            {showFullEditor ? (
              <>
                <div className="flex-1 overflow-hidden flex gap-4 px-5 py-3">
                  <div className="w-[380px] flex-shrink-0 flex flex-col">
                    {selectedItem.numPages > 1 && (
                      <div className="flex-shrink-0 flex items-center justify-center gap-3 mb-2 text-xs">
                        <button onClick={() => setViewPage(p => Math.max(0, p - 1))} disabled={viewPage === 0}
                          className="px-2 py-1 rounded border border-gray-200 disabled:opacity-30 hover:bg-gray-50">← Prev</button>
                        <span className="text-gray-500 font-medium">Page {viewPage + 1} / {selectedItem.numPages}</span>
                        <button onClick={() => setViewPage(p => Math.min(selectedItem.numPages - 1, p + 1))} disabled={viewPage >= selectedItem.numPages - 1}
                          className="px-2 py-1 rounded border border-gray-200 disabled:opacity-30 hover:bg-gray-50">Next →</button>
                      </div>
                    )}
                    <div className="flex-1 overflow-auto bg-gray-100 rounded-lg">
                      {!selectedItem.pageImages[viewPage] ? (
                        <div className="h-full flex items-center justify-center py-20">
                          <Loader size={20} className="animate-spin text-gray-400"/>
                        </div>
                      ) : (
                        <div
                          ref={imageAreaRef}
                          className="relative w-full select-none"
                          style={{ cursor: activeFieldIdx !== null && !drag ? 'crosshair' : 'default' }}
                          onMouseDown={handleContainerMouseDown}
                          onMouseMove={handleContainerMouseMove}
                          onMouseUp={handleContainerMouseUp}
                          onMouseLeave={() => { setDrag(null); setLiveBox(null) }}
                        >
                          <img src={`data:image/png;base64,${selectedItem.pageImages[viewPage]}`} className="w-full block" draggable={false}/>
                          {selectedItem.fields.map((f, i) => {
                            const isDragging = drag?.fieldIdx === i
                            const box = isDragging ? liveBox : selectedItem.boxes[f.key]
                            if (!box || (box.page || 0) !== viewPage) return null
                            const isNewDraw = isDragging && drag?.mode === 'draw'
                            return (
                              <div key={i}
                                onMouseDown={e => !isNewDraw && startMoveBox(e, i, box)}
                                className={`absolute border-2 ${isNewDraw ? 'border-red-500 bg-red-500/10' : 'border-green-500 bg-green-500/10 cursor-move'}`}
                                style={{ left: `${box.x}%`, top: `${box.y}%`, width: `${box.w}%`, height: `${box.h}%` }}>
                                <span className="absolute -top-4 left-0 text-[10px] font-bold text-green-700 bg-white/80 px-0.5 rounded pointer-events-none">{i + 1}</span>
                                {!isNewDraw && (
                                  <div onMouseDown={e => startResizeBox(e, i, box)}
                                    className="absolute -right-1 -bottom-1 w-3 h-3 bg-green-600 rounded-sm cursor-nwse-resize"/>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex-1 flex flex-col min-h-0">
                    <div className="mb-2 flex-shrink-0 flex justify-end">
                      <button onClick={addCustomField}
                        className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700 px-2 py-1 rounded-md hover:bg-blue-50">
                        <Plus size={13}/> Add Field
                      </button>
                    </div>
                    {activeFieldIdx !== null && (
                      <div className="mb-2 flex-shrink-0 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex items-center justify-between">
                        <span>Field #{activeFieldIdx + 1} ekata correct box eka <b>vamin thiyena PDF image eke</b> drag karala draw karanna</span>
                        <button onClick={() => setActiveFieldIdx(null)} className="text-red-400 hover:text-red-600 flex-shrink-0 ml-2"><X size={13}/></button>
                      </div>
                    )}
                    {extractingBox && (
                      <div className="mb-2 flex-shrink-0 text-xs text-blue-600 bg-blue-50 rounded-lg px-3 py-2 flex items-center gap-2">
                        <Loader size={12} className="animate-spin"/> Box eka OCR karanawa...
                      </div>
                    )}
                    <div ref={fieldsScrollRef} className="flex-1 overflow-auto">
                    {selectedItem.fields.length === 0 ? (
                      <div className="text-center py-10 text-gray-400 text-sm">
                        {selectedItem.scanned ? 'Scanned PDF — no fields extracted. Select type and save manually.' : 'No fields extracted for this document.'}
                      </div>
                    ) : (
                      <table className="w-full text-xs">
                        <thead className="sticky top-0 bg-white">
                          <tr className="bg-gray-50">
                            <th className="text-left px-2 py-2 text-gray-500 font-medium w-10">#</th>
                            <th className="text-left px-2 py-2 text-gray-500 font-medium w-36">Field</th>
                            <th className="text-left px-2 py-2 text-gray-500 font-medium">Value</th>
                            <th className="w-10 text-center px-1 py-2 text-gray-500 font-medium">Fix</th>
                            <th className="w-8"></th>
                            <th className="w-8"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedItem.fields.map((f, i) => (
                            <tr key={i} className={`border-t border-gray-50 hover:bg-gray-50 ${activeFieldIdx === i ? 'bg-red-50' : ''} ${f.locked ? 'bg-gray-50' : ''}`}>
                              <td className="px-2 py-1.5">
                                <span className="inline-flex items-center justify-center w-6 h-6 text-white text-xs font-bold rounded"
                                  style={{ background: selectedItem.boxes[f.key] ? '#16a34a' : (docDef(selectedItem.detectedType)?.color || '#6b7280') }}>{i + 1}</span>
                              </td>
                              <td className="px-2 py-1.5">
                                <input defaultValue={f.label} key={f.key} disabled={f.locked}
                                  onBlur={e => renameField(selectedItem.id, i, e.target.value)}
                                  onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                                  title="Column name — rename to match the target table's column"
                                  className="w-full bg-transparent text-gray-600 font-medium border-b border-transparent hover:border-gray-200 focus:border-current focus:outline-none py-0.5 disabled:text-gray-400"/>
                              </td>
                              <td className="px-2 py-1.5">
                                <textarea value={f.value} disabled={f.locked} onChange={e => updateItemField(selectedItem.id, i, e.target.value)}
                                  placeholder="—" rows={f.value.includes('\n') ? Math.min(4, f.value.split('\n').length) : 1}
                                  className={`w-full bg-transparent border-b focus:outline-none py-0.5 text-gray-800 disabled:text-gray-400 resize-none leading-tight ${
                                    (isBadContainerNo(selectedItem.detectedType, f) || isBadCusdecNumber(selectedItem.detectedType, f)) ? 'border-red-400 bg-red-50 focus:border-red-500' : 'border-transparent hover:border-gray-200 focus:border-current'
                                  }`}/>
                                {isBadContainerNo(selectedItem.detectedType, f) && (
                                  <p className="text-[10px] text-red-600 mt-0.5">Container No. format eka waradi — 4 akuru (A-Z) + 7 ilakkam wenna one (space nathuwa), e.g. MSCU1234567. Hariyata edit karanna.</p>
                                )}
                                {isBadCusdecNumber(selectedItem.detectedType, f) && (
                                  <p className="text-[10px] text-red-600 mt-0.5">CUSDEC No. format eka waradi — English akuru ha ilakkam dekai wenna one, e.g. E 38812. Hariyata edit karanna.</p>
                                )}
                                <input value={f.excludeWords || ''} disabled={f.locked}
                                  onChange={e => updateFieldRuleText(selectedItem.id, i, { excludeWords: e.target.value })}
                                  onBlur={() => commitFieldRules(selectedItem.id, i)}
                                  onKeyDown={e => { if (e.key === 'Enter') commitFieldRules(selectedItem.id, i) }}
                                  title="Words to remove from the value — reversible, doesn't touch the original OCR text"
                                  placeholder="exclude words (comma separated)..."
                                  className="w-full bg-transparent text-[10px] text-gray-400 focus:outline-none focus:text-gray-600 mt-0.5"/>
                                <input value={f.formula || ''} disabled={f.locked}
                                  onChange={e => updateFieldRuleText(selectedItem.id, i, { formula: e.target.value })}
                                  onBlur={() => commitFieldRules(selectedItem.id, i)}
                                  onKeyDown={e => { if (e.key === 'Enter') commitFieldRules(selectedItem.id, i) }}
                                  title="Excel-like code to slice this field's value out of the box text. Steps chain with | — LINE(n), LEFT(n), RIGHT(n), MID(start,len), AFTER(text), BEFORE(text), TRIM(). e.g. LINE(2)|AFTER(:)"
                                  placeholder="code: e.g. LINE(2)|AFTER(:)..."
                                  className="w-full bg-transparent text-[10px] text-gray-400 focus:outline-none focus:text-gray-600 mt-0.5 font-mono"/>
                                <input value={f.specNote || ''} disabled={f.locked}
                                  onChange={e => updateFieldRuleText(selectedItem.id, i, { specNote: e.target.value })}
                                  onBlur={() => commitFieldRules(selectedItem.id, i)}
                                  onKeyDown={e => { if (e.key === 'Enter') commitFieldRules(selectedItem.id, i) }}
                                  title="What this box's data is supposed to look like — a note for whoever draws/redraws this box next, not an enforced check"
                                  placeholder="spec: e.g. numbers only, DD/MM/YYYY..."
                                  className="w-full bg-transparent text-[10px] text-blue-400 focus:outline-none focus:text-blue-600 mt-0.5"/>
                                {selectedItem.fields.some((of, oi) => oi !== i && selectedItem.boxes[of.key]) && (
                                  <select value="" disabled={f.locked}
                                    onChange={e => { const si = Number(e.target.value); if (!Number.isNaN(si)) useSharedBox(selectedItem.id, i, si) }}
                                    title="Copy another field's box so this field can slice its own value from that same crop"
                                    className="w-full bg-transparent text-[10px] text-blue-400 focus:outline-none focus:text-blue-600 mt-0.5">
                                    <option value="">use same box as...</option>
                                    {selectedItem.fields.map((of, oi) => oi !== i && selectedItem.boxes[of.key] && (
                                      <option key={oi} value={oi}>#{oi + 1} {of.label}</option>
                                    ))}
                                  </select>
                                )}
                              </td>
                              <td className="px-1 py-1.5">
                                <button onClick={() => !f.locked && setActiveFieldIdx(activeFieldIdx === i ? null : i)}
                                  disabled={f.locked}
                                  title={f.locked ? 'Unlock first to draw a box' : 'Draw correction box on the PDF image'}
                                  className={`w-7 h-7 rounded-md border flex items-center justify-center flex-shrink-0 disabled:opacity-40 ${
                                    activeFieldIdx === i
                                      ? 'bg-red-500 border-red-500 text-white'
                                      : 'border-gray-200 text-gray-500 hover:text-red-500 hover:border-red-300 hover:bg-red-50'
                                  }`}>
                                  <ScanLine size={14}/>
                                </button>
                              </td>
                              <td className="px-1 py-1.5">
                                <button onClick={() => toggleLock(selectedItem.id, i)}
                                  title={f.locked ? 'Unlock this field' : 'Lock this field (prevents edit/delete/redraw)'}
                                  className={`w-7 h-7 rounded-md border flex items-center justify-center flex-shrink-0 ${
                                    f.locked ? 'bg-amber-100 border-amber-300 text-amber-600' : 'border-gray-200 text-gray-300 hover:text-amber-500 hover:border-amber-300 hover:bg-amber-50'
                                  }`}>
                                  {f.locked ? <Lock size={13}/> : <Unlock size={13}/>}
                                </button>
                              </td>
                              <td className="px-1 py-1.5">
                                <button onClick={() => deleteField(selectedItem.id, i)}
                                  disabled={f.locked}
                                  title={f.locked ? 'Unlock first to delete' : 'Delete this field'}
                                  className="w-7 h-7 rounded-md border border-gray-200 text-gray-300 hover:text-red-500 hover:border-red-300 hover:bg-red-50 flex items-center justify-center flex-shrink-0 disabled:opacity-40">
                                  <Trash2 size={13}/>
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between px-5 py-4 border-t border-gray-100">
                  <button onClick={() => { removeItem(selectedItem.id) }}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-red-600 border border-red-200 hover:bg-red-50">
                    <Trash2 size={13}/> Remove
                  </button>
                  <div className="flex items-center gap-2">
                    <button onClick={copyBoxesFromOtherVariant} disabled={copyingBoxes || !selectedItem.detectedType}
                      title={`Copy the ${selectedItem.variant === 'scanned' ? 'Native Text' : 'Scanned/OCR'} variant's saved boxes here, then drag them into place`}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-blue-700 border border-blue-200 hover:bg-blue-50 disabled:opacity-50">
                      {copyingBoxes ? <Loader size={13} className="animate-spin"/> : <Copy size={13}/>}
                      Copy from {selectedItem.variant === 'scanned' ? 'Native' : 'Scanned'}
                    </button>
                    <button onClick={handleSaveFormat} disabled={savingFormat}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-green-700 border border-green-200 hover:bg-green-50 disabled:opacity-50">
                      {savingFormat ? <Loader size={13} className="animate-spin"/> : <ScanLine size={13}/>}
                      Save Format
                    </button>
                    <button onClick={() => setSelectedId(null)}
                      className="px-3 py-2 rounded-lg text-xs font-medium text-gray-500 hover:bg-gray-100">
                      Close
                    </button>
                    <button onClick={() => setSendModalItem(selectedItem)} disabled={selectedItem.status === 'saving'}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs text-white font-medium disabled:opacity-50"
                      style={{ background: docDef(selectedItem.detectedType)?.color || '#1B3A5C' }}>
                      {selectedItem.status === 'saving' ? <Loader size={13} className="animate-spin"/> : <Send size={13}/>}
                      {selectedItem.status === 'saved' ? 'Re-send' : 'Send'}
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="flex-1 overflow-auto bg-gray-100 sm:p-3 flex items-center justify-center min-h-0">
                  {selectedItem.pageImages[viewPage] ? (
                    <img src={`data:image/png;base64,${selectedItem.pageImages[viewPage]}`} className="w-full h-full sm:w-auto sm:h-auto object-contain sm:rounded sm:shadow" alt="PDF page"/>
                  ) : (
                    <Loader size={20} className="animate-spin text-gray-400"/>
                  )}
                </div>
                {selectedItem.numPages > 1 && (
                  <div className="flex items-center justify-center gap-3 py-2 text-xs border-t border-gray-100">
                    <button onClick={() => setViewPage(p => Math.max(0, p - 1))} disabled={viewPage === 0}
                      className="px-2 py-1 rounded border border-gray-200 disabled:opacity-30 hover:bg-gray-50">← Prev</button>
                    <span className="text-gray-500 font-medium">Page {viewPage + 1} / {selectedItem.numPages}</span>
                    <button onClick={() => setViewPage(p => Math.min(selectedItem.numPages - 1, p + 1))} disabled={viewPage >= selectedItem.numPages - 1}
                      className="px-2 py-1 rounded border border-gray-200 disabled:opacity-30 hover:bg-gray-50">Next →</button>
                  </div>
                )}

                {/* Inline format-error editing — visible to ALL users */}
                {(() => {
                  const badFields = selectedItem.fields
                    .map((f, i) => ({ f, i }))
                    .filter(({ f }) => isBadContainerNo(selectedItem.detectedType, f) || isBadCusdecNumber(selectedItem.detectedType, f))
                  if (badFields.length === 0) return null
                  return (
                    <div className="px-5 py-3 border-t border-red-100 bg-red-50">
                      <p className="text-xs font-semibold text-red-700 mb-2">⚠ Format error — send karannen kala fix karanna:</p>
                      {badFields.map(({ f, i }) => (
                        <div key={i} className="mb-2 last:mb-0">
                          <label className="block text-[11px] font-medium text-red-700 mb-0.5">{f.label}</label>
                          <textarea
                            value={f.value}
                            onChange={e => updateItemField(selectedItem.id, i, e.target.value)}
                            rows={1}
                            className="w-full text-xs border border-red-400 bg-white rounded-md px-2 py-1.5 text-gray-800 focus:outline-none focus:ring-1 focus:ring-red-400 resize-none"
                          />
                          {isBadContainerNo(selectedItem.detectedType, f) && (
                            <p className="text-[10px] text-red-600 mt-0.5">4 akuru (A-Z) + 7 ilakkam wenna one (space nathuwa), e.g. MSCU1234567</p>
                          )}
                          {isBadCusdecNumber(selectedItem.detectedType, f) && (
                            <p className="text-[10px] text-red-600 mt-0.5">English akuru ha ilakkam dekai wenna one, e.g. E 38812</p>
                          )}
                        </div>
                      ))}
                    </div>
                  )
                })()}

                <div className="flex items-center justify-between px-5 py-4 border-t border-gray-100">
                  <button onClick={() => removeItem(selectedItem.id)}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-red-600 border border-red-200 hover:bg-red-50">
                    <Trash2 size={13}/> Remove
                  </button>
                  <div className="flex items-center gap-2">
                    <button onClick={() => setSelectedId(null)}
                      className="px-3 py-2 rounded-lg text-xs font-medium text-gray-500 hover:bg-gray-100">
                      Close
                    </button>
                    <button onClick={() => setSendModalItem(selectedItem)} disabled={selectedItem.status === 'saving'}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-white disabled:opacity-50" style={{ background: '#1B3A5C' }}>
                      {selectedItem.status === 'saving' ? <Loader size={13} className="animate-spin"/> : <Send size={13}/>}
                      Send
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Duplicate match(es) found — same document (by code+number+date for
          CUSDEC, container_no for CDN/Barcode) already saved. Every match
          shows here, editable in place, deletable-and-replaceable one at a
          time, or the new one can be added alongside them anyway. */}
      {matchModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[80] p-4">
          <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col">
            <div className="p-5 border-b border-gray-100">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2"><AlertTriangle size={16} className="text-amber-500"/>
                {matchModal.matches.length} matching row{matchModal.matches.length === 1 ? '' : 's'} already saved
              </h3>
              <p className="text-xs text-gray-500 mt-1">This upload: <span className="font-medium text-gray-700">{matchModal.item.fileName}</span> — looks the same as what's below.</p>
              <p className="text-xs text-gray-400 mt-1">To change the existing data, edit it directly from the Database tab. Here you can only replace (delete old + save new PDF) or skip.</p>
            </div>
            <div className="p-5 overflow-y-auto flex-1 space-y-4">
              {matchModal.matches.map((match: any) => (
                <div key={match.id} className="border border-gray-100 rounded-lg p-3">
                  <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs mb-3">
                    {Object.entries(match).filter(([k]) => !['id', 'created_at', 'uploaded_at', 'pdf_url', 'drive_url', 'uploaded_by'].includes(k)).map(([k, v]) => (
                      <div key={k}>
                        <span className="text-gray-400 block mb-0.5">{k}</span>
                        <span className="text-gray-700 font-medium">{v == null || v === '' ? '—' : String(v)}</span>
                      </div>
                    ))}
                  </div>
                  <button onClick={() => resolveMatchReplace(match.id)} disabled={resolvingConflict}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium text-red-600 border border-red-200 hover:bg-red-50 disabled:opacity-50">
                    <Trash2 size={11}/> Delete this + save new PDF here
                  </button>
                </div>
              ))}
            </div>
            <div className="p-5 border-t border-gray-100 flex flex-col gap-2">
              <button onClick={resolveMatchAddNew}
                className="w-full py-2.5 rounded-lg text-sm font-medium text-white" style={{ background: '#22A87A' }}>
                Keep all existing, add this as a new row
              </button>
              <button onClick={() => { skipItem(matchModal.item.id); settleBatchItem(matchModal.item.id); setMatchModal(null) }}
                className="w-full py-2 rounded-lg text-sm font-medium text-gray-500 hover:bg-gray-100">
                Skip — don't save this PDF
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CDN CAP exceeded — the CUSDEC's CAP (column 17) says how many CDN
          rows it should have; adding one more would go over. Blocked until a
          slot is freed or the CUSDEC's CAP is corrected. */}
      {capModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[80] p-4">
          <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col">
            <div className="p-5 border-b border-gray-100">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2"><AlertTriangle size={16} className="text-red-500"/>CDN count exceeds this CUSDEC's CAP</h3>
              <p className="text-xs text-gray-500 mt-1">
                CAP = {capModal.capInfo.cap}, but {capModal.capInfo.currentCount} CDN row{capModal.capInfo.currentCount === 1 ? '' : 's'} already exist for this CUSDEC.
                Delete one below to free a slot, or fix the CUSDEC's CAP value and try again.
              </p>
            </div>
            <div className="p-5 overflow-y-auto flex-1 space-y-2">
              {capModal.capInfo.rows.map((row: any) => (
                <div key={row.id} className="flex items-center justify-between gap-3 border border-gray-100 rounded-lg p-3 text-xs">
                  <div className="space-y-0.5 min-w-0">
                    <p className="font-medium text-gray-800">Container: {row.container_no || '—'}</p>
                    <p className="text-gray-400">Seal: {row.seal_no || '—'} · Uploaded: {row.uploaded_at ? new Date(row.uploaded_at).toLocaleString('en-GB') : '—'}</p>
                  </div>
                  <button onClick={() => freeCdnSlot(row.id)} disabled={resolvingConflict}
                    className="flex-shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium text-red-600 border border-red-200 hover:bg-red-50 disabled:opacity-50">
                    <Trash2 size={12}/> Delete
                  </button>
                </div>
              ))}
              {capModal.capInfo.rows.length === 0 && (
                <p className="text-xs text-gray-400 text-center py-6">No existing CDN rows left — you can retry the save now.</p>
              )}
            </div>
            <div className="p-5 border-t border-gray-100 flex items-center gap-2">
              <button onClick={() => setCapModal(null)} className="flex-1 py-2 rounded-lg text-sm font-medium text-gray-500 hover:bg-gray-100">
                Cancel
              </button>
              <button onClick={retryAfterFreeingSlot} disabled={capModal.capInfo.currentCount >= capModal.capInfo.cap}
                className="flex-1 py-2.5 rounded-lg text-sm font-medium text-white disabled:opacity-40" style={{ background: '#1B3A5C' }}>
                Retry Save
              </button>
            </div>
          </div>
        </div>
      )}

      {shipmentPickModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[80] p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg max-h-[80vh] flex flex-col">
            <div className="p-5 border-b border-gray-100">
              <h3 className="font-semibold text-gray-900">No matching Shipment found automatically</h3>
              <p className="text-xs text-gray-500 mt-1">This CUSDEC's Invoice Number didn't match any open Shipment entry. Pick one below to merge manually, or skip.</p>
            </div>
            <div className="p-5 overflow-y-auto flex-1 space-y-2">
              {shipmentPickModal.shipments.map((s: any) => (
                <button key={s.id} onClick={() => resolveManualMatch(s.id)}
                  className="w-full text-left border border-gray-100 rounded-lg p-3 text-xs hover:bg-gray-50">
                  <p className="font-medium text-gray-800">Invoice: {s.invoice_number} · Ref: {s.reference || '—'}</p>
                  <p className="text-gray-400">Shipper: {s.shipper} · Consignee: {s.consignee || '—'}</p>
                </button>
              ))}
            </div>
            <div className="p-5 border-t border-gray-100">
              <button onClick={() => setShipmentPickModal(null)} className="w-full py-2 rounded-lg text-sm font-medium text-gray-500 hover:bg-gray-100">
                Skip
              </button>
            </div>
          </div>
        </div>
      )}


      {panel === 'preview' && Object.keys(selectedPreviewDocs).length > 0 && (
        <div className="fixed bottom-6 right-6 z-40 flex items-center gap-2">
          <button onClick={() => setSelectedPreviewDocs({})} className="text-xs text-gray-500 bg-white border border-gray-200 rounded-full px-3 py-2 shadow-lg hover:bg-gray-50">
            Clear ({Object.keys(selectedPreviewDocs).length})
          </button>
          <button onClick={() => setEmailAttachments(Object.values(selectedPreviewDocs))}
            className="flex items-center gap-2 text-sm font-medium text-white rounded-full px-4 py-2.5 shadow-lg" style={{ background: '#22A87A' }}>
            <Mail size={15}/>Email Selected ({Object.keys(selectedPreviewDocs).length})
          </button>
        </div>
      )}

      {emailAttachments && <EmailPdfModal attachments={emailAttachments} onClose={() => setEmailAttachments(null)}/>}

      {sendModalItem && (
        <SendModal
          label={sendModalItem.fileName}
          uploaderName={uploaderName}
          docType={sendModalItem.detectedType}
          onSave={async (referenceOverride?: string) => {
            const r = await saveOne(sendModalItem, referenceOverride)
            return { ok: !!r?.ok, error: r?.error, results: r?.ok && r.driveLink ? [{ fileName: sendModalItem.fileName, driveLink: r.driveLink, docType: sendModalItem.detectedType, cusdecId: r.cusdecId }] : [] }
          }}
          onGetDriveLinks={async () => [{ fileName: sendModalItem.fileName, driveLink: await uploadToDriveOnly(sendModalItem), docType: sendModalItem.detectedType }]}
          onClose={() => setSendModalItem(null)}
          onDone={() => { setSendModalItem(null); setSelectedId(null) }}
        />
      )}

      {batchQueue && batchQueue.length > 0 && (
        <SendModal
          key={batchQueue[0].id}
          label={`${batchQueue[0].fileName} (${batchQueue.length} left in this batch)`}
          uploaderName={uploaderName}
          docType={batchQueue[0].detectedType}
          onSave={async (referenceOverride?: string) => {
            const r = await saveOne(batchQueue[0], referenceOverride)
            return { ok: !!r?.ok, error: r?.error, results: r?.ok && r.driveLink ? [{ fileName: batchQueue[0].fileName, driveLink: r.driveLink, docType: batchQueue[0].detectedType, cusdecId: r.cusdecId }] : [] }
          }}
          onGetDriveLinks={async () => [{ fileName: batchQueue[0].fileName, driveLink: await uploadToDriveOnly(batchQueue[0]), docType: batchQueue[0].detectedType }]}
          onClose={() => setBatchQueue(null)}
          onDone={advanceBatch}
        />
      )}
    </>
  )
}

// ── Bill Upload Panel ────────────────────────────────────────────────────────
const BILL_SUBTYPES = [
  { key: 'slpa_bill',          label: 'SLPA Bill' },
  { key: 'trico_bill',         label: 'Trico Bill' },
  { key: 'assessment_notice',  label: 'Assessment Notice' },
  { key: 'amendment_receipt',  label: 'Amendment Receipt' },
  { key: 'other',              label: 'Other' },
]

interface BillRecord {
  id: string
  file_name: string
  drive_url: string
  extracted_data: { bill_subtype?: string; cusdec_number?: string; reference?: string } | null
  uploaded_by_name: string
  created_at: string
}
interface CusdecMatch { id: string; code: string; number: string; exporter: string; reference?: string; cap?: string }

function BillsPanel() {
  const { isAdmin } = usePermission()
  const [cdnHistory, setCdnHistory] = useState<any[]>([])
  const [loadingCdnHistory, setLoadingCdnHistory] = useState(false)
  const [search, setSearch] = useState('')
  const [searching, setSearching] = useState(false)
  const [matches, setMatches] = useState<CusdecMatch[]>([])
  const [showDropdown, setShowDropdown] = useState(false)
  const [selected, setSelected] = useState<CusdecMatch | null>(null)
  const [bills, setBills] = useState<BillRecord[]>([])
  const [loadingBills, setLoadingBills] = useState(false)
  const [subtype, setSubtype] = useState('slpa_bill')
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [status, setStatus] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  async function doSearch(term: string) {
    setSearching(true)
    try {
      let q = supabase.from('cusdec').select('id, code, number, exporter, reference, cap')
      if (term.trim()) {
        q = q.or(`number.ilike.%${term.trim()}%,reference.ilike.%${term.trim()}%,exporter.ilike.%${term.trim()}%,code.ilike.%${term.trim()}%`)
      }
      const { data } = await q.order('created_at', { ascending: false }).limit(15)
      setMatches((data as CusdecMatch[]) || [])
    } catch { setMatches([]) }
    finally { setSearching(false) }
  }

  function handleSearchChange(val: string) {
    setSearch(val)
    if (selected) { setSelected(null); setBills([]) }
    setShowDropdown(true)
    if (searchTimeout.current) clearTimeout(searchTimeout.current)
    searchTimeout.current = setTimeout(() => doSearch(val), 250)
  }

  function handleSearchFocus() {
    setShowDropdown(true)
    if (matches.length === 0 && !selected) doSearch(search)
  }

  function handleSearchBlur() {
    // delay so click on dropdown item fires first
    setTimeout(() => setShowDropdown(false), 150)
  }

  async function selectCusdec(c: CusdecMatch) {
    setSelected(c)
    setMatches([])
    setShowDropdown(false)
    setSearch(`${c.number}${c.reference ? ' · ' + c.reference : ''}`)
    loadBills(c.number)
    if (isAdmin) loadCdnHistory(c.number)
  }

  // Admin-only visibility into who uploaded each CDN against this CUSDEC's
  // CAP — the Bills panel already has the CUSDEC search/select UI, so this
  // reuses it instead of duplicating a second picker elsewhere.
  async function loadCdnHistory(cusdecNumber: string) {
    setLoadingCdnHistory(true)
    try {
      const h = await authHeader()
      const r = await fetch(`/api/list-records?table=cdn&filter=cusdec_number&value=${encodeURIComponent(cusdecNumber)}`, { headers: h })
      const d = await r.json()
      setCdnHistory(d.records || [])
    } catch { setCdnHistory([]) }
    finally { setLoadingCdnHistory(false) }
  }

  async function loadBills(cusdecNumber: string) {
    setLoadingBills(true)
    try {
      const h = await authHeader()
      const r = await fetch(`/api/bill-uploads?cusdec_number=${encodeURIComponent(cusdecNumber)}`, { headers: h })
      const d = await r.json()
      setBills(d.bills || [])
    } catch { setBills([]) }
    finally { setLoadingBills(false) }
  }

  async function upload() {
    if (!file || !selected) return
    setUploading(true); setStatus('')
    try {
      const base64 = await new Promise<string>((res, rej) => {
        const reader = new FileReader()
        reader.onload = () => res((reader.result as string).split(',')[1])
        reader.onerror = rej
        reader.readAsDataURL(file)
      })
      const h = await authHeader()
      const r = await fetch('/api/bill-uploads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...h },
        body: JSON.stringify({
          base64,
          fileName: file.name,
          bill_subtype: subtype,
          cusdec_number: selected.number,
          cusdec_id: selected.id,
          cusdec_reference: selected.reference || null,
        }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error)
      setFile(null); if (fileRef.current) fileRef.current.value = ''
      setStatus('Uploaded!')
      loadBills(selected.number)
    } catch (e: any) { setStatus(`Error: ${e.message}`) }
    finally { setUploading(false) }
  }

  async function deleteBill(id: string) {
    if (!confirm('Delete this bill?')) return
    setDeletingId(id)
    try {
      const h = await authHeader()
      const r = await fetch(`/api/bill-uploads?id=${id}`, { method: 'DELETE', headers: h })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error)
      setBills(prev => prev.filter(b => b.id !== id))
    } catch (e: any) { setStatus(`Delete error: ${e.message}`) }
    finally { setDeletingId(null) }
  }

  function subtypeLabel(key?: string) {
    return BILL_SUBTYPES.find(s => s.key === key)?.label || key || 'Bill'
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      {/* Left: upload form */}
      <div className="card space-y-4">
        <h2 className="font-semibold text-gray-900 text-sm flex items-center gap-2">
          <Receipt size={15} className="text-red-500"/>Upload Bill
        </h2>

        {/* Bill type FIRST — user picks type before searching */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Bill Type</label>
          <select value={subtype} onChange={e => setSubtype(e.target.value)}
            className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-blue-400">
            {BILL_SUBTYPES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </div>

        {/* Shipment search — fuzzy by number, reference, exporter, code */}
        <div className="relative">
          <label className="block text-xs font-medium text-gray-600 mb-1">Shipment / CUSDEC Number</label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"/>
              <input
                value={search}
                onChange={e => handleSearchChange(e.target.value)}
                onFocus={handleSearchFocus}
                onBlur={handleSearchBlur}
                placeholder="Number, reference, exporter…"
                className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 pl-7 pr-14 focus:outline-none focus:border-blue-400"/>
              <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                {searching
                  ? <Loader size={11} className="animate-spin text-gray-400"/>
                  : <button
                      onMouseDown={e => { e.preventDefault(); handleSearchFocus() }}
                      className="text-gray-400 hover:text-blue-500 p-0.5"
                      tabIndex={-1}
                      title="Show all">
                      <ChevronDown size={13}/>
                    </button>
                }
              </div>
            </div>
          </div>

          {/* Live search results dropdown */}
          {showDropdown && !selected && matches.length > 0 && (
            <div className="absolute z-20 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden divide-y divide-gray-50 max-h-64 overflow-y-auto">
              {matches.map(c => (
                <button key={c.id} onMouseDown={() => selectCusdec(c)}
                  className="w-full text-left px-3 py-2 text-xs hover:bg-blue-50 transition-colors">
                  <p className="font-medium text-gray-800 flex items-center gap-2 flex-wrap">
                    {c.number} <span className="text-gray-400 font-normal">({c.code})</span>
                    {c.reference && <span className="text-[10px] font-semibold text-blue-700 bg-blue-50 border border-blue-100 px-1.5 py-0.5 rounded">{c.reference}</span>}
                  </p>
                  <p className="text-gray-400 truncate mt-0.5">{c.exporter}</p>
                </button>
              ))}
            </div>
          )}

          {selected && (
            <div className="mt-2 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2 flex items-center justify-between">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-blue-800 flex items-center gap-2 flex-wrap">
                  {selected.number}
                  {selected.reference && <span className="text-[10px] font-semibold text-blue-700 bg-blue-100 border border-blue-200 px-1.5 py-0.5 rounded">{selected.reference}</span>}
                </p>
                <p className="text-[11px] text-blue-600 truncate">{selected.exporter}</p>
              </div>
              <button onClick={() => { setSelected(null); setSearch(''); setBills([]) }}
                className="text-blue-300 hover:text-blue-600 ml-2 flex-shrink-0"><X size={13}/></button>
            </div>
          )}
        </div>

        {/* File */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">File</label>
          {file ? (
            <div className="flex items-center justify-between border border-gray-200 rounded-lg px-3 py-2">
              <span className="text-xs text-gray-700 truncate">{file.name}</span>
              <button onClick={() => { setFile(null); if (fileRef.current) fileRef.current.value = '' }}
                className="text-gray-300 hover:text-red-500"><X size={13}/></button>
            </div>
          ) : (
            <button onClick={() => fileRef.current?.click()}
              className="w-full border-2 border-dashed border-gray-200 rounded-lg py-6 text-center hover:border-blue-300 transition-colors">
              <Upload size={18} className="mx-auto mb-1 text-gray-300"/>
              <p className="text-xs text-gray-400">Click to select file</p>
            </button>
          )}
          <input ref={fileRef} type="file" accept="*/*" className="hidden"
            onChange={e => setFile(e.target.files?.[0] || null)}/>
        </div>

        {status && <p className={`text-xs ${status.startsWith('Error') ? 'text-red-600' : 'text-green-600'}`}>{status}</p>}

        <button onClick={upload} disabled={uploading || !file || !selected}
          className="w-full py-2.5 rounded-lg text-sm font-medium text-white disabled:opacity-40 flex items-center justify-center gap-2"
          style={{ background: '#22A87A' }}>
          {uploading ? <Loader size={14} className="animate-spin"/> : <Upload size={14}/>}
          Upload Bill
        </button>
      </div>

      {/* Right: uploaded bills for selected cusdec */}
      <div className="card">
        <h2 className="font-semibold text-gray-900 text-sm mb-3 flex items-center gap-2">
          <FileText size={15} className="text-gray-400"/>
          {selected ? `Bills — ${selected.number}` : 'Bills'}
        </h2>
        {!selected ? (
          <p className="text-xs text-gray-400 py-6 text-center">Search and select a shipment to see its bills</p>
        ) : loadingBills ? (
          <div className="flex items-center justify-center py-6"><Loader size={18} className="animate-spin text-gray-300"/></div>
        ) : bills.length === 0 ? (
          <p className="text-xs text-gray-400 py-6 text-center">No bills uploaded for this shipment yet</p>
        ) : (
          <div className="space-y-2">
            {bills.map(b => (
              <div key={b.id} className="flex items-center gap-3 border border-gray-100 rounded-lg px-3 py-2.5">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-gray-800 truncate">{b.file_name}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[10px] px-1.5 py-0.5 rounded-md font-medium text-white"
                      style={{ background: '#ef4444' }}>
                      {subtypeLabel(b.extracted_data?.bill_subtype)}
                    </span>
                    <span className="text-[10px] text-gray-400">
                      {b.uploaded_by_name} · {new Date(b.created_at).toLocaleDateString('en-GB')}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  {b.drive_url && (
                    <a href={b.drive_url} target="_blank" rel="noopener noreferrer"
                      className="p-1.5 text-gray-400 hover:text-blue-600">
                      <ExternalLink size={13}/>
                    </a>
                  )}
                  <button onClick={() => deleteBill(b.id)} disabled={deletingId === b.id}
                    className="p-1.5 text-gray-300 hover:text-red-500 disabled:opacity-40">
                    {deletingId === b.id ? <Loader size={13} className="animate-spin"/> : <Trash2 size={13}/>}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {isAdmin && selected && (
        <div className="card lg:col-span-2">
          <h2 className="font-semibold text-gray-900 text-sm mb-3 flex items-center gap-2">
            <FileText size={15} className="text-gray-400"/>
            CDN CAP History — {selected.number} {selected.cap ? `(CAP ${selected.cap}, ${cdnHistory.length} uploaded)` : `(${cdnHistory.length} uploaded)`}
          </h2>
          {loadingCdnHistory ? (
            <div className="flex items-center justify-center py-6"><Loader size={18} className="animate-spin text-gray-300"/></div>
          ) : cdnHistory.length === 0 ? (
            <p className="text-xs text-gray-400 py-4 text-center">No CDN rows uploaded for this CUSDEC yet</p>
          ) : (
            <div className="space-y-1.5 max-h-64 overflow-y-auto">
              {cdnHistory.map(cdn => (
                <div key={cdn.id} className="flex items-center justify-between text-xs border border-gray-100 rounded-lg px-3 py-2">
                  <span className="font-mono font-medium text-gray-800">{cdn.container_no || '—'}</span>
                  <span className="text-gray-400">{cdn.uploaded_by || ''} {cdn.created_at ? new Date(cdn.created_at).toLocaleString('en-GB') : ''}</span>
                  {cdn.boat_note_passed && <span className="text-blue-600">· boat note passed</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
