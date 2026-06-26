export type PdfField = { grid: string; label: string; value: string }

// ── helpers ──────────────────────────────────────────────────────────────────

function lines(text: string) {
  return text.split('\n').map(l => l.trim()).filter(Boolean)
}

// Grab non-empty lines after the first line matching pat
function after(ls: string[], pat: RegExp, max = 5): string {
  const i = ls.findIndex(l => pat.test(l))
  if (i < 0) return ''
  const out: string[] = []
  for (let j = i + 1; j < Math.min(i + 1 + max, ls.length); j++) {
    const l = ls[j]
    if (!l) continue
    if (/^\d{1,2}\s+[A-Z]/.test(l) && l.length < 80) break   // next field header
    out.push(l)
  }
  return out.join(' ').trim()
}

// First regex match, return capture group 1 or full match
function find(text: string, ...pats: RegExp[]): string {
  for (const p of pats) {
    const m = text.match(p)
    if (m) return (m[1] || m[0]).trim()
  }
  return ''
}

// Value between two label positions
function between(text: string, start: RegExp, end: RegExp): string {
  const sm = text.match(start)
  if (!sm) return ''
  const tail = text.slice(sm.index! + sm[0].length)
  const em = tail.search(end)
  const chunk = em > 0 ? tail.slice(0, em) : tail.slice(0, 300)
  return chunk.trim().split('\n').map(l => l.trim()).filter(Boolean).slice(0, 4).join(' ')
}

// ── CUSDEC extraction (Sri Lanka Asycuda) ────────────────────────────────────
// Boxes are numbered; PDF text may be "2 Exporter" or "2. Exporter" etc.

