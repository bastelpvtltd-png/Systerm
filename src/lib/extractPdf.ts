export type PdfField = { grid: string; label: string; value: string }

// Find the first non-empty line after a label pattern
function afterLabel(lines: string[], pat: RegExp, max = 5): string {
  const idx = lines.findIndex(l => pat.test(l))
  if (idx < 0) return ''
  const out: string[] = []
  for (let i = idx + 1; i < Math.min(idx + 1 + max, lines.length); i++) {
    const l = lines[i].trim()
    if (!l) continue
    // Stop at next numbered field header
    if (/^\d{1,2}\s+(Exporter|Consignee|Declarant|Country|Vessel|Voyage|Currency|Exchange|Port|Office|Location|Commodity|Gross|Net|B\/L|UOM|Add)/i.test(l)) break
    if (/^\d{1,2}[.\s)]\s+[A-Z]/.test(l) && l.length < 60) break
    out.push(l)
  }
  return out.join(' ').trim()
}

// Regex match anywhere in full text
function find(text: string, pat: RegExp): string {
  const m = text.match(pat)
  return m ? (m[1] || m[0]).trim() : ''
}

// Try multiple patterns, return first match
function findAny(text: string, ...pats: RegExp[]): string {
  for (const p of pats) {
    const v = find(text, p)
    if (v) return v
  }
  return ''
}

// Get value between two labels
function between(text: string, startPat: RegExp, endPat: RegExp): string {
  const m = text.match(startPat)
  if (!m) return ''
  const after = text.slice(m.index! + m[0].length)
  const end = after.search(endPat)
  const chunk = end > 0 ? after.slice(0, end) : after.slice(0, 200)
  return chunk.trim().split('\n').map(l => l.trim()).filter(Boolean).slice(0, 3).join(' ')
}

