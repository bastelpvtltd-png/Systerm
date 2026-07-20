import type { NextApiRequest, NextApiResponse } from 'next'
import { openPdf } from '@/lib/mupdfDoc'
import { requireAuth } from '@/lib/serverAuth'

export const config = { api: { bodyParser: { sizeLimit: '20mb' } } }

// Renders one page of a PDF to a PNG (base64) so the browser can show the
// document as an image — used by the Documents popup's "correction box" view.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  const authed = await requireAuth(req)
  if (!authed.ok) return res.status(authed.status).json({ error: authed.error })
  try {
    const { base64, page } = req.body
    if (!base64) return res.status(400).json({ error: 'base64 required' })

    const buffer = Buffer.from(base64, 'base64')
    const { mupdf, doc } = await openPdf(buffer)
    const numPages = doc.countPages()
    const pageIndex = Math.min(Math.max(Number(page) || 0, 0), numPages - 1)

    const pdfPage = doc.loadPage(pageIndex)
    const matrix = mupdf.Matrix.scale(2, 2)
    const pixmap = pdfPage.toPixmap(matrix, mupdf.ColorSpace.DeviceRGB, false, true)
    const png = Buffer.from(pixmap.asPNG())

    res.json({ png: png.toString('base64'), width: pixmap.getWidth(), height: pixmap.getHeight(), page: pageIndex, numPages })
  } catch (err: any) {
    console.error('[render-page] error:', err)
    res.status(500).json({ error: err.message })
  }
}
