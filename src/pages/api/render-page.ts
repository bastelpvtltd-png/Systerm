import type { NextApiRequest, NextApiResponse } from 'next'

export const config = { api: { bodyParser: { sizeLimit: '20mb' } } }

// Renders page 1 of a PDF to a PNG (base64) so the browser can show the
// document as an image — used by the Documents popup's "correction box" view.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  try {
    const { base64 } = req.body
    if (!base64) return res.status(400).json({ error: 'base64 required' })

    const mupdf = await import('mupdf')
    const buffer = Buffer.from(base64, 'base64')
    const doc = mupdf.Document.openDocument(buffer, 'application/pdf')
    const page = doc.loadPage(0)
    const matrix = mupdf.Matrix.scale(2, 2)
    const pixmap = page.toPixmap(matrix, mupdf.ColorSpace.DeviceRGB, false, true)
    const png = Buffer.from(pixmap.asPNG())

    res.json({ png: png.toString('base64'), width: pixmap.getWidth(), height: pixmap.getHeight() })
  } catch (err: any) {
    console.error('[render-page] error:', err)
    res.status(500).json({ error: err.message })
  }
}
