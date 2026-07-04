// Crops one arbitrary rectangle (given as % of the page) out of a PDF page and
// OCRs just that region. Used for user-drawn correction boxes in the Documents
// popup — unlike gridExtract.ts's uniform row/col grid, a box here can be any
// size/position, which is what irregular forms like CUSDEC/CDN actually need.

import { createWorker } from 'tesseract.js'
import os from 'os'

const CACHE_PATH = os.tmpdir()
const RENDER_SCALE = 3

export interface PctBox { x: number; y: number; w: number; h: number } // all 0-100

export async function extractBox(buffer: Buffer, box: PctBox, pageIndex = 0): Promise<string> {
  const mupdf = await import('mupdf')
  const doc = mupdf.Document.openDocument(buffer, 'application/pdf')
  const page = doc.loadPage(pageIndex)
  const matrix = mupdf.Matrix.scale(RENDER_SCALE, RENDER_SCALE)
  const pagePixmap = page.toPixmap(matrix, mupdf.ColorSpace.DeviceRGB, false, true)
  const pageW = pagePixmap.getWidth()
  const pageH = pagePixmap.getHeight()

  const x1 = (box.x / 100) * pageW
  const y1 = (box.y / 100) * pageH
  const x2 = ((box.x + box.w) / 100) * pageW
  const y2 = ((box.y + box.h) / 100) * pageH
  const outW = Math.max(1, Math.round(x2 - x1))
  const outH = Math.max(1, Math.round(y2 - y1))

  const cropped = pagePixmap.warp([[x1, y1], [x2, y1], [x2, y2], [x1, y2]], outW, outH)
  const png = Buffer.from(cropped.asPNG())

  const worker = await createWorker('eng', 1, { cachePath: CACHE_PATH })
  try {
    const { data } = await worker.recognize(png)
    return data.text.replace(/\s+/g, ' ').trim()
  } finally {
    await worker.terminate()
  }
}
