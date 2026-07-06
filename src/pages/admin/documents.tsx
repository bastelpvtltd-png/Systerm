import { useState, useRef, useEffect, useCallback } from 'react'
import AdminLayout, { usePermission } from '@/components/admin/AdminLayout'
import { applyTextRules } from '@/lib/textClean'
import {
  Upload, FileText, Package, ScanLine, Ship, Copy,
  CheckCircle, Loader, Save, Eye, ExternalLink,
  RefreshCw, AlertTriangle, X, Receipt,
  Trash2, Pencil, FileWarning, Plus, Lock, Unlock
} from 'lucide-react'

type DocType = 'cusdec' | 'cdn' | 'barcode' | 'boat_note' | 'party_copy' | 'bill'
type PdfField = {
  key: string; label: string; value: string
  rawValue?: string // last OCR/API text, before exclude-words/formula — lets edits to those rules be reversible
  excludeWords?: string
  formula?: string // Excel-like slicing code, e.g. "LINE(2)|AFTER(:)" — lets 2 fields share one box's raw text
  locked?: boolean // when true, this field can't be edited/re-drawn/deleted until unlocked
}
type Panel = 'upload' | 'preview'
type ItemStatus = 'reading' | 'extracting' | 'ready' | 'saving' | 'saved' | 'error'

interface PctBox { x: number; y: number; w: number; h: number; page?: number } // page is 0-indexed

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
  pageImages: Record<number, string> // page index -> base64 PNG, loaded lazily per page
  numPages: number
  boxes: Record<string, PctBox> // fieldKey -> user-drawn correction box
  variant: 'native' | 'scanned' // which template variant this PDF matched — layout differs between the two
}

interface ErrorLog { time: string; step: string; msg: string }
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

function docDef(key: string) {
  return DOC_TYPES.find(d => d.key === key)
}

function statusLabel(it: UploadItem) {
  switch (it.status) {
    case 'reading':    return 'Reading...'
    case 'extracting': return 'Detecting type...'
    case 'ready':       return it.scanned ? 'Scanned — select type' : 'Ready to save'
    case 'saving':      return 'Saving...'
    case 'saved':        return 'Saved'
    case 'error':        return it.error || 'Error'
  }
}

