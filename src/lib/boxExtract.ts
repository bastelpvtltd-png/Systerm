// Crops one arbitrary rectangle (given as % of the page) out of a PDF page and
// OCRs just that region. Used for user-drawn correction boxes in the Documents
// popup — unlike gridExtract.ts's uniform row/col grid, a box here can be any
// size/position, which is what irregular forms like CUSDEC/CDN actually need.

import { createWorker } from 'tesseract.js'
import os from 'os'

const CACHE_PATH = os.tmpdir()
const RENDER_SCALE = 3

export interface PctBox { x: number; y: number; w: number; h: number; page?: number } // x/y/w/h are 0-100, page is 0-indexed

export async function extractBox(buffer: Buffer, box: PctBox): Promise<string> {
  const worker = await createWorker('eng', 1, { cachePath: CACHE_PATH })
  try {
    return await extractBoxWithWorker(buffer, box, worker)
  } finally {
    await worker.terminate()
  }
}

// Extracts many boxes out of one PDF using a single shared tesseract worker and
// caching each page's rendered pixmap — spinning up a fresh worker (loads WASM +
// language data) and re-rendering the same page per field is what made a form
// with 15-20 boxed fields take many seconds; this does it all in one pass.
export async function extractBoxes(buffer: Buffer, boxes: Record<string, PctBox>): Promise<Record<string, string>> {
  const mupdf = await import('mupdf')
  const doc = mupdf.Document.openDocument(buffer, 'application/pdf')
  const matrix = mupdf.Matrix.scale(RENDER_SCALE, RENDER_SCALE)
  const pixmapCache = new Map<number, any>()
  const worker = await createWorker('eng', 1, { cachePath: CACHE_PATH })
  try {
    const result: Record<string, string> = {}
    for (const [key, box] of Object.entries(boxes)) {
      const pageIndex = Math.min(Math.max(box.page || 0, 0), doc.countPages() - 1)
      let pagePixmap = pixmapCache.get(pageIndex)
      if (!pagePixmap) {
        const page = doc.loadPage(pageIndex)
        pagePixmap = page.toPixmap(matrix, mupdf.ColorSpace.DeviceRGB, false, true)
        pixmapCache.set(pageIndex, pagePixmap)
      }
      result[key] = await recognizeBox(pagePixmap, box, worker)
    }
    return result
  } finally {
    await worker.terminate()
  }
}

async function extractBoxWithWorker(buffer: Buffer, box: PctBox, worker: any): Promise<string> {
  const mupdf = await import('mupdf')
  const doc = mupdf.Document.openDocument(buffer, 'application/pdf')
  const pageIndex = Math.min(Math.max(box.page || 0, 0), doc.countPages() - 1)
  const page = doc.loadPage(pageIndex)
  const matrix = mupdf.Matrix.scale(RENDER_SCALE, RENDER_SCALE)
  const pagePixmap = page.toPixmap(matrix, mupdf.ColorSpace.DeviceRGB, false, true)
  return recognizeBox(pagePixmap, box, worker)
}

async function recognizeBox(pagePixmap: any, box: PctBox, worker: any): Promise<string> {
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

  const { data } = await worker.recognize(png)
  return cleanOcrText(data.text)
}

// Tidies up whitespace within each line (OCR often inserts extra spaces/tabs)
// without collapsing the line breaks themselves — a box spanning an address
// or multi-line field should keep the same line layout as the original text.
function cleanOcrText(text: string): string {
  return text
    .split('\n')
    .map(line => line.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
}
