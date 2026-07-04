// Grid-based field extraction: renders a PDF page once, then crops+OCRs only the
// cells the user labelled in the Grid Mapper (src/pages/admin/grid-map.tsx),
// instead of guessing field locations with regex over the whole page's text.

import { createWorker } from 'tesseract.js'
import os from 'os'

const CACHE_PATH = os.tmpdir()
const RENDER_SCALE = 3 // higher res crops -> better OCR accuracy on small boxes

export interface GridConfig { vLines: number[]; hLines: number[] }
export type FieldMap = Record<string, string> // cellNum (as string) -> label

export interface GridField { cellNum: number; label: string; value: string }

function sortedCopy(arr: number[]) { return [...arr].sort((a, b) => a - b) }

interface Cell { num: number; x: number; y: number; w: number; h: number }

// Mirrors buildCells() in grid-map.tsx so saved templates map to the same cell numbers
function buildCells(vLines: number[], hLines: number[]): Cell[] {
  const vSorted = sortedCopy(vLines)
  const hSorted = sortedCopy(hLines)
  const colBounds = [0, ...vSorted, 100]
  const rowBounds = [0, ...hSorted, 100]
  const cells: Cell[] = []
  let num = 1
  for (let r = 0; r < rowBounds.length - 1; r++) {
    for (let c = 0; c < colBounds.length - 1; c++) {
      cells.push({
        num,
        x: colBounds[c], y: rowBounds[r],
        w: colBounds[c + 1] - colBounds[c], h: rowBounds[r + 1] - rowBounds[r],
      })
      num++
    }
  }
  return cells
}

export async function extractByGrid(
  buffer: Buffer,
  gridConfig: GridConfig,
  fieldMap: FieldMap,
  pageIndex = 0
): Promise<GridField[]> {
  const mupdf = await import('mupdf')
  const doc = mupdf.Document.openDocument(buffer, 'application/pdf')
  const page = doc.loadPage(pageIndex)
  const matrix = mupdf.Matrix.scale(RENDER_SCALE, RENDER_SCALE)
  const pagePixmap = page.toPixmap(matrix, mupdf.ColorSpace.DeviceRGB, false, true)
  const pageW = pagePixmap.getWidth()
  const pageH = pagePixmap.getHeight()

  const cells = buildCells(gridConfig.vLines, gridConfig.hLines)
  const labelled = cells.filter(c => (fieldMap[String(c.num)] || '').trim())

  const worker = await createWorker('eng', 1, { cachePath: CACHE_PATH })
  try {
    const results: GridField[] = []
    for (const cell of labelled) {
      const x1 = (cell.x / 100) * pageW
      const y1 = (cell.y / 100) * pageH
      const x2 = ((cell.x + cell.w) / 100) * pageW
      const y2 = ((cell.y + cell.h) / 100) * pageH
      const outW = Math.max(1, Math.round(x2 - x1))
      const outH = Math.max(1, Math.round(y2 - y1))

      const cropped = pagePixmap.warp(
        [[x1, y1], [x2, y1], [x2, y2], [x1, y2]],
        outW, outH
      )
      const png = Buffer.from(cropped.asPNG())

      const { data } = await worker.recognize(png)
      results.push({
        cellNum: cell.num,
        label: fieldMap[String(cell.num)],
        value: data.text.replace(/\s+/g, ' ').trim(),
      })
    }
    return results
  } finally {
    await worker.terminate()
  }
}
