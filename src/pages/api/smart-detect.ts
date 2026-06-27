import type { NextApiRequest, NextApiResponse } from 'next'

export const config = { api: { bodyParser: { sizeLimit: '20mb' } } }

// ─── Text extraction ──────────────────────────────────────────────────────────
async function extractText(buffer: Buffer): Promise<string> {
  try {
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.js')
    const pdf = await (pdfjsLib as any).getDocument({ data: new Uint8Array(buffer) }).promise
    let text = ''
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i)
      const content = await page.getTextContent()
      text += content.items.map((it: any) => it.str).join(' ') + '\n'
    }
    return text
  } catch {
    const pdfParse = require('pdf-parse')
    return (await pdfParse(buffer)).text
  }
}

// ─── Detection ────────────────────────────────────────────────────────────────
export type DocType = 'cusdec' | 'cdn' | 'barcode' | 'boatnote' | 'unknown'

function detectType(text: string): DocType {
  const t = text.toUpperCase()
  if (t.includes('SHIPPING NOTE') || t.includes('BOAT NOTE') || t.includes('SN SHOULD NOT BE CLAUSED') || t.includes('EXP 3A'))
    return 'boatnote'
  if (t.includes('GATE PASS SLIP') || (t.includes('AGENT PASS NO') && t.includes('DRIVER ID')))
    return 'barcode'
  if (t.includes('CARGO DISPATCH NOTE') || t.includes('EXP 3B') || t.includes('CONTAINER LOAD PLAN'))
    return 'cdn'
  if (t.includes('CUSDEC') || t.includes('SRI LANKA CUSTOMS') || t.includes('GOODS DECLARATION') || t.includes('SCHEDULE II'))
    return 'cusdec'
  return 'unknown'
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function find(text: string, ...pats: RegExp[]): string {
  for (const p of pats) {
    const m = text.match(p)
    if (m) return (m[1] ?? m[0]).trim()
  }
  return ''
}

function afterLine(text: string, pat: RegExp, count = 3): string {
  const ls = text.split('\n').map(l => l.trim()).filter(Boolean)
  const i = ls.findIndex(l => pat.test(l))
  if (i < 0) return ''
  return ls.slice(i + 1, i + 1 + count).join(' ').trim()
}

// ─── Field region type ────────────────────────────────────────────────────────
export interface ExtractedField {
  key: string
  label: string
  value: string
  region: { x: number; y: number; w: number; h: number }  // percentage of page
}

// ─── CUSDEC ───────────────────────────────────────────────────────────────────
function extractCusdec(text: string): ExtractedField[] {
  const ls = text.split('\n').map(l => l.trim()).filter(Boolean)

  // Vessel/voyage from the formatted section
  let vessel = ''
  let voyageNo = ''
  for (let k = 0; k < ls.length; k++) {
    if (/18\s+Vessel/i.test(ls[k]) && k + 1 < ls.length) vessel = ls[k + 1].replace(/19\s+Ctr.*/i, '').trim()
    if (/21\s+Voyage/i.test(ls[k]) && k + 1 < ls.length) voyageNo = ls[k + 1].trim()
  }

  return [
    {
      key: 'entry_no', label: 'Entry Number',
      value: find(text, /\bE\s+(\d{5,})\b/, /Entry\s*No[.:\s]+([A-Z0-9]+)/i),
      region: { x: 60, y: 3, w: 26, h: 7 }
    },
    {
      key: 'exporter', label: 'Exporter',
      value: find(text, /TIN:\s*\d+[\s\S]*?\n([A-Z][^\n]{5,})/i) ||
        afterLine(text, /2\s+Exporter/i, 2),
      region: { x: 8, y: 9, w: 42, h: 16 }
    },
    {
      key: 'consignee', label: 'Consignee',
      value: afterLine(text, /8\s+Consignee/i, 2) ||
        find(text, /Consignee[^\n]*\n([^\n]{5,})/i),
      region: { x: 8, y: 27, w: 42, h: 9 }
    },
    {
      key: 'vessel', label: 'Vessel/Flight',
      value: vessel || find(text, /(?:ZHONG|VESSEL)[^\n]*/i),
      region: { x: 8, y: 42, w: 42, h: 4 }
    },
    {
      key: 'voyage_no', label: 'Voyage No./Date',
      value: voyageNo || find(text, /(\d{4,6}[A-Z]?\s+OF\s+[\d.]+)/i, /(\d{5}[A-Z]\s+\d{2}\.\d{2}\.\d{4})/),
      region: { x: 8, y: 47, w: 35, h: 4 }
    },
    {
      key: 'hs_code', label: 'HS Code',
      value: find(text, /(\d{8})\s*00\b/, /47\d{6}/),
      region: { x: 62, y: 37, w: 28, h: 4 }
    },
    {
      key: 'gross_mass', label: 'Gross Mass (Kg)',
      value: find(text, /Gross\s*Mass[:\s]+([\d,]+\.?\d*)/i, /([\d,]+\.00)\s*ISFTA/i, /35\s+Gross[\s\S]*?([\d,]+\.00)/i),
      region: { x: 62, y: 42, w: 28, h: 4 }
    },
    {
      key: 'net_mass', label: 'Net Mass (Kg)',
      value: find(text, /Net\s*Mass[:\s]+([\d,]+\.?\d*)/i, /39\s*Quota[\s\S]*?([\d,]+\.00)/i),
      region: { x: 62, y: 47, w: 28, h: 4 }
    },
    {
      key: 'bl_no', label: 'B/L No.',
      value: find(text, /SL\/MB\/([\d]+)/, /\b(CMB[A-Z0-9]{8,})\b/, /\b(MAEU\d{8,})\b/),
      region: { x: 62, y: 52, w: 28, h: 4 }
    },
    {
      key: 'amount', label: 'Invoice Value (USD)',
      value: find(text, /USD[^\d]*([\d,]+\.?\d*)/i),
      region: { x: 62, y: 19, w: 28, h: 5 }
    },
    {
      key: 'goods', label: 'Description of Goods',
      value: find(text, /(WASTE PAPER[^\n]*)/i) || afterLine(text, /Description/i, 1),
      region: { x: 8, y: 58, w: 42, h: 5 }
    },
    {
      key: 'packages', label: 'Total Packages',
      value: find(text, /6\s+Total\s+Packages[\s\S]{1,20}?(\d+)\s+2026/i, /(\d+\.00)\s+2026\b/),
      region: { x: 50, y: 10, w: 12, h: 4 }
    },
    {
      key: 'assessment_no', label: 'Assessment Number',
      value: find(text, /Assessment\s+Number\s*:\s*A\s+(\d+)/i, /A\s+(\d{5,})/),
      region: { x: 50, y: 75, w: 40, h: 4 }
    },
    {
      key: 'receipt_no', label: 'Receipt Number',
      value: find(text, /Receipt\s+Number\s*:\s*R\s+(\d+)/i, /R\s+(\d{5,})/),
      region: { x: 50, y: 80, w: 40, h: 4 }
    },
  ]
}

// ─── CDN ──────────────────────────────────────────────────────────────────────
function extractCdn(text: string): ExtractedField[] {
  const ls = text.split('\n').map(l => l.trim()).filter(Boolean)

  // CDN No from between "11.a Seal No. CDN No." and "2.b Consignee"
  let cdnNo = ''
  const cdnMatch = text.match(/11\.a\s+Seal\s+No[.\s]+CDN\s+No[.\s]+([\s\S]*?)2\.b\s+Consignee/i)
  if (cdnMatch) {
    const m = cdnMatch[1].match(/C\s*\d+/)
    if (m) cdnNo = m[0].replace(/\s/g, ' ').trim()
  }
  if (!cdnNo) cdnNo = find(text, /(\d{4}\s+CBEX\d+\s+[A-Z]\s+\d+)/, /CDN\s*No[.:\s]+(\d{4}\s+\w+\s+[A-Z]\s+\d+)/i)

  return [
    {
      key: 'cdn_no', label: 'CDN No.',
      value: cdnNo,
      region: { x: 55, y: 17, w: 38, h: 8 }
    },
    {
      key: 'shipper', label: 'Shipper',
      value: afterLine(text, /1\.?a\s+Shipper/i, 2),
      region: { x: 5, y: 3, w: 40, h: 11 }
    },
    {
      key: 'cusdec_no', label: 'Cusdec Numbers',
      value: afterLine(text, /1\.?b\s+Cusdec/i, 2),
      region: { x: 5, y: 16, w: 40, h: 9 }
    },
    {
      key: 'consignee', label: 'Consignee',
      value: afterLine(text, /2\.?b\s+Consignee/i, 2) ||
        find(text, /TO ORDER\s*\n([^\n]+)/i),
      region: { x: 5, y: 38, w: 40, h: 10 }
    },
    {
      key: 'bl_no', label: 'B/L No. (SN)',
      value: find(text, /(?:STASL|CMDU|TCNU|MAEU|SMCM|CMBG)[A-Z0-9]{8,}/, /8[.\s]+SN[\s\S]{1,5}([A-Z]{4}[0-9]{8,})/i),
      region: { x: 55, y: 5, w: 38, h: 8 }
    },
    {
      key: 'slpa_no', label: 'SLPA No.',
      value: find(text, /SLPA\s*No[.:\s]+([0-9]{10,})/i) || afterLine(text, /10[.\s]+SLPA/i, 1),
      region: { x: 55, y: 13, w: 38, h: 5 }
    },
    {
      key: 'seal_no', label: 'Seal No.',
      value: find(text, /Seal\s+No[.:\s]+(\d{6,})/i, /(\d{6,})\s*CDN\s*No/i),
      region: { x: 55, y: 25, w: 38, h: 5 }
    },
    {
      key: 'driver_name', label: 'Name of Driver',
      value: (() => {
        const idx = ls.findIndex(l => /13[.\s]+Location/i.test(l))
        return idx > 0 ? ls[idx - 1] : ''
      })() || afterLine(text, /12[.\s]+Name\s+of\s+Driver/i, 1),
      region: { x: 55, y: 31, w: 38, h: 5 }
    },
    {
      key: 'lorry_no', label: 'Lorry/Trailer No.',
      value: afterLine(text, /7[.\s]+Lorry/i, 2),
      region: { x: 55, y: 37, w: 38, h: 7 }
    },
    {
      key: 'voyage_no', label: 'Voyage No./Date',
      value: afterLine(text, /3\.?a\s+Voyage/i, 1) ||
        find(text, /(\d{5}[A-Z]\s+(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[^\n]+)/i),
      region: { x: 5, y: 52, w: 40, h: 5 }
    },
    {
      key: 'vessel', label: 'Vessel',
      value: afterLine(text, /^4[.\s]+Vessel/im, 1) ||
        find(text, /ZHONG PENG YOU YI/i),
      region: { x: 5, y: 57, w: 40, h: 5 }
    },
    {
      key: 'port_discharge', label: 'Port of Discharge',
      value: afterLine(text, /5[.\s]+Port\s+of\s+Discharge/i, 1) ||
        find(text, /TUTICORIN|Discharge[:\s]+([A-Z]{3,20})/i),
      region: { x: 5, y: 63, w: 35, h: 5 }
    },
    {
      key: 'container_no', label: 'Container No.',
      value: find(text, /\b([A-Z]{4}\d{7})\b/),
      region: { x: 5, y: 68, w: 35, h: 12 }
    },
    {
      key: 'gross_mass', label: 'Gross Weight (Kg)',
      value: find(text, /Gross\s*Weight[,.\s]+([\d,]+\.?\d*)/i, /([\d,]+\.\d{2})\s*(?:KG|BL)/i),
      region: { x: 58, y: 68, w: 28, h: 8 }
    },
    {
      key: 'goods', label: 'Description of Goods',
      value: find(text, /(WASTE PAPER[^\n]*)/i) || afterLine(text, /20[.\s]+Description/i, 1),
      region: { x: 5, y: 75, w: 40, h: 5 }
    },
  ]
}

// ─── Barcode / Gate Pass ──────────────────────────────────────────────────────
function extractBarcode(text: string): ExtractedField[] {
  return [
    {
      key: 'container_no', label: 'Container No.',
      value: find(text, /Container\s*No\s*:\s*([A-Z]{4}\d{7})/i) || find(text, /\b([A-Z]{4}\d{7})\b/),
      region: { x: 17, y: 11, w: 28, h: 5 }
    },
    {
      key: 'vessel_name', label: 'Vessel Name',
      value: find(text, /Vessel\s*Name\s*:\s*([^\n\r]+)/i),
      region: { x: 17, y: 19, w: 28, h: 5 }
    },
    {
      key: 'vessel_voyage', label: 'Vessel Voyage',
      value: find(text, /Vessel\s*Voyage\s*:\s*([^\n\r]+)/i),
      region: { x: 17, y: 27, w: 28, h: 5 }
    },
    {
      key: 'vessel_ref', label: 'Vessel Ref',
      value: find(text, /Vessel\s*Ref\s*:\s*([^\n\r]+)/i),
      region: { x: 17, y: 35, w: 28, h: 5 }
    },
    {
      key: 'iso_code', label: 'ISO Code',
      value: find(text, /ISO\s*Code\s*:\s*(\d+)/i),
      region: { x: 47, y: 11, w: 20, h: 5 }
    },
    {
      key: 'line_operator', label: 'Line Operator',
      value: find(text, /Line\s*Operator\s*:\s*(\w+)/i),
      region: { x: 73, y: 11, w: 20, h: 5 }
    },
    {
      key: 'driver_id', label: 'Driver ID',
      value: find(text, /Driver\s*ID\s*:\s*([A-Z0-9]+)/i),
      region: { x: 17, y: 47, w: 28, h: 5 }
    },
    {
      key: 'agent_pass_no', label: 'Agent Pass No.',
      value: find(text, /Agent\s*Pass\s*No\s*:\s*(\d+)/i),
      region: { x: 55, y: 47, w: 28, h: 5 }
    },
    {
      key: 'truck_no', label: 'Truck No.',
      value: find(text, /Truck\s*No\s*:\s*([A-Z0-9-]+)/i),
      region: { x: 17, y: 55, w: 28, h: 5 }
    },
    {
      key: 'seal_number', label: 'Seal Number',
      value: find(text, /Seal\s*Number\s*:\s*(\d+)/i),
      region: { x: 55, y: 55, w: 28, h: 5 }
    },
    {
      key: 'trailer_no', label: 'Trailer No.',
      value: find(text, /Trailor?\s*No\s*:\s*([A-Z0-9-]+)/i),
      region: { x: 17, y: 63, w: 28, h: 5 }
    },
  ]
}

// ─── Boat Note ────────────────────────────────────────────────────────────────
function extractBoatNote(text: string): ExtractedField[] {
  const ls = text.split('\n').map(l => l.trim()).filter(Boolean)

  // Voyage No / Date — find "4. Voyage No./Date 8228" style
  let voyageNo = ''
  for (let k = 0; k < ls.length; k++) {
    const m = ls[k].match(/(?:Voyage|Voy)[^\d]*(\d{5}[A-Z])\s+(\d{2}\.\d{2}\.\d{4})/i)
    if (m) { voyageNo = `${m[1]} ${m[2]}`; break }
    if (/4[.\s]+Voyage/i.test(ls[k]) && k + 1 < ls.length) {
      voyageNo = ls[k + 1].trim()
      break
    }
  }

  // Vessel — from "6. Vessel" section
  let vessel = ''
  const vIdx = ls.findIndex(l => /6[.\s]+Vessel\s+8122/i.test(l) || /^6[.\s]+Vessel\b/i.test(l))
  if (vIdx >= 0 && vIdx + 1 < ls.length) vessel = ls[vIdx + 1].trim()

  return [
    {
      key: 'shipper', label: 'Shipper (Name & Address)',
      value: afterLine(text, /1[.\s]+Shipper.*3336/i, 3) ||
        afterLine(text, /Shipper.*Address/i, 2),
      region: { x: 5, y: 4, w: 44, h: 12 }
    },
    {
      key: 'consignee', label: 'Consignee (Name & Address)',
      value: afterLine(text, /2[.\s]+Consignee.*3132/i, 2) ||
        afterLine(text, /Consignee.*Address/i, 2),
      region: { x: 5, y: 19, w: 44, h: 9 }
    },
    {
      key: 'entry_no', label: 'Custom Entry No.',
      value: find(text, /E\s+(\d{5,})/),
      region: { x: 55, y: 4, w: 38, h: 6 }
    },
    {
      key: 'bl_no', label: 'SN/B/L No.',
      value: find(text, /(?:CMBG|MAEU|MSCU|MEDU|STASL)[A-Z0-9]+/, /10[.\s]+SN[\s\S]*?(\w{8,})/i),
      region: { x: 55, y: 10, w: 38, h: 6 }
    },
    {
      key: 'slpa_no', label: 'SLPA No.',
      value: find(text, /12[.\s]+SLPA[^\n]*\n([^\n]+)/i) || afterLine(text, /12[.\s]+SLPA/i, 1),
      region: { x: 55, y: 17, w: 38, h: 5 }
    },
    {
      key: 'voyage_no', label: 'Voyage No./Date',
      value: voyageNo,
      region: { x: 5, y: 40, w: 40, h: 5 }
    },
    {
      key: 'vessel', label: 'Vessel',
      value: vessel || find(text, /ZHONG PENG YOU YI/i),
      region: { x: 5, y: 47, w: 40, h: 5 }
    },
    {
      key: 'port_loading', label: 'Port of Loading',
      value: afterLine(text, /7[.\s]+Port\s+of\s+Loading/i, 1) || 'COLOMBO',
      region: { x: 5, y: 54, w: 40, h: 5 }
    },
    {
      key: 'port_discharge', label: 'Port of Discharge',
      value: afterLine(text, /8[.\s]+Port\s+of\s+Discharge/i, 1) ||
        find(text, /TUTICORIN/i),
      region: { x: 5, y: 60, w: 40, h: 5 }
    },
    {
      key: 'container_no', label: 'Container No.',
      value: find(text, /\b([A-Z]{4}\d{7})\b/),
      region: { x: 5, y: 62, w: 35, h: 12 }
    },
    {
      key: 'gross_weight', label: 'Gross Weight (Kg)',
      value: find(text, /(?:19\s*a\s*Gross|Gross\s*W[^\n]*)[^\d]*([\d,]+\.00)/i, /([\d,]+\.00)\s*KGS/i),
      region: { x: 62, y: 62, w: 25, h: 8 }
    },
    {
      key: 'goods', label: 'Description of Goods',
      value: find(text, /(WASTE PAPER)/i) || afterLine(text, /17[.\s]+Description/i, 1),
      region: { x: 43, y: 62, w: 18, h: 8 }
    },
    {
      key: 'packages', label: 'Packages (BL)',
      value: find(text, /19\.?\(?e\)?\s+Shipped[\s\S]{1,20}?([\d.]+)\s+BL/i, /([\d.]+)\s+BL\b/i),
      region: { x: 55, y: 77, w: 12, h: 5 }
    },
    {
      key: 'shipping_agent', label: 'Shipping Agent',
      value: afterLine(text, /23[.\s]+Shipping\s+Agent/i, 1),
      region: { x: 35, y: 82, w: 28, h: 5 }
    },
  ]
}

// ─── Handler ──────────────────────────────────────────────────────────────────
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  try {
    const { base64 } = req.body
    if (!base64) return res.status(400).json({ error: 'No file data' })

    const buffer = Buffer.from(base64, 'base64')
    const text = await extractText(buffer)
    const wordCount = text.trim().split(/\s+/).filter(w => w.length > 2).length

    if (wordCount < 20) {
      return res.json({
        docType: 'unknown', fields: [], rawText: text, scanned: true,
        warning: 'Scanned image PDF — text extraction not possible.',
      })
    }

    const docType = detectType(text)
    let fields: ExtractedField[] = []

    if (docType === 'cusdec')     fields = extractCusdec(text)
    else if (docType === 'cdn')   fields = extractCdn(text)
    else if (docType === 'barcode')  fields = extractBarcode(text)
    else if (docType === 'boatnote') fields = extractBoatNote(text)

    // Filter empty values but keep structure
    const filled = fields.filter(f => f.value).length
    console.log(`[smart-detect] type=${docType} filled=${filled}/${fields.length} words=${wordCount}`)

    res.json({ docType, fields, rawText: text.slice(0, 3000), scanned: false })
  } catch (err: any) {
    console.error('[smart-detect] error:', err)
    res.status(500).json({ error: err.message })
  }
}
