import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { detectType } from '@/lib/extractors'
import { ocrPdf } from '@/lib/ocr'
import { extractByGrid } from '@/lib/gridExtract'
import { extractBoxes } from '@/lib/boxExtract'
import { applyTextRules } from '@/lib/textClean'
import { DOC_TYPE_TABLE, getTableColumns } from '@/lib/docTables'

export const config = { api: { bodyParser: { sizeLimit: '20mb' } } }

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Maps extractors.ts's DocType values to the doc_type values used by documents.tsx/DB
const DETECTED_TO_DOC_TYPE: Record<string, string> = {
  cusdec: 'cusdec',
  cdn: 'cdn',
  barcode: 'barcode',
  boatnote: 'boat_note',
  partycopy: 'party_copy',
  unknown: '',
}

// pdf-parse (pdfjs-dist underneath) can throw "Invalid PDF structure" on an
// otherwise-valid file — a transient failure tied to a cold/fresh serverless
// instance, not the file itself: re-sending the exact same bytes right after
// always succeeds. Retrying a few times here does automatically what a
// manual re-upload was doing, instead of surfacing the error to the user.
async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  const pdfParse = require('pdf-parse')
  let lastErr: any
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const parsed = await pdfParse(buffer)
      return parsed.text
    } catch (e: any) {
      lastErr = e
      if (attempt < 3) await new Promise(r => setTimeout(r, 250 * attempt))
    }
  }
  throw lastErr
}

// Port of Python isProbablyScanned — textLen < 50 chars means scanned
function isProbablyScanned(text: string): boolean {
  const words = text.trim().split(/\s+/).filter(w => w.length > 2)
  return words.length < 20
}

