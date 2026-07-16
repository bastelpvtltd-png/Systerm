import ExcelJS from 'exceljs'

// A mapping entry ties one piece of data to one place in the uploaded Excel
// template. "cusdec"/"manual" fields are single values (one CUSDEC, one
// cell) — "cdn" fields repeat once per container, so they fill down a cell
// range top-to-bottom in the same order the CDN rows were passed in.
export interface TemplateMappingEntry {
  key: string
  label: string
  source: 'cusdec' | 'cdn' | 'manual'
  dbColumn?: string
  isArray: boolean
  cellRef?: string    // e.g. "B5" — used when isArray is false
  cellRange?: string  // e.g. "A10:A20" — used when isArray is true
  sheetName?: string  // which worksheet this field's cell/range lives on — defaults to the first sheet when unset (older templates saved before multi-sheet support)
}

function parseRange(range: string): { col: string; startRow: number; endRow: number } {
  const m = range.replace(/\s/g, '').match(/^([A-Za-z]+)(\d+):[A-Za-z]+(\d+)$/)
  if (!m) throw new Error(`Invalid cell range "${range}" — expected something like A10:A20`)
  return { col: m[1].toUpperCase(), startRow: Number(m[2]), endRow: Number(m[3]) }
}

// Read the effective value of a cell — unwraps formula results so callers
// always get the plain primitive (string/number/boolean/Date/null).
function cellEffectiveValue(cell: ExcelJS.Cell): string | number | boolean | Date | null {
  const v = cell.value
  if (v === null || v === undefined) return null
  if (typeof v === 'object') {
    if ('result' in (v as any)) return (v as any).result ?? null
    if ('text'   in (v as any)) return (v as any).text   ?? null
    if (v instanceof Date)       return v
  }
  return v as string | number | boolean
}

function colLetterToNum(letters: string): number {
  let n = 0
  for (const ch of letters.toUpperCase()) n = n * 26 + ch.charCodeAt(0) - 64
  return n
}

// Evaluate a SUM(range) formula against current cell values in the sheet.
function evalSum(sheet: ExcelJS.Worksheet, rangeStr: string): number {
  const m = rangeStr.trim().toUpperCase().match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/)
  if (!m) return 0
  const r1 = parseInt(m[2]), r2 = parseInt(m[4])
  const c1 = colLetterToNum(m[1]), c2 = colLetterToNum(m[3])
  let sum = 0
  for (let r = r1; r <= r2; r++) {
    for (let c = c1; c <= c2; c++) {
      const v = cellEffectiveValue(sheet.getCell(r, c))
      sum += typeof v === 'number' ? v : parseFloat(String(v ?? 0)) || 0
    }
  }
  return sum
}