export function extractCusdec(text: string): PdfField[] {
  const ls = lines(text)

  const box = (num: string | number, ...extras: string[]) =>
    new RegExp(`^${num}[.\\s]+(?:${extras.join('|')})`, 'i')

  return [
    {
      grid: 'NUM', label: 'Entry Number',
      value: find(text,
        /Entry\s*No[.:\s]+([A-Z0-9]+)/i,
        /(?:CUSDEC|Entry)\s*[:\s]+([A-Z]?\s*\d{5,})/i,
        /\bE\s+(\d{5,})\b/,
        /\b(\d{5,})\b/
      )
    },
    {
      grid: '2', label: 'Exporter',
      value: after(ls, box(2, 'Exporter')) ||
        between(text, /2[.\s]+Exporter/i, /8[.\s]+Consignee/i) ||
        find(text, /Exporter[:\s]+([^\n]+)/i)
    },
    {
      grid: '8', label: 'Consignee',
      value: after(ls, box(8, 'Consignee')) ||
        between(text, /8[.\s]+Consignee/i, /14[.\s]+Declar/i) ||
        find(text, /Consignee[:\s]+([^\n]+)/i)
    },
    {
      grid: '14', label: 'Declarant/Representative',
      value: after(ls, box(14, 'Declarant', 'Representative')) ||
        find(text, /Declarant[:\s]+([^\n]+)/i)
    },
    {
      grid: '15', label: 'Country of Export',
      value: after(ls, box(15, 'Country of Export')) ||
        find(text, /Country\s+of\s+Export[:\s]+([A-Z]{2,30})/i)
    },
    {
      grid: '17', label: 'Country of Destination',
      value: after(ls, box(17, 'Country of Dest')) ||
        find(text, /Country\s+of\s+Dest[a-z]*[:\s]+([A-Z]{2,30})/i)
    },
    {
      grid: '18', label: 'Vessel',
      value: after(ls, box(18, 'Vessel', 'Flight')) ||
        find(text, /Vessel[:\s]+([A-Z][\w\s]{3,30})/i)
    },
    {
      grid: '21', label: 'Voyage No./Date',
      value: after(ls, box(21, 'Voyage')) ||
        find(text, /Voyage\s*No[.:\s]+([A-Z0-9]+)/i)
    },
    {
      grid: '22', label: 'Currency & Amount',
      value: find(text,
        /(?:USD|EUR|GBP)\s+([\d,]+\.?\d*)/,
        /22[.\s]+Currency[^U\n]*(USD|EUR|GBP)[\s]+([\d,]+)/i
      ) || after(ls, box(22, 'Currency'))
    },
    {
      grid: '23', label: 'Exchange Rate',
      value: find(text, /Exchange\s*Rate[:\s]+([\d,.]+)/i, /(\d{2,3}[.,]\d{4})/) ||
        after(ls, box(23, 'Exchange'))
    },
    {
      grid: '27', label: 'Port of Loading/Discharge',
      value: after(ls, box(27, 'Place of Loading', 'Port')) ||
        find(text, /(?:Loading|Discharge)\s+Port[:\s]+([A-Z]{3,20})/i, /COLOMBO/i)
    },
    {
      grid: '29', label: 'Office of Entry/Exit',
      value: after(ls, box(29, 'Office'))
    },
    {
      grid: '30', label: 'Location of Goods',
      value: after(ls, box(30, 'Location')) ||
        find(text, /Location\s+of\s+Goods[:\s]+([^\n]+)/i)
    },
    {
      grid: '33', label: 'Commodity (HS) Code',
      value: find(text,
        /HS\s*Code[:\s]+(\d{6,})/i,
        /(?:^|\s)(\d{8})(?:\s|$)/m,
        /Commodity[:\s]+(\d+)/i
      )
    },
    {
      grid: '35', label: 'Gross Mass (Kg)',
      value: find(text,
        /Gross\s*(?:Mass|Weight)[:\s]+([\d,]+\.?\d*)/i,
        /([\d,]+\.00)\s*(?:KGS?|KG)\b/i
      ) || after(ls, box(35, 'Gross'))
    },
    {
      grid: '38', label: 'Net Mass (Kg)',
      value: find(text, /Net\s*(?:Mass|Weight)[:\s]+([\d,]+\.?\d*)/i) ||
        after(ls, box(38, 'Net'))
    },
    {
      grid: '40', label: 'B/L No.',
      value: find(text,
        /B\/L\s*No[.:\s]+([A-Z0-9\/]+)/i,
        /SL\/MB\/([\d]+)/,
        /(?:MAEU|MEDU|MSCU|HLCU|COSU)[A-Z0-9]{6,}/,
        /(?:STASL|CMDU|TCNU)\d{7,}/
      ) || after(ls, box(40, 'Previous', 'B\/L'))
    },
    {
      grid: '41', label: 'UOM & Qty',
      value: after(ls, box(41, 'UOM'))
    },
    {
      grid: '44', label: 'Additional Info',
      value: after(ls, box(44, 'Add'))
    },
    {
      grid: 'B1', label: 'Assessment Number',
      value: find(text, /A\s+(\d{5,})/, /Assessment[:\s]+([A-Z0-9]+)/i)
    },
    {
      grid: 'B2', label: 'Receipt Number',
      value: find(text, /R\s+(\d{5,})/, /Receipt[:\s]+([A-Z0-9]+)/i)
    },
    {
      grid: 'B3', label: 'Total Fees (LKR)',
      value: find(text, /(\d+)\s*LKR/, /Total[:\s]+([\d,]+)/i)
    },
  ]
}

// ── CDN extraction ────────────────────────────────────────────────────────────