// CDN extraction — ported from Python main1.py CDN section
function extractCdnFields(text: string): Record<string, string> {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  const data: Record<string, string> = {
    code: '', year: '', serial: '', number: '', shipper: '', consignee: '',
    voyage: '', voyage_date: '', bl_no: '', driver_name: '', location: '',
    lorry_no: '', trailer_no: '', loading_port: '', discharge_port: '',
    vessel: '', voc: '', coc: '', cusdec_number: '', container_no: '',
    con_type: '', seal_no: '', goods_description: '', gross_mass: '',
    pkg_no: '', pkg_type: '', cdn_no: '', volume: '', marks: '', temperature: '',
  }

  // Driver: line before "13. Location of Goods"
  let driverIdx = -1
  for (let k = 0; k < lines.length; k++) {
    if (lines[k].includes('13. Location of Goods') && k > 0) {
      data.driver_name = lines[k - 1]
      driverIdx = k - 1
      break
    }
  }

  // CDN No — between "11.a Seal No. CDN No." and "2.b Consignee"
  const cdnMatch = text.match(/11\.a Seal No\. CDN No\.([\s\S]*?)2\.b Consignee/i)
  if (cdnMatch) {
    const found = cdnMatch[1].match(/C\s*\d+/)
    if (found) data.cdn_no = found[0]
  }

  for (let k = 0; k < lines.length; k++) {
    const line = lines[k]

    // Container No / Size from "Weight, ... Kg"
    if (line.includes('Weight,') && k + 1 < lines.length && lines[k + 1].includes('Kg')) {
      if (k + 2 < lines.length) {
        const parts = lines[k + 2].split(/\s+/)
        if (parts.length >= 2) { data.container_no = parts[0]; data.pkg_no = parts[1] }
      }
    }

    // Con type from "23. Type of container"
    if (line.includes('23. Type of container') && k > 0) {
      data.con_type = lines[k - 1]
      if (k > 1) {
        const p = lines[k - 2].split(/\s+/)
        if (p.length >= 2) { data.pkg_type = p[0]; data.bl_no = p[1] }
      }
      if (k > 2) {
        const pv = lines[k - 3].split(/\s+/)
        if (pv.length) data.volume = pv[pv.length - 1]
      }
      if (k > 3) {
        const wLine = lines[k - 3]
        const wClean = wLine.replace(/KG/gi, '').trim().split(/\s+/)
        if (wClean.length >= 2) data.gross_mass = wClean[wClean.length - 2]
        data.goods_description = data.gross_mass ? wLine.split(data.gross_mass)[0].trim() : wLine
      }
    }

    // VSL OPR / CNT OPR from "17. Signature, Designation and Date"
    if (line.includes('17. Signature, Designation and Date')) {
      const partsAfter = line.split('17. Signature, Designation and Date')[0].trim().split(/\s+/)
      if (partsAfter.length >= 2) { data.coc = partsAfter[partsAfter.length - 1]; data.voc = partsAfter[partsAfter.length - 2] }
    }

    // Loading port from "6. Name of certifying"
    if (line.includes('6. Name of certifying') && k + 1 < lines.length) {
      data.loading_port = 'COLOMBO'
    }

    // Vessel / Date from "conditions &"
    if (line.includes('conditions &') && k + 1 < lines.length) {
      const target = lines[k + 1]
      const dayM = target.match(/(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+([A-Za-z]+)\s+(\d+)/)
      if (dayM) {
        data.vessel = target.split(dayM[1])[0].trim()
        const months: Record<string, string> = { Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12' }
        const yr = new Date().getFullYear()
        data.voyage_date = `${dayM[3].padStart(2,'0')}.${months[dayM[2]] || '01'}.${yr}`
      }
    }

    // DECLARATION REFERENCE → code/year/serial/number
    if (line.includes('DECLARATION REFERENCE') && k + 1 < lines.length) {
      const ref = lines[k + 1].split(/\s+/)
      if (ref.length >= 4) { data.code = ref[0]; data.year = ref[1]; data.serial = ref[2]; data.number = ref[3] }
    }

    // Shipper from "1.a Shipper"
    if (line.includes('1.a Shipper') && k + 1 < lines.length) {
      const p1 = lines[k + 1].split(/\s+/)
      if (p1.length >= 3) {
        data.bl_no = p1[p1.length - 1]
        const shipLine = p1.slice(0, -2).join(' ')
        data.shipper = k + 2 < lines.length ? `${shipLine}\n${lines[k + 2].split(/\s+/).slice(0, -1).join(' ')}` : shipLine
      }
    }

    // Consignee from "2.b Consignee"
    if (line.includes('2.b Consignee (Name and Address)')) {
      const after = line.split('2.b Consignee (Name and Address)')[1].split(/\s+/)
      const conStart = after[0] || ''
      let consLines = [line.split(conStart).slice(1).join(conStart).trim()]
      for (let m = k + 1; m < lines.length; m++) {
        if (m >= driverIdx && driverIdx >= 0) break
        if (!lines[m].includes('12. Name of Driver')) consLines.push(lines[m])
      }
      data.consignee = consLines.join('\n').trim()
    }

    // Cusdec number from "1.b Cusdec Numbers"
    if (line.includes('1.b Cusdec Numbers') && k + 1 < lines.length) data.cusdec_number = lines[k + 1]

    // Location from "13. Location of Goods"
    if (line.includes('13. Location of Goods') && k + 1 < lines.length) data.location = lines[k + 1]

    // Discharge port
    if (line.includes('Port of Discharge') && k + 1 < lines.length) data.discharge_port = lines[k + 1]

    // Seal No
    if (line.match(/seal/i) && k + 1 < lines.length) {
      const s = lines[k + 1].match(/[A-Z0-9]{6,}/)
      if (s) data.seal_no = s[0]
    }
  }

  return data
}

// CUSDEC extraction — ported from Python main1.py CUSDEC section
function extractCusdecFields(text: string): Record<string, string> {
  const data: Record<string, string> = {
    code: '', number: '', date: '', exporter: '', consignee: '', total_packages: '',
    cty_of_last: '', country_of_export: '', cap: '', vessel: '', voyage_no: '', discharging: '',
    location_of_goods: '', delivery_terms: '', amount: '', pkges: '', type: '', description: '',
    hs_code: '', gross_mass: '', net_mass: '', preference: '', procedure_code: '', bl_no: '',
    invoice_number: '',
  }

  // Invoice Number — used to auto-match this CUSDEC against a pending
  // Shipment entry (temporary_shipments.invoice_number). Regex is best-effort
  // (form layout varies); if it misses, the field can still be corrected by
  // hand in Admin Edit before saving, same as any other extracted field.
  const invM = text.match(/Invoice\s*(?:No\.?|Number)\s*[:\-]?\s*([A-Z0-9\/\-]+)/i)
  if (invM) data.invoice_number = invM[1]

  // Office ref → number
  const offM = text.match(/EX\s*1\s+([A-Z0-9]+)/)
  if (offM) data.number = offM[1]

  // Date from Load List
  const bcM = text.match(/Load\s*List\s*[A-Z]\s*(\d+)\s*(\d{2}\/\d{2}\/\d{4})/)
  if (bcM) data.date = bcM[2]

  // Exporter (declarant info)
  const eM = text.match(/Financial\s*Settlement\s*TIN:([\s\S]*?)10\s*Cty\s*of\s*Last/i)
  if (eM) {
    const cleaned = eM[1].replace(/Order\s+granted/gi, '').trim()
    data.exporter = cleaned.replace(/\s+/g, ' ').trim()
  }

  // Consignee / importer
  const dM = text.match(/Information([\s\S]*?)3\s*Forms/)
  if (dM) data.consignee = dM[1].replace(/Customs Reference Number:/g, '').replace(/\s+/g, ' ').trim()

  // Total packages
  const pkgM = text.match(/7\s*Declarant['']s\s*Sequence\s*Number\s*1\s+([\d,.]+)/)
  if (pkgM) data.total_packages = pkgM[1]

  // Country
  const ctyM = text.match(/Cty\.\s+(\d+)/)
  if (ctyM) data.country_of_export = ctyM[1]

  // Amount
  const amtM = text.match(/([\d,.]+)\s+cod/)
  if (amtM) data.amount = amtM[1]

  // Gross / Net mass
  const tM = text.match(/36\s*Preference[\s\S]*?a\s*LK\s*b\s*([\d,.]+)/i)
  if (tM) data.gross_mass = tM[1]

  const uM = text.match(/39\s*Quota\s*Containers\s*No\(s\)\s+[\d.]+\s+[\d.]+\s+([\d,.]+)/)
  if (uM) data.net_mass = uM[1]

  // BL No — look for common BL patterns (CMB..., MAEU..., etc.)
  const blM = text.match(/\b(CMB[A-Z0-9]+|MAEU[0-9]+|[A-Z]{3,4}\d{8,})\b/)
  if (blM) data.bl_no = blM[1]

  // Vessel from "conditions &" pattern (same as CDN)
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  for (let k = 0; k < lines.length; k++) {
    if (lines[k].includes('conditions &') && k + 1 < lines.length) {
      const target = lines[k + 1]
      const dayM = target.match(/(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+([A-Za-z]+)\s+(\d+)/)
      if (dayM) {
        data.vessel = target.split(dayM[1])[0].trim()
        const months: Record<string, string> = { Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12' }
        const yr = new Date().getFullYear()
        data.voyage_no = `${dayM[3].padStart(2,'0')}.${months[dayM[2]] || '01'}.${yr}`
      }
    }
    if (lines[k].includes('Port of Discharge') && k + 1 < lines.length) data.discharging = lines[k + 1]
    if (lines[k].includes('Location of Goods') && k + 1 < lines.length) data.location_of_goods = lines[k + 1]
  }

  return data
}

// Barcode (SLPA Cargo Management System slip) — common container-terminal patterns.
// Fields the user hasn't seen matched yet stay blank for manual entry/edit in the UI.
function extractBarcodeFields(text: string): Record<string, string> {
  const data: Record<string, string> = {
    container_no: '', seal_no: '', truck_no: '', driver_name: '',
    gross_mass: '', tare_mass: '', net_mass: '', terminal: '',
    vessel: '', voyage: '', date: '', time: '',
  }

  const containerM = text.match(/\b([A-Z]{4}\s?\d{6,7})\b/)
  if (containerM) data.container_no = containerM[1].replace(/\s+/g, '')

  const sealM = text.match(/seal\s*(?:no\.?)?\s*[:\-]?\s*([A-Z0-9]{6,})/i)
  if (sealM) data.seal_no = sealM[1]

  const grossM = text.match(/gross\s*(?:mass|weight)\s*[:\-]?\s*([\d,.]+)/i)
  if (grossM) data.gross_mass = grossM[1]

  const tareM = text.match(/tare\s*(?:mass|weight)\s*[:\-]?\s*([\d,.]+)/i)
  if (tareM) data.tare_mass = tareM[1]

  const netM = text.match(/net\s*(?:mass|weight)\s*[:\-]?\s*([\d,.]+)/i)
  if (netM) data.net_mass = netM[1]

  const dateM = text.match(/\b(\d{2}[./]\d{2}[./]\d{4})\b/)
  if (dateM) data.date = dateM[1]

  const timeM = text.match(/\b(\d{1,2}:\d{2}(?::\d{2})?)\b/)
  if (timeM) data.time = timeM[1]

  return data
}

// Boat Note (shipping note) — same field shape used by generate-boat-note.ts,
// so a corrected value here lines up with what the rest of the app expects.
function extractBoatNoteFields(text: string): Record<string, string> {
  const data: Record<string, string> = {
    shipper: '', consignee: '', entry_no: '', bl_no: '', slpa_no: '',
    voyage: '', voyage_date: '', vessel: '', terminal: '', lorry_no: '',
    trailer_no: '', driver_name: '', container_no: '', con_type: '',
    seal_no: '', goods: '', gross_mass: '', cdn_no: '', pkg_no: '',
    pkg_type: '', voc: '', coc: '', loading_port: '', discharge_port: '',
  }

  const containerM = text.match(/\b([A-Z]{4}\s?\d{6,7})\b/)
  if (containerM) data.container_no = containerM[1].replace(/\s+/g, '')

  const sealM = text.match(/seal\s*(?:no\.?)?\s*[:\-]?\s*([A-Z0-9]{6,})/i)
  if (sealM) data.seal_no = sealM[1]

  const grossM = text.match(/gross\s*(?:mass|weight)\s*(?:\(kg\))?\s*[:\-]?\s*([\d,.]+)/i)
  if (grossM) data.gross_mass = grossM[1]

  const blM = text.match(/\b(CMB[A-Z0-9]+|MAEU[0-9]+|[A-Z]{3,4}\d{8,})\b/)
  if (blM) data.bl_no = blM[1]

  return data
}

// Nicer labels for keys whose plain "KEY_NAME -> KEY NAME" uppercasing wouldn't
// read naturally, matching the exact column names the user wants to see.
const LABEL_OVERRIDES: Record<string, string> = {
  cap: 'C.A.P.', hs_code: '(HS) Code', cty_of_last: 'Cty of Last',
  voyage_no: 'Voyage No./Date', bl_no: 'BL No.', pkges: 'PKGES',
  gross_mass: 'Gross Mass (KG)', net_mass: 'Net Mass (KG)',
}

function toFieldArray(data: Record<string, string>, docType: string) {
  return Object.entries(data).map(([key, value]) => ({
    key, label: LABEL_OVERRIDES[key] || key.replace(/_/g, ' ').toUpperCase(), value,
  }))
}

// Structural columns that exist for app bookkeeping, not as an extractable field.
const NON_FIELD_COLUMNS = new Set([
  'id', 'shipment_id', 'created_at', 'pdf_url', 'status',
  'xml_data', 'cusdec_no', 'cdn_no', 'details', 'boat_note_no',
])

// The doc type's real table is the source of truth for which fields show up —
// add/delete a field in the popup literally adds/drops a column there, so the
// field list here must always reflect exactly what that table currently has.
async function buildFieldsFromSchema(resolvedType: string, regexData: Record<string, string>) {
  const table = DOC_TYPE_TABLE[resolvedType]
  if (!table || table === 'boat_notes') return toFieldArray(regexData, resolvedType) // jsonb-backed, no per-column schema
  try {
    const columns = (await getTableColumns(table)).filter(c => !NON_FIELD_COLUMNS.has(c))
    if (!columns.length) return toFieldArray(regexData, resolvedType) // management API not configured
    return columns.map(key => ({
      key, label: LABEL_OVERRIDES[key] || key.replace(/_/g, ' ').toUpperCase(), value: regexData[key] || '',
    }))
  } catch (e: any) {
    console.error('[extract-pdf] schema lookup failed, falling back to regex field list:', e.message)
    return toFieldArray(regexData, resolvedType)
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  try {
    const { base64, docType } = req.body
    if (!base64) return res.status(400).json({ error: 'No file data' })

    const buffer = Buffer.from(base64, 'base64')
    let text = ''
    let textExtractError = ''
    try {
      text = await extractTextFromPdf(buffer)
    } catch (e: any) {
      // pdf-parse (pdfjs-dist) failing 3x in a row on the SAME file is a real
      // parse failure, not the cold-start flake the retry covers — fall
      // through to OCR (a completely different library, mupdf+tesseract)
      // instead of failing outright, since it can often still read a file
      // pdfjs chokes on.
      textExtractError = e.message
      console.error('[extract-pdf] pdf-parse failed after retries, falling back to OCR:', e.message)
    }
    let ocrApplied = false

    if (isProbablyScanned(text)) {
      try {
        const ocrText = await ocrPdf(buffer)
        if (!isProbablyScanned(ocrText)) { text = ocrText; ocrApplied = true }
      } catch (e: any) {
        console.error('[extract-pdf] OCR failed:', e.message)
        if (textExtractError) {
          throw new Error(`Could not read this PDF — text extraction failed (${textExtractError}) and OCR also failed (${e.message}). The file itself may be corrupted; try re-saving/re-exporting it and upload again.`)
        }
      }
    } else if (textExtractError) {
      // Text extraction failed but produced no signal either way on whether
      // it's scanned — still worth trying OCR once before giving up.
      try {
        const ocrText = await ocrPdf(buffer)
        if (!isProbablyScanned(ocrText)) { text = ocrText; ocrApplied = true }
        else throw new Error('OCR could not extract readable text either')
      } catch (e: any) {
        throw new Error(`Could not read this PDF — text extraction failed (${textExtractError}) and OCR also failed (${e.message}). The file itself may be corrupted; try re-saving/re-exporting it and upload again.`)
      }
    }

    const detected = detectType(text)
    const detectedDocType = DETECTED_TO_DOC_TYPE[detected] || ''
    const resolvedType = docType || detectedDocType

    console.log(`[extract-pdf] docType=${docType} detected=${detected} ocrApplied=${ocrApplied} textLen=${text.length} preview="${text.slice(0,100).replace(/\n/g,' ')}"`)

    // Prefer a saved Grid Mapper template for this doc type — cropping to the
    // user-labelled boxes and OCR-ing each one directly from the PDF works even
    // when whole-page text extraction below finds nothing (scanned/vector PDFs).
    let fields: any[] = []
    let gridUsed = false
    let appliedBoxes: Record<string, { x: number; y: number; w: number; h: number }> = {}
    // A scanned/photographed page renders at different proportions than the same
    // doc type generated as native text — box coordinates calibrated for one
    // don't line up on the other, so each variant gets its own saved template.
    const variant = ocrApplied ? 'scanned' : 'native'
    if (resolvedType) {
      const { data: template } = await supabaseAdmin
        .from('pdf_templates')
        .select('id, grid_config, field_map')
        .eq('doc_type', resolvedType)
        .eq('variant', variant)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (template?.grid_config?.boxes) {
        // Per-field arbitrary boxes (saved via the popup's "draw a correction box" flow).
        // Only some of the doc type's columns may have a box saved yet — the rest of the
        // table's columns must still show up (blank), not disappear just because they
        // haven't been boxed. Only an actual field delete should remove one from the list.
        try {
          const boxes: Record<string, { x: number; y: number; w: number; h: number }> = template.grid_config.boxes
          const labels: Record<string, string> = template.field_map || {}
          const excludeWords: Record<string, string> = template.grid_config.excludeWords || {}
          const formulas: Record<string, string> = template.grid_config.formulas || {}
          const rawBoxTexts = await extractBoxes(buffer, boxes)
          const boxedFields = Object.entries(boxes).map(([key, box]) => ({
            key, label: labels[key] || key,
            value: applyTextRules(rawBoxTexts[key], formulas[key], excludeWords[key]),
          }))
          const boxedByKey = new Map(boxedFields.map(f => [f.key, f]))
          const schemaFields = await buildFieldsFromSchema(resolvedType, {})
          fields = schemaFields.map(f => boxedByKey.get(f.key) || f)
          for (const bf of boxedFields) if (!fields.find(f => f.key === bf.key)) fields.push(bf)

          appliedBoxes = boxes
          gridUsed = true
        } catch (e: any) {
          console.error('[extract-pdf] box extraction failed:', e.message)
        }
      } else if (template) {
        // Uniform grid (saved via the Grid Mapper page)
        try {
          const gridFields = await extractByGrid(buffer, template.grid_config, template.field_map)
          fields = gridFields.map(f => ({ key: `cell_${f.cellNum}`, label: f.label, value: f.value }))
          gridUsed = true
        } catch (e: any) {
          console.error('[extract-pdf] grid extraction failed:', e.message)
        }
      }
    }

    if (!gridUsed && isProbablyScanned(text)) {
      return res.json({
        fields: [],
        rawText: text,
        scanned: true,
        detectedDocType,
        variant,
        warning: ocrApplied
          ? 'This PDF is a scanned image and OCR could not read enough text from it. Please review and select the type manually.'
          : 'This PDF appears to be a scanned image and OCR could not run on it. Please select the type manually.',
      })
    }

    if (!gridUsed) {
      if (resolvedType === 'cusdec') {
        fields = await buildFieldsFromSchema(resolvedType, extractCusdecFields(text))
      } else if (resolvedType === 'cdn') {
        fields = await buildFieldsFromSchema(resolvedType, extractCdnFields(text))
      } else if (resolvedType === 'barcode') {
        fields = await buildFieldsFromSchema(resolvedType, extractBarcodeFields(text))
      } else if (resolvedType === 'boat_note') {
        const data = extractBoatNoteFields(text)
        fields = toFieldArray(data, resolvedType)
      }
    }

    const filled = fields.filter((f: any) => f.value).length
    console.log(`[extract-pdf] gridUsed=${gridUsed} filled ${filled}/${fields.length} fields`)
    res.json({ fields, rawText: text, scanned: false, detectedDocType, ocrApplied, gridUsed, boxes: appliedBoxes, variant })
  } catch (err: any) {
    console.error('[extract-pdf] error:', err)
    res.status(500).json({ error: err.message })
  }
}