// After filling the data sheet, resolve formula cells across the workbook so
// that PDF export (which reads cached values) shows the freshly filled data
// rather than whatever was cached the last time the file was saved in Excel.
// Handles the patterns that appear in the supported templates:
//   'SheetName'!CellRef          — cross-sheet value reference
//   IF('SheetName'!Ref="","",…)  — conditional cross-sheet reference
//   SUM(range)                   — aggregate of a filled range
//   CellRef                      — same-sheet value reference
//   N*CellRef  /  CellRef*N      — scalar multiply
//   TODAY()                      — current date
// Works in three passes so dependencies resolve in order (SUM first, then
// cross-sheet, then intra-sheet arithmetic).
function resolveFormulas(workbook: ExcelJS.Workbook): void {
  // Pass 1 — SUM formulas within each sheet (e.g. TOTAL WEIGHT = SUM(F15:F28))
  workbook.eachSheet(sheet => {
    sheet.eachRow({ includeEmpty: false }, row => {
      row.eachCell({ includeEmpty: false }, cell => {
        if (!cell.formula) return
        const f = cell.formula.trim()
        const m = f.match(/^SUM\(([A-Za-z]+\d+:[A-Za-z]+\d+)\)$/i)
        if (m) cell.value = evalSum(sheet, m[1])
      })
    })
  })

  // Pass 2 — cross-sheet references
  workbook.eachSheet(sheet => {
    sheet.eachRow({ includeEmpty: false }, row => {
      row.eachCell({ includeEmpty: false }, cell => {
        if (!cell.formula) return
        const f = cell.formula.trim()

        // 'SheetName'!CellRef
        const simple = f.match(/^'?([^'!\r\n]+?)'?!([A-Za-z]+\d+)$/i)
        if (simple) {
          const ref = workbook.getWorksheet(simple[1])
          if (ref) cell.value = cellEffectiveValue(ref.getCell(simple[2].toUpperCase()))
          return
        }

        // IF('SheetName'!Ref="","",<same ref>)  — empty-guard pattern
        const ifRef = f.match(/^IF\('?([^'!]+?)'?!([A-Za-z]+\d+)="","","?(?:[^'!]*)'?!([A-Za-z]+\d+)"?\)$/i)
        if (ifRef) {
          const ref = workbook.getWorksheet(ifRef[1])
          if (ref) {
            const v = cellEffectiveValue(ref.getCell(ifRef[2].toUpperCase()))
            cell.value = (v === null || v === undefined || v === '') ? '' : v
          }
          return
        }
      })
    })
  })

  // Pass 3 — intra-sheet references and simple arithmetic
  workbook.eachSheet(sheet => {
    sheet.eachRow({ includeEmpty: false }, row => {
      row.eachCell({ includeEmpty: false }, cell => {
        if (!cell.formula) return
        const f = cell.formula.trim()

        // TODAY()
        if (/^TODAY\(\)$/i.test(f)) { cell.value = new Date(); return }

        // Plain same-sheet cell reference: e.g. C27
        if (/^[A-Za-z]+\d+$/.test(f)) {
          cell.value = cellEffectiveValue(sheet.getCell(f.toUpperCase())); return
        }

        // N*CellRef  or  CellRef*N
        const mult = f.match(/^(\d+(?:\.\d+)?)\*([A-Za-z]+\d+)$|^([A-Za-z]+\d+)\*(\d+(?:\.\d+)?)$/i)
        if (mult) {
          const n   = parseFloat(mult[1] ?? mult[4])
          const ref = (mult[2] ?? mult[3]).toUpperCase()
          const v   = cellEffectiveValue(sheet.getCell(ref))
          cell.value = n * (typeof v === 'number' ? v : parseFloat(String(v ?? 0)) || 0)
          return
        }
      })
    })
  })
}

// Returns the workbook itself (already filled) rather than serialized bytes —
// the PDF export path needs to read the filled cell values/layout back out,
// not just get a file handed to the user.
export async function fillExcelTemplateWorkbook(
  templateBuffer: Buffer,
  mapping: TemplateMappingEntry[],
  cusdecRow: Record<string, any> | null,
  cdnRows: Record<string, any>[],
  manualValues: Record<string, string>
): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(templateBuffer as any)
  const firstSheet = workbook.worksheets[0]
  if (!firstSheet) throw new Error('Template has no worksheet')

  // Each field resolves its own sheet (falls back to the first sheet for
  // templates saved before multi-sheet support existed) — this is what lets
  // fields mapped from different sheets in the same workbook both get filled,
  // no separate "merge" step needed since each field already knows where it lives.
  function sheetFor(field: TemplateMappingEntry) {
    return (field.sheetName && workbook.getWorksheet(field.sheetName)) || firstSheet
  }

  for (const field of mapping) {
    const sheet = sheetFor(field)
    if (field.source === 'cdn' && field.isArray) {
      if (!field.cellRange) continue
      const { col, startRow, endRow } = parseRange(field.cellRange)
      const maxRows = endRow - startRow + 1
      cdnRows.slice(0, maxRows).forEach((row, i) => {
        sheet.getCell(`${col}${startRow + i}`).value = field.dbColumn ? (row[field.dbColumn] ?? '') : ''
      })
      continue
    }

    if (!field.cellRef) continue
    let value = ''
    if (field.source === 'manual') value = manualValues[field.key] ?? ''
    else if (field.source === 'cusdec') value = cusdecRow ? (cusdecRow[field.dbColumn || ''] ?? '') : ''
    else if (field.source === 'cdn') value = cdnRows[0] ? (cdnRows[0][field.dbColumn || ''] ?? '') : ''
    sheet.getCell(field.cellRef.toUpperCase()).value = value
  }

  // Resolve formula cells (SUM aggregates, cross-sheet refs, intra-sheet refs)
  // so PDF export sees the freshly filled values rather than stale cached results.
  resolveFormulas(workbook)

  return workbook
}

export async function fillExcelTemplate(
  templateBuffer: Buffer,
  mapping: TemplateMappingEntry[],
  cusdecRow: Record<string, any> | null,
  cdnRows: Record<string, any>[],
  manualValues: Record<string, string>
): Promise<Buffer> {
  const workbook = await fillExcelTemplateWorkbook(templateBuffer, mapping, cusdecRow, cdnRows, manualValues)
  const out = await workbook.xlsx.writeBuffer()
  return Buffer.from(out)
}