export function extractCdn(text: string): PdfField[] {
  const ls = lines(text)

  return [
    {
      grid: 'CDN', label: 'CDN No.',
      value: find(text,
        /CDN\s*No[.:\s]+([A-Z0-9\s]+)/i,
        /C\s+(\d{5,})/,
        /\b(C\s*\d{5,})\b/,
        /\d{4}\s+CBEX\d+\s+[A-Z]\s+\d+/
      ) || after(ls, /CDN No/i)
    },
    {
      grid: '1a', label: 'Shipper (Name & Address)',
      value: after(ls, /1[.\s]+Shipper/i, 4) ||
        find(text, /Shipper[:\s]+([^\n]+)/i)
    },
    {
      grid: '1b', label: 'Cusdec Numbers',
      value: after(ls, /1\.?b\s+Cusdec/i, 3) ||
        find(text, /Cusdec\s*No[.:\s]+([^\n]+)/i)
    },
    {
      grid: '2b', label: 'Consignee',
      value: after(ls, /2\.?b\s+Consignee/i, 3) ||
        find(text, /Consignee[:\s]+([^\n]+)/i)
    },
    {
      grid: '3a', label: 'Voyage No./Date',
      value: after(ls, /3\.?a\s+Voyage/i, 2) ||
        find(text, /Voyage[:\s]+([A-Z0-9]+)/i)
    },
    {
      grid: '4', label: 'Vessel',
      value: after(ls, /^4[.\s]+Vessel/i, 2) ||
        find(text, /Vessel[:\s]+([A-Z][\w\s]{3,30})/i)
    },
    {
      grid: '5', label: 'Port of Discharge',
      value: after(ls, /5[.\s]+Port of Discharge/i, 2) ||
        find(text, /Discharge[:\s]+([A-Z]{3,20})/i)
    },
    {
      grid: '6', label: 'Port of Loading',
      value: after(ls, /6[.\s]+Port of Loading/i, 2) || 'COLOMBO'
    },
    {
      grid: '7', label: 'Lorry/Trailer No.',
      value: after(ls, /7[.\s]+Lorry/i, 3)
    },
    {
      grid: '8', label: 'B/L No.',
      value: find(text,
        /(?:STASL|CMDU|TCNU|MAEU|MEDU|MSCU|HLCU)\d{7,}/,
        /B\/L\s*No[.:\s]+([A-Z0-9\/]+)/i
      ) || after(ls, /8[.\s]+SN\//i, 2)
    },
    {
      grid: '9', label: 'Tare Wt. (Kg)',
      value: after(ls, /9[.\s]+Tare/i, 2)
    },
    {
      grid: '10', label: 'SLPA No.',
      value: after(ls, /10[.\s]+SLPA/i, 2) ||
        find(text, /SLPA[:\s]+([A-Z0-9]+)/i)
    },
    {
      grid: '11a', label: 'Seal No.',
      value: after(ls, /11\.?a\s+Seal/i, 2) ||
        find(text, /Seal[:\s]+(\d+)/i)
    },
    {
      grid: '12', label: 'Name of Driver',
      value: after(ls, /12[.\s]+Name of Driver/i, 2) ||
        find(text, /Driver[:\s]+([^\n]+)/i)
    },
    {
      grid: '13', label: 'Location of Goods',
      value: after(ls, /13[.\s]+Location/i, 2) ||
        find(text, /Location[:\s]+([A-Z]{2,10})/i)
    },
    {
      grid: '18', label: 'Container No.',
      value: find(text, /\b([A-Z]{4}\d{7})\b/) ||
        after(ls, /18[.\s]+Marks/i, 3)
    },
    {
      grid: '19', label: 'No. & Kind of Pkgs',
      value: after(ls, /19[.\s]+Number/i, 2)
    },
    {
      grid: '20', label: 'Description of Goods',
      value: after(ls, /20[.\s]+Description/i, 3) ||
        find(text, /WASTE PAPER/i)
    },
    {
      grid: '21', label: 'Gross Weight (Kg)',
      value: find(text,
        /Gross\s*(?:Mass|Weight)[:\s]+([\d,]+\.?\d*)/i,
        /([\d,]+\.\d{2})\s*(?:KGS?|KG)\b/i
      ) || after(ls, /21[.\s]*\(a\)/i, 3)
    },
    {
      grid: '22', label: 'Cube m3',
      value: after(ls, /22[.\s]+Cube/i, 2)
    },
  ]
}

// ── Detect scanned / image PDF ───────────────────────────────────────────────
export function isProbablyScanned(text: string): boolean {
  const words = text.trim().split(/\s+/).filter(w => w.length > 2).length
  return words < 30  // very little extractable text → likely scanned image
}
