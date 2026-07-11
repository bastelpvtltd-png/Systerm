import type ExcelJS from 'exceljs'
import { jsPDF } from 'jspdf'

// Best-effort "print the filled sheet" PDF export — not a pixel-perfect
// render of the original .xlsx (no borders/merges/exact fonts), but every
// cell's text lands in the right row/column position so the output is
// readable and usable when someone just needs a PDF copy of what was filled
// in. Column widths use ExcelJS's own unit (~character count) scaled to mm;
// row heights use points converted to mm. One sheet per PDF page, landscape
// since spreadsheets are usually wider than they are tall.
export function workbookSheetToPdf(sheet: ExcelJS.Worksheet, fileTitle: string): Buffer {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const margin = 8

  const colCount = sheet.columnCount || 1
  const colWidthsChars: number[] = []
  for (let c = 1; c <= colCount; c++) {
    colWidthsChars.push(sheet.getColumn(c).width || 10)
  }
  const totalChars = colWidthsChars.reduce((a, b) => a + b, 0) || colCount * 10
  const usableWidth = pageWidth - margin * 2
  const colWidthsMm = colWidthsChars.map(w => (w / totalChars) * usableWidth)
  const colX: number[] = [margin]
  for (const w of colWidthsMm) colX.push(colX[colX.length - 1] + w)

  doc.setFont('helvetica', 'normal').setFontSize(7)
  let y = margin

  sheet.eachRow({ includeEmpty: true }, (row) => {
    const rowHeightMm = ((row.height || 15) * 0.3528) // points -> mm
    if (y + rowHeightMm > pageHeight - margin) {
      doc.addPage()
      y = margin
    }
    for (let c = 1; c <= colCount; c++) {
      const cell = row.getCell(c)
      const raw = cell.value
      if (raw == null || raw === '') continue
      const text = typeof raw === 'object' && raw && 'result' in (raw as any)
        ? String((raw as any).result ?? '')
        : String(raw)
      if (!text) continue
      const x = colX[c - 1] + 1
      const maxW = (colX[c] - colX[c - 1]) - 2
      if (cell.font?.bold) doc.setFont('helvetica', 'bold')
      const lines = doc.splitTextToSize(text, Math.max(maxW, 5))
      doc.text(lines, x, y + 3)
      if (cell.font?.bold) doc.setFont('helvetica', 'normal')
    }
    y += Math.max(rowHeightMm, 4)
  })

  return Buffer.from(doc.output('arraybuffer'))
}
