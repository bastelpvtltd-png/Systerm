import type ExcelJS from 'exceljs'
import { jsPDF } from 'jspdf'

// Parse "A1:F50" into { minCol, minRow, maxCol, maxRow } (1-based).
// Returns null if the range string is empty/invalid — caller treats null as "full sheet".
function parseRange(range: string | null | undefined): { minCol: number; minRow: number; maxCol: number; maxRow: number } | null {
  if (!range) return null
  const m = range.trim().toUpperCase().match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/)
  if (!m) return null
  function colNum(letters: string): number {
    let n = 0
    for (const ch of letters) n = n * 26 + ch.charCodeAt(0) - 64
    return n
  }
  return { minCol: colNum(m[1]), minRow: parseInt(m[2]), maxCol: colNum(m[3]), maxRow: parseInt(m[4]) }
}

// Best-effort "print the filled sheet" PDF export — not a pixel-perfect
// render of the original .xlsx (no borders/merges/exact fonts), but every
// cell's text lands in the right row/column position so the output is
// readable and usable when someone just needs a PDF copy of what was filled
// in. Column widths use ExcelJS's own unit (~character count) scaled to mm;
// row heights use points converted to mm. One sheet per PDF page, landscape
// since spreadsheets are usually wider than they are tall.
// If printRange is given (e.g. "A1:F50"), only cells within that range are rendered.
export function workbookSheetToPdf(sheet: ExcelJS.Worksheet, fileTitle: string, printRange?: string | null): Buffer {
  const range = parseRange(printRange)
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const margin = 8

  const minCol = range?.minCol ?? 1
  const maxCol = range?.maxCol ?? (sheet.columnCount || 1)
  const minRow = range?.minRow ?? 1
  const maxRow = range?.maxRow ?? undefined // undefined = no upper limit

  const colCount = maxCol - minCol + 1
  const colWidthsChars: number[] = []
  for (let c = minCol; c <= maxCol; c++) {
    colWidthsChars.push(sheet.getColumn(c).width || 10)
  }
  const totalChars = colWidthsChars.reduce((a, b) => a + b, 0) || colCount * 10
  const usableWidth = pageWidth - margin * 2
  const colWidthsMm = colWidthsChars.map(w => (w / totalChars) * usableWidth)
  const colX: number[] = [margin]
  for (const w of colWidthsMm) colX.push(colX[colX.length - 1] + w)

  doc.setFont('helvetica', 'normal').setFontSize(7)
  let y = margin

  sheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    if (rowNumber < minRow) return
    if (maxRow !== undefined && rowNumber > maxRow) return
    const rowHeightMm = ((row.height || 15) * 0.3528) // points -> mm
    if (y + rowHeightMm > pageHeight - margin) {
      doc.addPage()
      y = margin
    }
    for (let c = minCol; c <= maxCol; c++) {
      const cell = row.getCell(c)
      const raw = cell.value
      if (raw == null || raw === '') continue
      const text = typeof raw === 'object' && raw && 'result' in (raw as any)
        ? String((raw as any).result ?? '')
        : String(raw)
      if (!text) continue
      const colIdx = c - minCol
      const x = colX[colIdx] + 1
      const maxW = (colX[colIdx + 1] - colX[colIdx]) - 2
      if (cell.font?.bold) doc.setFont('helvetica', 'bold')
      const lines = doc.splitTextToSize(text, Math.max(maxW, 5))
      doc.text(lines, x, y + 3)
      if (cell.font?.bold) doc.setFont('helvetica', 'normal')
    }
    y += Math.max(rowHeightMm, 4)
  })

  return Buffer.from(doc.output('arraybuffer'))
}
