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