export default function DocumentsPage() {
  const { has } = usePermission()
  const canUpload = has('section:documents.upload')
  const canPreview = has('section:documents.preview')
  const [panel, setPanel] = useState<Panel>('upload')
  const [items, setItems] = useState<UploadItem[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [savingAll, setSavingAll] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [errors, setErrors] = useState<ErrorLog[]>([])
  const [showErrors, setShowErrors] = useState(false)
  // Correction-box drawing (in the extracted-fields popup)
  const [activeFieldIdx, setActiveFieldIdx] = useState<number | null>(null)
  const [viewPage, setViewPage] = useState(0)
  const [drag, setDrag] = useState<{ fieldIdx: number; mode: 'draw' | 'move' | 'resize'; startMouse: { x: number; y: number }; startBox: PctBox } | null>(null)
  const [liveBox, setLiveBox] = useState<PctBox | null>(null)
  const [extractingBox, setExtractingBox] = useState(false)
  const [savingFormat, setSavingFormat] = useState(false)
  const [copyingBoxes, setCopyingBoxes] = useState(false)
  const imageAreaRef = useRef<HTMLDivElement>(null)
  const fieldsScrollRef = useRef<HTMLDivElement>(null)
  // Preview state (saved documents, DB-backed)
  const [records, setRecords] = useState<DbRecord[]>([])
  const [loadingRecs, setLoadingRecs] = useState(false)
  const [selectedRec, setSelectedRec] = useState<DbRecord | null>(null)
  const [filterType, setFilterType] = useState<string>('all')
  const [recPage, setRecPage] = useState(0)
  const [recPageImages, setRecPageImages] = useState<Record<string, Record<number, string>>>({})
  const [recNumPages, setRecNumPages] = useState(1)
  const [recLoadingImg, setRecLoadingImg] = useState(false)

  const fileRef = useRef<HTMLInputElement>(null)

  function logError(step: string, msg: string) {
    setErrors(prev => [{ time: new Date().toLocaleTimeString(), step, msg }, ...prev.slice(0, 49)])
  }

  const loadRecords = useCallback(async () => {
    setLoadingRecs(true)
    try {
      const url = filterType === 'all'
        ? '/api/list-documents'
        : `/api/list-documents?doc_type=${filterType}`
      const res = await fetch(url)
      if (res.ok) { const d = await res.json(); setRecords(d.records || []) }
      else logError('list-documents', await res.text())
    } catch (e: any) {
      logError('list-documents', e.message)
    } finally { setLoadingRecs(false) }
  }, [filterType])

  useEffect(() => { if (panel === 'preview') loadRecords() }, [panel, loadRecords])

  // If the current panel isn't granted, drop back to whichever one is
  useEffect(() => {
    if (panel === 'upload' && !canUpload && canPreview) setPanel('preview')
    if (panel === 'preview' && !canPreview && canUpload) setPanel('upload')
  }, [panel, canUpload, canPreview])

  // Reset to page 1 whenever a different saved record is opened, and lazily
  // fetch+cache each page's image from Drive as the admin pages through it.
  useEffect(() => { setRecPage(0) }, [selectedRec?.id])
  useEffect(() => {
    if (!selectedRec || !selectedRec.drive_url) return
    if (recPageImages[selectedRec.id]?.[recPage]) return
    setRecLoadingImg(true)
    fetch('/api/render-drive-page', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ driveUrl: selectedRec.drive_url, page: recPage }),
    })
      .then(r => r.json())
      .then(d => {
        if (d.png) {
          setRecPageImages(prev => ({ ...prev, [selectedRec.id]: { ...(prev[selectedRec.id] || {}), [recPage]: d.png } }))
          setRecNumPages(d.numPages || 1)
        } else if (d.error) {
          logError('render-drive-page', d.error)
        }
      })
      .catch(e => logError('render-drive-page', e.message))
      .finally(() => setRecLoadingImg(false))
  }, [selectedRec?.id, selectedRec?.drive_url, recPage])

  function updateItem(id: string, patch: Partial<UploadItem>) {
    setItems(prev => prev.map(it => it.id === id ? { ...it, ...patch } : it))
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
      try {
        const base64 = await fileToBase64(item.file)
        updateItem(item.id, { base64, status: 'extracting' })
        const res = await fetch('/api/extract-pdf', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ base64 }),
        })
        const json = await res.json()
        if (!res.ok) throw new Error(json.error || 'Extraction failed')
        updateItem(item.id, {
          status: 'ready',
          detectedType: (json.detectedDocType as DocType) || '',
          fields: (json.fields || []).map((f: PdfField) => ({ ...f, rawValue: f.value })),
          rawText: json.rawText || '',
          scanned: !!json.scanned,
          boxes: json.boxes || {}, // auto-applied template boxes, if any — makes them editable right away
          variant: json.variant === 'scanned' ? 'scanned' : 'native',
        })
        if (json.scanned) logError(item.fileName, json.warning || 'Scanned PDF — please select the type manually')
      } catch (e: any) {
        updateItem(item.id, { status: 'error', error: e.message })
        logError(item.fileName, e.message)
      }
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

  // Manual edits become the new baseline (rawValue too), so later exclude-word/
  // replacement changes recompute from what the user actually typed.
  function updateItemField(id: string, idx: number, val: string) {
    setItems(prev => prev.map(it => it.id === id
      ? { ...it, fields: it.fields.map((f, i) => i === idx ? { ...f, value: val, rawValue: val } : f) }
      : it))
  }

  // Tracks exclude-words/formula text as the user types (no side effect yet).
  function updateFieldRuleText(id: string, idx: number, patch: Partial<Pick<PdfField, 'excludeWords' | 'formula'>>) {
    setItems(prev => prev.map(it => it.id === id
      ? { ...it, fields: it.fields.map((f, i) => i === idx ? { ...f, ...patch } : f) }
      : it))
  }

  // On blur/Enter, recompute value from rawValue — non-destructive, so
  // removing an exclude-word or changing the formula brings that text back
  // and re-slices it fresh.
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
    // Persist immediately — these rules shouldn't need a box or a "Save Format"
    // click to survive; they belong to the doc type permanently from the moment
    // they're typed.
    if (!docType || !updatedField) return
    try {
      const res = await fetch('/api/save-field-rules', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          doc_type: docType, key: updatedField.key, label: updatedField.label,
          excludeWords: updatedField.excludeWords, formula: updatedField.formula, variant,
        }),
      })
      const d = await res.json()
      if (!res.ok) logError('save-field-rules', d.error || 'Rule save failed')
    } catch (e: any) {
      logError('save-field-rules', e.message)
    }
  }

  // Applies any exclude-words/formula the field already has configured to
  // freshly-OCR'd text (a new draw, re-draw, or a box shared from another
  // field), while keeping the untouched raw text around so rule edits stay
  // reversible and so a sibling field sharing the box can re-slice it too.
  function setFieldFromOcr(id: string, idx: number, rawText: string) {
    setItems(prev => prev.map(it => it.id === id
      ? { ...it, fields: it.fields.map((f, i) => i === idx
          ? { ...f, rawValue: rawText, value: applyTextRules(rawText, f.formula, f.excludeWords) }
          : f) }
      : it))
  }

  // "Use the same box as field #N" — copies that field's box + raw OCR text
  // over, so this field can apply its own formula to the identical crop
  // instead of drawing a duplicate box (e.g. VOC/COC both living in one cell).
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

  async function saveOne(item: UploadItem): Promise<boolean> {
    const docType = item.detectedType || 'cusdec'
    updateItem(item.id, { status: 'saving' })
    try {
      let link = ''
      try {
        const dr = await fetch('/api/upload-to-drive', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ base64: item.base64, fileName: item.fileName, mimeType: 'application/pdf', docType }),
        })
        const dd = await dr.json()
        if (dr.ok && dd.driveLink) link = dd.driveLink
        else logError(item.fileName, dd.error || 'Drive upload failed')
      } catch (e: any) {
        logError(item.fileName, e.message)
      }

      const sr = await fetch('/api/save-document', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          doc_type: docType, file_name: item.fileName, file_url: '', drive_url: link,
          extracted_data: item.fields.length
            ? Object.fromEntries(item.fields.map(f => [`grid_${f.key}`, f.value]))
            : null,
        }),
      })
      const sd = await sr.json()
      if (!sr.ok) throw new Error(sd.error || 'Save failed')

      // Also mirror the extracted fields into the doc type's structured table
      // (cusdec/cdn/barcode/boat_notes) — best-effort, doesn't block the save.
      if (item.fields.length) {
        try {
          const data = Object.fromEntries(item.fields.map(f => [f.key, f.value]))
          const tr = await fetch('/api/save-to-table', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ doc_type: docType, data, drive_url: link }),
          })
          const td = await tr.json()
          if (!tr.ok) logError('save-to-table', td.error || 'Table save failed')
        } catch (e: any) {
          logError('save-to-table', e.message)
        }
      }

      updateItem(item.id, { status: 'saved', driveLink: link })
      return true
    } catch (e: any) {
      updateItem(item.id, { status: 'error', error: e.message })
      logError(item.fileName, e.message)
      return false
    }
  }

  async function handleSaveAll() {
    setSavingAll(true)
    const toSave = items.filter(it => it.status === 'ready' || it.status === 'error')
    for (const item of toSave) await saveOne(item)
    setSavingAll(false)
  }

  const selectedItem = items.find(it => it.id === selectedId) || null

  // Reset to page 1 whenever a different document's popup is opened
  useEffect(() => { setViewPage(0) }, [selectedId])

  // Lazy-load the currently-viewed page's image (cached per page once fetched)
  useEffect(() => {
    if (!selectedItem || selectedItem.pageImages[viewPage] || !selectedItem.base64) return
    const id = selectedItem.id
    fetch('/api/render-page', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ base64: selectedItem.base64, page: viewPage }),
    })
      .then(r => r.json())
      .then(d => {
        if (d.png) updateItem(id, {
          pageImages: { ...(items.find(it => it.id === id)?.pageImages || {}), [viewPage]: d.png },
          numPages: d.numPages || 1,
        })
      })
      .catch(e => logError('render-page', e.message))
  }, [selectedItem?.id, viewPage])

  function pctFromEvent(e: React.MouseEvent) {
    const el = imageAreaRef.current
    if (!el) return { x: 0, y: 0 }
    const rect = el.getBoundingClientRect()
    const x = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100))
    const y = Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100))
    return { x, y }
  }

  // Mousedown on the empty PDF area (not on an existing box) starts drawing a
  // brand-new box for the field currently selected via the "Fix" icon.
  function handleContainerMouseDown(e: React.MouseEvent) {
    if (activeFieldIdx === null) return
    const p = pctFromEvent(e)
    const start = { x: p.x, y: p.y, w: 0, h: 0, page: viewPage }
    setDrag({ fieldIdx: activeFieldIdx, mode: 'draw', startMouse: p, startBox: start })
    setLiveBox(start)
  }

  // Mousedown directly on an existing (green) box moves it instead of drawing a new one.
  function startMoveBox(e: React.MouseEvent, fieldIdx: number, box: PctBox) {
    e.stopPropagation()
    setDrag({ fieldIdx, mode: 'move', startMouse: pctFromEvent(e), startBox: box })
    setLiveBox(box)
  }

  // Mousedown on a box's corner handle resizes it instead of moving it.
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
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base64: item.base64, box }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Extract failed')
      setFieldFromOcr(item.id, idx, d.text)
      const fieldKey = item.fields[idx].key
      updateItem(item.id, { boxes: { ...item.boxes, [fieldKey]: box } })
    } catch (e: any) {
      logError('extract-box', e.message)
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
    while (existingKeys.has(key)) { key = `${slugify(label)}_${n++}` } // avoid clashing with an existing field
    const docType = selectedItem.detectedType
    if (!docType) { alert('Document type select karanna kalin'); return }
    if (!confirm(`"${label.trim()}" field eka add kalama, "${docType}" table ekata aluth column ekak ("${key}") ekamama add wenawa. Continue karanna da?`)) return

    updateItem(selectedItem.id, { fields: [...selectedItem.fields, { key, label: label.trim(), value: '' }] })
    setActiveFieldIdx(selectedItem.fields.length) // jump straight into draw mode for the new field
    // scroll the new row into view so the "draw a box" hint is obviously connected to it
    requestAnimationFrame(() => {
      fieldsScrollRef.current?.scrollTo({ top: fieldsScrollRef.current.scrollHeight, behavior: 'smooth' })
    })

    try {
      const res = await fetch('/api/ensure-column', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ doc_type: docType, key }),
      })
      const d = await res.json()
      if (!res.ok) logError('ensure-column', d.error || 'Column create failed')
    } catch (e: any) {
      logError('ensure-column', e.message)
    }
  }

  // Renaming changes both the display label and the underlying key (which is
  // what save-to-table.ts uses as the DB column name) — lets the user match
  // an existing table's exact column name instead of whatever the regex/OCR
  // step first called it.
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
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ doc_type: docType, key: field.key }),
        })
        const d = await res.json()
        if (!res.ok) logError('delete-field', d.error || 'Column delete failed')
      } catch (e: any) {
        logError('delete-field', e.message)
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
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ doc_type: selectedItem.detectedType, boxes: selectedItem.boxes, labels, excludeWords, formulas, variant: selectedItem.variant }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Save failed')
      alert(`Format saved for "${selectedItem.detectedType}" (${selectedItem.variant === 'scanned' ? 'Scanned/OCR' : 'Native Text'}) — future uploads of this variant will auto-use these boxes.`)
    } catch (e: any) {
      logError('save-field-boxes', e.message)
      alert('Error: ' + e.message)
    } finally {
      setSavingFormat(false)
    }
  }

  // Native and scanned copies of the same doc_type are usually laid out the
  // same way, just shifted/scaled — copying the other variant's saved boxes in
  // gives the user a starting point to drag into place instead of redrawing
  // every field from scratch.
  async function copyBoxesFromOtherVariant() {
    if (!selectedItem || !selectedItem.detectedType) { alert('Document type select karanna kalin'); return }
    const otherVariant = selectedItem.variant === 'scanned' ? 'native' : 'scanned'
    setCopyingBoxes(true)
    try {
      const res = await fetch('/api/copy-field-boxes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
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
      logError('copy-field-boxes', e.message)
      alert('Error: ' + e.message)
    } finally {
      setCopyingBoxes(false)
    }
  }

  const readyCount = items.filter(it => it.status === 'ready').length
  const savedCount = items.filter(it => it.status === 'saved').length

  return (
    <AdminLayout>
      <div className="p-6 h-full">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold text-gray-900">Documents</h1>
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-indigo-100 text-indigo-700">Admin</span>
            </div>
            <p className="text-gray-500 text-sm mt-0.5">Upload · Extract · Preview</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowErrors(v => !v)}
              className={`relative flex items-center gap-1.5 px-3 py-2 text-xs rounded-lg border transition-colors ${
                errors.length ? 'border-red-200 text-red-600 bg-red-50 hover:bg-red-100' : 'border-gray-200 text-gray-500 hover:bg-gray-50'
              }`}>
              <AlertTriangle size={13}/>
              Error Log
              {errors.length > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white text-xs rounded-full flex items-center justify-center leading-none">
                  {Math.min(errors.length, 9)}
                </span>
              )}
            </button>
            <div className="flex bg-gray-100 rounded-lg p-0.5">
              {(['upload','preview'] as Panel[]).filter(p => p === 'upload' ? canUpload : canPreview).map(p => (
                <button key={p} onClick={() => setPanel(p)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors capitalize ${
                    panel === p ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                  }`}>{p}</button>
              ))}
            </div>
          </div>
        </div>

        {showErrors && (
          <div className="mb-4 card border-red-100 bg-red-50">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-red-700 flex items-center gap-1.5">
                <AlertTriangle size={14}/> Error Log ({errors.length})
              </h3>
              <div className="flex gap-2">
                <button onClick={() => setErrors([])} className="text-xs text-red-500 hover:text-red-700">Clear</button>
                <button onClick={() => setShowErrors(false)}><X size={14} className="text-red-400"/></button>
              </div>
            </div>
            {errors.length === 0 ? (
              <p className="text-xs text-red-400">No errors</p>
            ) : (
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {errors.map((e, i) => (
                  <div key={i} className="text-xs bg-white rounded p-2 border border-red-100">
                    <span className="text-red-400 mr-1">[{e.time}]</span>
                    <span className="font-medium text-red-600">{e.step}:</span>{' '}
                    <span className="text-gray-700">{e.msg}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* === UPLOAD PANEL === */}
        {panel === 'upload' && canUpload && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

            {/* Dropzone */}
            <div className="lg:col-span-2 card">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-semibold text-gray-900 text-sm">Upload PDFs</h2>
                {items.length > 0 && (
                  <button onClick={handleSaveAll} disabled={savingAll || readyCount === 0}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-white font-medium bg-[#1B3A5C] disabled:opacity-40">
                    {savingAll ? <Loader size={13} className="animate-spin"/> : <Save size={13}/>}
                    Save All ({readyCount})
                  </button>
                )}
              </div>

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
                <p className="text-xs text-gray-400 mt-3">
                  {items.length} file{items.length !== 1 ? 's' : ''} · {savedCount} saved · {readyCount} ready
                </p>
              )}
            </div>

            {/* Sidebar list */}
            <div className="card">
              <h2 className="font-semibold text-gray-900 text-sm mb-3">
                Uploaded ({items.length})
              </h2>
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
                    return (
                      <div key={it.id}
                        onClick={() => it.status !== 'reading' && it.status !== 'extracting' && setSelectedId(it.id)}
                        className={`flex items-center gap-2 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                          selectedId === it.id ? 'border-2' : 'border-gray-100 hover:bg-gray-50'
                        }`}
                        style={selectedId === it.id ? { borderColor: color, backgroundColor: `${color}10` } : {}}>
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
                          <button onClick={e => startRename(it, e)} className="text-gray-300 hover:text-gray-600 p-1">
                            <Pencil size={12}/>
                          </button>
                          <button onClick={e => { e.stopPropagation(); removeItem(it.id) }} className="text-gray-300 hover:text-red-500 p-1">
                            <Trash2 size={12}/>
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* === PREVIEW PANEL === */}
        {panel === 'preview' && canPreview && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="card">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold text-gray-900">All Documents</h2>
                <div className="flex items-center gap-2">
                  <select value={filterType} onChange={e => setFilterType(e.target.value)}
                    className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white text-gray-600">
                    <option value="all">All types</option>
                    {DOC_TYPES.map(d => <option key={d.key} value={d.key}>{d.label}</option>)}
                  </select>
                  <button onClick={loadRecords} className="text-gray-400 hover:text-gray-700">
                    <RefreshCw size={14}/>
                  </button>
                </div>
              </div>

              {loadingRecs ? (
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
                      <button key={rec.id} onClick={() => setSelectedRec(rec)}
                        className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-all text-left ${
                          selectedRec?.id === rec.id
                            ? 'border-2 bg-opacity-5'
                            : 'border-gray-100 hover:border-gray-200 hover:bg-gray-50'
                        }`}
                        style={selectedRec?.id === rec.id ? { borderColor: color, backgroundColor: `${color}10` } : {}}>
                        <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                          style={{ background: `${color}20` }}>
                          <Icon size={15} style={{ color }}/>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-800 truncate">{rec.file_name}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-xs px-1.5 py-0.5 rounded font-medium"
                              style={{ background: `${color}20`, color }}>
                              {rec.doc_type.replace('_', ' ').toUpperCase()}
                            </span>
                            <span className="text-xs text-gray-400">
                              {new Date(rec.created_at).toLocaleDateString('en-GB')}
                            </span>
                          </div>
                        </div>
                        {rec.drive_url && <ExternalLink size={13} className="text-gray-300 flex-shrink-0"/>}
                      </button>
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
                        {selectedRec.doc_type.replace('_', ' ').toUpperCase()} ·{' '}
                        {new Date(selectedRec.created_at).toLocaleString('en-GB')}
                      </p>
                    </div>
                    {selectedRec.drive_url && (
                      <a href={selectedRec.drive_url} target="_blank" rel="noreferrer"
                        className="flex items-center gap-1.5 text-xs text-white px-3 py-1.5 rounded-lg flex-shrink-0 ml-2"
                        style={{ background: TYPE_COLORS[selectedRec.doc_type] || '#1B3A5C' }}>
                        <ExternalLink size={12}/> Open in Drive
                      </a>
                    )}
                  </div>

                  {/* Full PDF, rendered page by page from Drive */}
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

                  {selectedRec.extracted_data && Object.keys(selectedRec.extracted_data).length > 0 ? (
                    <div className="overflow-auto max-h-[300px]">
                      <table className="w-full text-xs">
                        <thead className="sticky top-0 bg-white">
                          <tr className="bg-gray-50">
                            <th className="text-left px-2 py-2 text-gray-500 font-medium w-14">Grid</th>
                            <th className="text-left px-2 py-2 text-gray-500 font-medium">Value</th>
                          </tr>
                        </thead>
                        <tbody>
                          {Object.entries(selectedRec.extracted_data)
                            .filter(([, v]) => v)
                            .map(([k, v], i) => {
                              const grid = k.replace('grid_', '')
                              const color = TYPE_COLORS[selectedRec.doc_type] || '#6b7280'
                              return (
                                <tr key={i} className="border-t border-gray-50 hover:bg-gray-50">
                                  <td className="px-2 py-1.5">
                                    <span className="inline-block text-white text-xs font-mono px-1.5 py-0.5 rounded"
                                      style={{ background: color }}>{grid}</span>
                                  </td>
                                  <td className="px-2 py-1.5 text-gray-700">{String(v)}</td>
                                </tr>
                              )
                            })}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="text-center py-6 text-gray-400 text-sm">
                      No extracted data — file stored only
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {/* === Extracted-data popup modal === */}
        {selectedItem && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-6"
            onClick={() => setSelectedId(null)}>
            <div className="bg-white rounded-2xl w-full max-w-6xl max-h-[90vh] flex flex-col overflow-hidden"
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
                  title={selectedItem.variant === 'scanned'
                    ? 'This PDF had no extractable text, so it was scanned as an image and OCR was used — its box template is stored separately from native-text PDFs of this type.'
                    : 'This PDF had extractable native text — its box template is stored separately from scanned/OCR PDFs of this type.'}
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

              <div className="flex-1 overflow-hidden flex gap-4 px-5 py-3">
                {/* Left: PDF page image with drawable correction box */}
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

                {/* Right: numbered field list */}
                <div className="flex-1 flex flex-col min-h-0">
                  <div className="mb-2 flex-shrink-0 flex justify-end">
                    <button onClick={addCustomField}
                      className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700 px-2 py-1 rounded-md hover:bg-blue-50">
                      <Plus size={13}/> Add Field
                    </button>
                  </div>
                  {/* Fixed above the scroll area so it stays visible while scrolling the field list */}
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
                                className="w-full bg-transparent border-b border-transparent hover:border-gray-200 focus:border-current focus:outline-none py-0.5 text-gray-800 disabled:text-gray-400 resize-none leading-tight"/>
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
                  <button onClick={() => saveOne(selectedItem)} disabled={selectedItem.status === 'saving'}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs text-white font-medium disabled:opacity-50"
                    style={{ background: docDef(selectedItem.detectedType)?.color || '#1B3A5C' }}>
                    {selectedItem.status === 'saving' ? <Loader size={13} className="animate-spin"/> : <Save size={13}/>}
                    {selectedItem.status === 'saved' ? 'Re-save' : 'Save'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  )
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const reader = new FileReader()
    reader.onload  = () => res((reader.result as string).split(',')[1])
    reader.onerror = rej
    reader.readAsDataURL(file)
  })
}