export function extractCusdec(text: string): PdfField[] {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)

  // Box 2 — Exporter
  const exporter = afterLabel(lines, /^2[\s.]+Exporter/i)
    || afterLabel(lines, /Exporter/i)
    || between(text, /2[\s.]+Exporter/i, /8[\s.]+Consignee/i)

  // Box 8 — Consignee
  const consignee = afterLabel(lines, /^8[\s.]+Consignee/i)
    || afterLabel(lines, /Consignee/i)
    || between(text, /8[\s.]+Consignee/i, /14[\s.]+Declarant/i)

  // Box 14 — Declarant
  const declarant = afterLabel(lines, /^14[\s.]+Declarant/i)
    || afterLabel(lines, /Declarant/i)

  // Box 15 — Country of Export
  const countryExport = afterLabel(lines, /^15[\s.]+Country of Export/i)
    || findAny(text, /15[\s.]+Country of Export[:\s]+([A-Z ]+)/i, /Export[:\s]+([A-Z]{2,30})/i)

  // Box 17 — Country of Destination
  const countryDest = afterLabel(lines, /^17[\s.]+Country of [Dd]est/i)
    || findAny(text, /17[\s.]+Country[^:]*?[:\s]+([A-Z ]+)/i)

  // Box 18 — Vessel/Flight
  const vessel = afterLabel(lines, /^18[\s.]+Vessel/i)
    || findAny(text, /Vessel[:\s]+([A-Z][\w\s]+)/i, /18[\s.]+([A-Z]{4,}[\w\s]+)/i)

  // Box 21 — Voyage No / Date
  const voyage = afterLabel(lines, /^21[\s.]+Voyage/i)
    || findAny(text, /Voyage[\s#]*No[.:\s]+([A-Z0-9]+)/i, /21[\s.]+([A-Z0-9]+)/i)

  // Box 22 — Currency & Amount
  const currency = findAny(text,
    /USD[\s]+([\d,]+\.?\d*)/,
    /EUR[\s]+([\d,]+\.?\d*)/,
    /LKR[\s]+([\d,]+\.?\d*)/,
    /22[\s.]+Currency[^U]*?(USD|EUR|LKR)[\s]+([\d,]+\.?\d*)/i
  ) || afterLabel(lines, /^22[\s.]+Currency/i)

  // Box 23 — Exchange Rate
  const exchRate = findAny(text,
    /(\d{2,3}[.,]\d{4})/,
    /Exchange Rate[:\s]+([\d.,]+)/i,
    /23[\s.]+([\d.,]+)/
  )

  // Box 27 — Port of Loading/Discharge
  const port = afterLabel(lines, /^27[\s.]+Place of Loading/i)
    || afterLabel(lines, /^27[\s.]+Port/i)
    || findAny(text, /COLOMBO/i)

  // Box 29 — Office of Entry/Exit
  const office = afterLabel(lines, /^29[\s.]+Office/i)
    || findAny(text, /29[\s.]+([A-Z][\w\s]+)/i)

  // Box 30 — Location of Goods
  const location = afterLabel(lines, /^30[\s.]+Location/i)
    || findAny(text, /30[\s.]+([A-Z][\w\s]+)/i)

  // Box 33 — HS Code / Commodity Code
  const hsCode = findAny(text,
    /(\d{8})/,
    /HS[\s]+Code[:\s]+(\d+)/i,
    /Commodity[:\s]+(\d+)/i,
    /33[\s.]+(\d{6,})/
  )

  // Box 35 — Gross Mass
  const grossMass = findAny(text,
    /Gross[\s]+Mass[:\s]+([\d,]+\.?\d*)/i,
    /35[\s.]+([\d,]+\.?\d*)/,
    /([\d,]+\.00)\s*(?:KGS?|KG)/i
  ) || afterLabel(lines, /^35[\s.]+Gross/i)

  // Box 38 — Net Mass
  const netMass = findAny(text,
    /Net[\s]+Mass[:\s]+([\d,]+\.?\d*)/i,
    /38[\s.]+([\d,]+\.?\d*)/
  ) || afterLabel(lines, /^38[\s.]+Net/i)

  // Box 40 — B/L or Previous Doc
  const bl = findAny(text,
    /B\/L\s*No[.:\s]+([A-Z0-9\/]+)/i,
    /SL\/MB\/([\d]+)/,
    /MAEU[\d]+/,
    /MEDU[\d]+/,
    /MSCU[\d]+/,
    /40[\s.]+([A-Z\/\d]+)/
  ) || afterLabel(lines, /^40[\s.]+Previous/i)

  // Box 41 — UOM & Qty
  const uom = afterLabel(lines, /^41[\s.]+UOM/i)
    || findAny(text, /41[\s.]+([\w\s]+)/i)

  // Box 44 — Additional Info / D.Qty
  const addInfo = afterLabel(lines, /^44[\s.]+/i)

  // Assessment / Receipt / Fees from box B
  const assessNo  = findAny(text, /A\s+(\d{5,})/,  /Assessment[:\s]+(\d+)/i)
  const receiptNo = findAny(text, /R\s+(\d{5,})/,  /Receipt[:\s]+(\d+)/i)
  const totalFees = findAny(text, /(\d+)\s*LKR/,   /Total[:\s]+([\d,]+)/i)

  return [
    { grid: '2',   label: 'Exporter',                   value: exporter    },
    { grid: '8',   label: 'Consignee',                  value: consignee   },
    { grid: '14',  label: 'Declarant/Representative',   value: declarant   },
    { grid: '15',  label: 'Country of Export',          value: countryExport },
    { grid: '17',  label: 'Country of Destination',     value: countryDest },
    { grid: '18',  label: 'Vessel/Flight',              value: vessel      },
    { grid: '21',  label: 'Voyage No./Date',            value: voyage      },
    { grid: '22',  label: 'Currency & Amount Invoiced', value: currency    },
    { grid: '23',  label: 'Exchange Rate',              value: exchRate    },
    { grid: '27',  label: 'Port of Loading/Discharge',  value: port        },
    { grid: '29',  label: 'Office of Entry/Exit',       value: office      },
    { grid: '30',  label: 'Location of Goods',          value: location    },
    { grid: '33',  label: 'Commodity (HS) Code',        value: hsCode      },
    { grid: '35',  label: 'Gross Mass (Kg)',             value: grossMass   },
    { grid: '38',  label: 'Net Mass (Kg)',              value: netMass     },
    { grid: '40',  label: 'B/L No.',                    value: bl          },
    { grid: '41',  label: 'UOM & Qty',                  value: uom         },
    { grid: '44',  label: 'Additional Info',            value: addInfo     },
    { grid: 'B1',  label: 'Assessment Number',          value: assessNo    },
    { grid: 'B2',  label: 'Receipt Number',             value: receiptNo   },
    { grid: 'B3',  label: 'Total Fees (LKR)',           value: totalFees   },
  ]
}

export function extractCdn(text: string): PdfField[] {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)

  const shipper    = afterLabel(lines, /1\.a\s+Shipper/i, 4)
  const cusdecNos  = afterLabel(lines, /1\.b\s+Cusdec/i, 3)
  const consignee  = afterLabel(lines, /2\.b\s+Consignee/i, 3)
  const voyage     = afterLabel(lines, /3\.a\s+Voyage/i, 2)
  const vessel     = afterLabel(lines, /^4\.\s+Vessel/i, 2)
    || findAny(text, /Vessel[:\s]+([A-Z][\w\s]+)/i)
  const portDischarge = afterLabel(lines, /5\.\s+Port of Discharge/i, 2)
  const portLoading   = afterLabel(lines, /6\.\s+Port of Loading/i, 2)
  const lorry      = afterLabel(lines, /7\.\s+Lorry/i, 3)
  const bl         = findAny(text, /[A-Z]{4}[A-Z]{2}\d{8,}/, /MAEU\d+/, /MEDU\d+/)
    || afterLabel(lines, /8\.\s+SN\//i, 2)
  const tare       = afterLabel(lines, /9\.\s+Tare/i, 2)
  const slpa       = afterLabel(lines, /10\.\s+SLPA/i, 2)
  const seal       = afterLabel(lines, /11\.a\s+Seal/i, 2)
  const cdnNo      = findAny(text, /\d{4}\s+CBEX\d+\s+[A-Z]\s+\d+/, /CDN No[.:\s]+([A-Z0-9\s]+)/i)
    || afterLabel(lines, /CDN No/i, 2)
  const driver     = afterLabel(lines, /12\.\s+Name of Driver/i, 2)
  const goodsLoc   = afterLabel(lines, /13\.\s+Location/i, 2)
  const container  = findAny(text, /[A-Z]{4}\d{7}/)
    || afterLabel(lines, /18\.\s+Marks/i, 3)
  const pkgs       = afterLabel(lines, /19\.\s+Number/i, 2)
  const desc       = afterLabel(lines, /20\.\s+Description/i, 3)
  const grossWt    = findAny(text, /([\d,]+\.\d{2})\s*(?:KGS?|Kg|KG)/i)
    || afterLabel(lines, /21\.\s*\(a\)/i, 3)
  const cube       = afterLabel(lines, /22\.\s+Cube/i, 2)

  return [
    { grid: '1a',  label: 'Shipper (Name & Address)', value: shipper      },
    { grid: '1b',  label: 'Cusdec Numbers',           value: cusdecNos    },
    { grid: '2b',  label: 'Consignee',                value: consignee    },
    { grid: '3a',  label: 'Voyage No./Date',          value: voyage       },
    { grid: '4',   label: 'Vessel',                   value: vessel       },
    { grid: '5',   label: 'Port of Discharge',        value: portDischarge },
    { grid: '6',   label: 'Port of Loading',          value: portLoading  },
    { grid: '7',   label: 'Lorry/Trailer No.',        value: lorry        },
    { grid: '8',   label: 'B/L No.',                  value: bl           },
    { grid: '9',   label: 'Tare Wt. (Kg)',            value: tare         },
    { grid: '10',  label: 'SLPA No.',                 value: slpa         },
    { grid: '11a', label: 'Seal No.',                 value: seal         },
    { grid: 'CDN', label: 'CDN No.',                  value: cdnNo        },
    { grid: '12',  label: 'Name of Driver',           value: driver       },
    { grid: '13',  label: 'Location of Goods',        value: goodsLoc     },
    { grid: '18',  label: 'Container No.',            value: container    },
    { grid: '19',  label: 'No. & Kind of Pkgs',       value: pkgs         },
    { grid: '20',  label: 'Description of Goods',     value: desc         },
    { grid: '21',  label: 'Gross Weight (Kg)',         value: grossWt      },
    { grid: '22',  label: 'Cube m3',                  value: cube         },
  ]
}
