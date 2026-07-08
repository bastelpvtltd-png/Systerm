// Shared mupdf.js loader/opener. On a cold serverless invocation, mupdf's WASM
// binding can throw a spurious "invalid pdf structure" error on its very first
// call in a fresh process — even for a perfectly valid PDF — before the WASM
// instance has finished initializing. Retrying once (re-importing the module
// fresh) always succeeds; that retry is what a manual page-refresh-and-reupload
// was actually doing, so do it automatically here instead of surfacing the error.

let cached: Promise<typeof import('mupdf')> | null = null

async function loadMupdf() {
  if (!cached) cached = import('mupdf')
  return cached
}

export async function openPdf(buffer: Buffer) {
  let mupdf = await loadMupdf()
  try {
    return { mupdf, doc: mupdf.Document.openDocument(buffer, 'application/pdf') }
  } catch (err) {
    cached = null
    mupdf = await loadMupdf()
    return { mupdf, doc: mupdf.Document.openDocument(buffer, 'application/pdf') }
  }
}
