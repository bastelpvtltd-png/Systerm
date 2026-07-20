import type { NextApiRequest, NextApiResponse } from 'next'
import { openPdf } from '@/lib/mupdfDoc'
import { requireAuth } from '@/lib/serverAuth'

export const config = { api: { bodyParser: { sizeLimit: '20mb' } } }

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

    // Get page dimensions using a 1× pixmap (most reliable across mupdf versions)
    const px1 = pdfPage.toPixmap(mupdf.Matrix.scale(1, 1), mupdf.ColorSpace.DeviceRGB, false, false)
    const pageW = px1.getWidth()
    const pageH = px1.getHeight()

    const items: { id: string; text: string; x: number; y: number; w: number; h: number; fontSize: number }[] = []

    try {
      const sText = pdfPage.toStructuredText('preserve-whitespace')
      const raw = JSON.parse(sText.asJSON())

      for (const block of raw.blocks ?? []) {
        if (block.type !== 'text') continue
        for (const line of block.lines ?? []) {
          for (const span of line.spans ?? []) {
            const t = (span.text ?? '').replace(/\s+/g, ' ').trim()
            if (!t) continue
            const [x0, y0, x1, y1] = span.bbox ?? [0, 0, 0, 0]
            const w = Math.max(x1 - x0, 2)
            const h = Math.max(y1 - y0, 2)
            items.push({
              id: `p${pageIndex}_${Math.round(x0)}_${Math.round(y0)}_${Math.random().toString(36).slice(2, 7)}`,
              text: span.text ?? '',
              x: x0,
              y: y0,
              w,
              h,
              fontSize: span.size ?? h,
            })
          }
        }
      }
    } catch (e) {
      console.error('[extract-pdf-text] structured text error:', e)
      // Return empty items — page still renders, just no editable overlays
    }

    res.json({ items, pageW, pageH })
  } catch (err: any) {
    console.error('[extract-pdf-text] error:', err)
    res.status(500).json({ error: err.message })
  }
}
