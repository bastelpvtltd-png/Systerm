export type PdfField = { grid: string; label: string; value: string }

function afterLabel(lines: string[], pat: RegExp, max = 4): string {
  const idx = lines.findIndex(l => pat.test(l))
  if (idx < 0) return ''
  const out: string[] = []
  for (let i = idx + 1; i < Math.min(idx + 1 + max, lines.length); i++) {
    const l = lines[i].trim()
    if (!l) break
    if (/^\d+[.\s(]/.test(l) && l.length < 70) break
    out.push(l)
  }
  return out.join(' ').trim()
}

function find(text: string, pat: RegExp): string {
  const m = text.match(pat)
  return m ? m[0].trim() : ''
}

export function extractCdn(text: string): PdfField[] {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)

  return [
    { grid: '1a', label: 'Shipper (Name & Address)',  value: afterLabel(lines, /1\.a\s+Shipper/i, 4) },
    { grid: '1b', label: 'Cusdec Numbers',             value: afterLabel(lines, /1\.b\s+Cusdec/i, 3) },
    { grid: '2b', label: 'Consignee',                  value: afterLabel(lines, /2\.b\s+Consignee/i, 3) },
    { grid: '3a', label: 'Voyage No./Date',            value: afterLabel(lines, /3\.a\s+Voyage/i, 2) },
    { grid: '4',  label: 'Vessel',                     value: afterLabel(lines, /^4\.\s+Vessel$/i, 2) || find(text, /[A-Z]{4,}\s[A-Z]{4,}\s[A-Z]{2,}/) },
    { grid: '5',  label: 'Port of Discharge',          value: afterLabel(lines, /5\.\s+Port of Discharge/i, 2) },
    { grid: '6',  label: 'Port of Loading',            value: afterLabel(lines, /6\.\s+Port of Loading/i, 2) },
    { grid: '7',  label: 'Lorry/Trailer No.',          value: afterLabel(lines, /7\.\s+Lorry/i, 3) },
    { grid: '8',  label: 'B/L No.',                    value: find(text, /[A-Z]{4}[A-Z]{2}\d{8,}/) || afterLabel(lines, /8\.\s+SN\//i, 2) },
    { grid: '9',  label: 'Tare Wt. (Kg)',              value: afterLabel(lines, /9\.\s+Tare/i, 2) },
    { grid: '10', label: 'SLPA No.',                   value: afterLabel(lines, /10\.\s+SLPA/i, 2) },
    { grid: '11a',label: 'Seal No.',                   value: afterLabel(lines, /11\.a\s+Seal/i, 2) },
    { grid: 'CDN',label: 'CDN No.',                    value: find(text, /\d{4}\s+CBEX\d+\s+[A-Z]\s+\d+/) || afterLabel(lines, /CDN No\.?/i, 2) },
    { grid: '12', label: 'Name of Driver',             value: afterLabel(lines, /12\.\s+Name of Driver/i, 2) },
    { grid: '13', label: 'Location of Goods',          value: afterLabel(lines, /13\.\s+Location/i, 2) },
    { grid: '18', label: 'Container No.',              value: find(text, /[A-Z]{4}\d{7}/) || afterLabel(lines, /18\.\s+Marks/i, 3) },
    { grid: '19', label: 'No. & Kind of Pkgs',         value: afterLabel(lines, /19\.\s+Number/i, 2) },
    { grid: '20', label: 'Description of Goods',       value: afterLabel(lines, /20\.\s+Description/i, 3) },
    { grid: '21', label: 'Gross Weight (Kg)',           value: find(text, /[\d,]+\.\d{2}(?=\s*\n)/) || afterLabel(lines, /21\.\s*\(a\)/i, 3) },
    { grid: '22', label: 'Cube m3',                    value: afterLabel(lines, /22\.\s+Cube/i, 2) },
  ]
}

export function extractCusdec(text: string): PdfField[] {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)

  return [
    { grid: '2',  label: 'Exporter',                   value: afterLabel(lines, /2\s+Exporter/i, 4) },
    { grid: '8',  label: 'Consignee',                  value: afterLabel(lines, /8\s+Consignee/i, 3) },
    { grid: '14', label: 'Declarant/Representative',   value: afterLabel(lines, /14\s+Declarant/i, 3) },
    { grid: '15', label: 'Country of Export',          value: afterLabel(lines, /15\s+Country of Export/i, 2) },
    { grid: '17', label: 'Country of Destination',     value: afterLabel(lines, /17\s+Country of destination/i, 2) },
    { grid: '18', label: 'Vessel/Flight',              value: afterLabel(lines, /18\s+Vessel/i, 2) },
    { grid: '21', label: 'Voyage No./Date',            value: afterLabel(lines, /21\s+Voyage No/i, 2) },
    { grid: '22', label: 'Currency & Amount Invoiced', value: find(text, /USD\s+[\d,]+\.?\d*/) || afterLabel(lines, /22\s+Currency/i, 2) },
    { grid: '23', label: 'Exchange Rate',              value: find(text, /\d{3}\.\d{4}/) || afterLabel(lines, /23\s+Exchange Rate/i, 2) },
    { grid: '27', label: 'Port of Loading/Discharge',  value: afterLabel(lines, /27\s+Place of Loading/i, 2) },
    { grid: '29', label: 'Office of Entry/Exit',       value: afterLabel(lines, /29\s+Office of Entry/i, 2) },
    { grid: '30', label: 'Location of Goods',          value: afterLabel(lines, /30\s+Location of Goods/i, 2) },
    { grid: '33', label: 'Commodity (HS) Code',        value: find(text, /\d{8}/) || afterLabel(lines, /33\s+Commodity/i, 2) },
    { grid: '35', label: 'Gross Mass (Kg)',             value: find(text, /[\d,]+\.00(?=\s*ISFTA|\s*$)/m) || afterLabel(lines, /35\s+Gross Mass/i, 2) },
    { grid: '38', label: 'Net Mass (Kg)',              value: afterLabel(lines, /38\s+Net Mass/i, 2) },
    { grid: '40', label: 'B/L No.',                    value: find(text, /SL\/MB\/\d+/) || afterLabel(lines, /40\s+Previous/i, 2) },
    { grid: '41', label: 'UOM & Qty',                  value: afterLabel(lines, /41\s+UOM/i, 2) },
    { grid: '44', label: 'D.Qty',                      value: afterLabel(lines, /44\s+Add/i, 2) },
    { grid: 'B',  label: 'Assessment Number',          value: find(text, /A\s+\d{5}/) },
    { grid: 'B',  label: 'Receipt Number',             value: find(text, /R\s+\d{5}/) },
    { grid: 'B',  label: 'Total Fees',                 value: find(text, /\d+LKR/) },
  ]
}
