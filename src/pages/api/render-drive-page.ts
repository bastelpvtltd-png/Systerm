import type { NextApiRequest, NextApiResponse } from 'next'
import { google } from 'googleapis'
import { openPdf } from '@/lib/mupdfDoc'
import { requireAuth } from '@/lib/serverAuth'

// Same rendering as render-page.ts, but for a document that's already saved
// (only its Drive link is stored in the DB, not the PDF bytes) — downloads
// the file from Drive first, then renders the requested page to a PNG.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  const authed = await requireAuth(req)
  if (!authed.ok) return res.status(authed.status).json({ error: authed.error })
  try {
    const { driveUrl, page } = req.body
    if (!driveUrl) return res.status(400).json({ error: 'driveUrl required' })
    const match = String(driveUrl).match(/\/d\/([a-zA-Z0-9_-]+)/)
    if (!match) return res.status(400).json({ error: 'Could not parse a Drive file id from driveUrl' })
    const fileId = match[1]

    const clientId = process.env.GOOGLE_CLIENT_ID || ''
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET || ''
    const refreshToken = process.env.GOOGLE_REFRESH_TOKEN || ''
    if (!clientId || !clientSecret || !refreshToken) throw new Error('Google OAuth credentials not configured')

    const auth = new google.auth.OAuth2(clientId, clientSecret)
    auth.setCredentials({ refresh_token: refreshToken })
    const drive = google.drive({ version: 'v3', auth })

    const file = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'arraybuffer' })
    const buffer = Buffer.from(file.data as ArrayBuffer)

    const { mupdf, doc } = await openPdf(buffer)
    const numPages = doc.countPages()
    const pageIndex = Math.min(Math.max(Number(page) || 0, 0), numPages - 1)

    const pdfPage = doc.loadPage(pageIndex)
    const matrix = mupdf.Matrix.scale(2, 2)
    const pixmap = pdfPage.toPixmap(matrix, mupdf.ColorSpace.DeviceRGB, false, true)
    const png = Buffer.from(pixmap.asPNG())

    res.json({ png: png.toString('base64'), width: pixmap.getWidth(), height: pixmap.getHeight(), page: pageIndex, numPages })
  } catch (err: any) {
    console.error('[render-drive-page] error:', err)
    res.status(500).json({ error: err.message })
  }
}
