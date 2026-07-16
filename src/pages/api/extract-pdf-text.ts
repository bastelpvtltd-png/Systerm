import type { NextApiRequest, NextApiResponse } from 'next'
import { openPdf } from '@/lib/mupdfDoc'

export const config = { api: { bodyParser: { sizeLimit: '20mb' } } }

// Extracts text spans from each page of a PDF using mupdf structured text.
// Returns items with positions in PDF-point coordinates (y from top, mupdf convention).
// Client converts to screen fractions using the rendered image dimensions.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  try {
    const { base64, page } = req.body
    if (!base64) return res.status(400).json({ error: 'base64 required' })

    const buffer = Buffer.from(base64, 'base64')
    const { doc } = await openPdf(buffer)
    const numPages = doc.countPages()
    const pageIndex = Math.min(Math.max(Number(page) || 0, 0), numPages - 1)

    const pdfPage = doc.loadPage(pageIndex)
    const bounds = pdfPage.getBounds()  // [x0, y0, x1, y1]
    const pageW = bounds[2] - bounds[0]
    const pageH = bounds[3] - bounds[1]

    const sText = pdfPage.toStructuredText('preserve-whitespace,preserve-spans')
    const raw = JSON.parse(sText.asJSON())

    const items: { id: string; text: string; x: number; y: number; w: number; h: number; fontSize: number }[] = []

    for (const block of raw.blocks ?? []) {
      if (block.type !== 'text') continue
      for (const line of block.lines ?? []) {
        for (const span of line.spans ?? []) {
          const t = (span.text ?? '').trim()
          if (!t) continue
          const [x0, y0, x1, y1] = span.bbox ?? [0, 0, 0, 0]
          items.push({
            id: `${pageIndex}_${x0}_${y0}_${Math.random().toString(36).slice(2)}`,
            text: span.text ?? '',
            x: x0,
            y: y0,
            w: Math.max(x1 - x0, 1),
            h: Math.max(y1 - y0, 1),
            fontSize: span.size ?? 12,
          })
        }
      }
    }

    res.json({ items, pageW, pageH })
  } catch (err: any) {
    console.error('[extract-pdf-text] error:', err)
    res.status(500).json({ error: err.message })
  }
}
