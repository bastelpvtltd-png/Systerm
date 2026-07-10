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
  cellRef?: string   // e.g. "B5" — used when isArray is false
  cellRange?: string // e.g. "A10:A20" — used when isArray is true
}

function parseRange(range: string): { col: string; startRow: number; endRow: number } {
  const m = range.replace(/\s/g, '').match(/^([A-Za-z]+)(\d+):[A-Za-z]+(\d+)$/)
  if (!m) throw new Error(`Invalid cell range "${range}" — expected something like A10:A20`)
  return { col: m[1], startRow: Number(m[2]), endRow: Number(m[3]) }
}

export async function fillExcelTemplate(
  templateBuffer: Buffer,
  mapping: TemplateMappingEntry[],
  cusdecRow: Record<string, any> | null,
  cdnRows: Record<string, any>[],
  manualValues: Record<string, string>
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(templateBuffer as any)
  const sheet = workbook.worksheets[0]
  if (!sheet) throw new Error('Template has no worksheet')

  for (const field of mapping) {
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
    sheet.getCell(field.cellRef).value = value
  }

  const out = await workbook.xlsx.writeBuffer()
  return Buffer.from(out)
}
