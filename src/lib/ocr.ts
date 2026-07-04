// Free OCR for scanned/vector-only PDFs (no billing, no cloud API):
// mupdf.js (WASM) rasterizes each page to a PNG, then tesseract.js reads the text.
// Used as a fallback only when normal pdf-parse text extraction comes back empty.

import { createWorker } from 'tesseract.js'
import os from 'os'

const MAX_PAGES = 5
// Vercel/serverless functions only allow writes to /tmp — os.tmpdir() resolves to that in production
const CACHE_PATH = os.tmpdir()

export async function ocrPdf(buffer: Buffer): Promise<string> {
  // mupdf ships as an ESM module — must be dynamically imported from this CommonJS-compiled file
  const mupdf = await import('mupdf')
  const doc = mupdf.Document.openDocument(buffer, 'application/pdf')
  const numPages = Math.min(doc.countPages(), MAX_PAGES)
  const matrix = mupdf.Matrix.scale(2, 2)

  const worker = await createWorker('eng', 1, { cachePath: CACHE_PATH })
  try {
    let fullText = ''
    for (let i = 0; i < numPages; i++) {
      const page = doc.loadPage(i)
      const pixmap = page.toPixmap(matrix, mupdf.ColorSpace.DeviceRGB, false, true)
      const png = Buffer.from(pixmap.asPNG())

      const { data } = await worker.recognize(png)
      fullText += data.text + '\n'
    }
    return fullText
  } finally {
    await worker.terminate()
  }
}
