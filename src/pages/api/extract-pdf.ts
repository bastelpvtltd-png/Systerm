import type { NextApiRequest, NextApiResponse } from 'next'

export const config = { api: { bodyParser: { sizeLimit: '20mb' } } }

async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  try {
    // Try pdfjs-dist first (better extraction, same engine as Python pdfplumber)
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.js')
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise
    let fullText = ''
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i)
      const content = await page.getTextContent()
      const pageText = content.items.map((item: any) => item.str).join(' ')
      fullText += pageText + '\n'
    }
    return fullText
  } catch (e) {
    // Fallback to pdf-parse
    const pdfParse = require('pdf-parse')
    const parsed = await pdfParse(buffer)
    return parsed.text
  }
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
    pkg_no: '', pkg_type: '', cdn_no: '', volume: '', marks: '',
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
    number: '', date: '', exporter: '', consignee: '', total_packages: '',
    country_of_export: '', vessel: '', voyage_no: '', discharging: '',
    location_of_goods: '', amount: '', hs_code: '', gross_mass: '', net_mass: '', bl_no: '',
  }

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

function toFieldArray(data: Record<string, string>, docType: string) {
  return Object.entries(data).map(([key, value]) => ({ key, label: key.replace(/_/g, ' ').toUpperCase(), value }))
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  try {
    const { base64, docType } = req.body
    if (!base64) return res.status(400).json({ error: 'No file data' })

    const buffer = Buffer.from(base64, 'base64')
    const text = await extractTextFromPdf(buffer)

    console.log(`[extract-pdf] docType=${docType} textLen=${text.length} preview="${text.slice(0,100).replace(/\n/g,' ')}"`)

    if (isProbablyScanned(text)) {
      return res.json({
        fields: [],
        rawText: text,
        scanned: true,
        warning: 'This PDF appears to be a scanned image. Text extraction is not possible. Please use Excel import or manual entry.',
      })
    }

    let fields: any[] = []
    if (docType === 'cusdec') {
      const data = extractCusdecFields(text)
      fields = toFieldArray(data, docType)
    } else if (docType === 'cdn') {
      const data = extractCdnFields(text)
      fields = toFieldArray(data, docType)
    }

    const filled = fields.filter((f: any) => f.value).length
    console.log(`[extract-pdf] filled ${filled}/${fields.length} fields`)
    res.json({ fields, rawText: text, scanned: false })
  } catch (err: any) {
    console.error('[extract-pdf] error:', err)
    res.status(500).json({ error: err.message })
  }
}
