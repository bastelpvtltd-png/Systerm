import type { NextApiRequest, NextApiResponse } from 'next'
import { requireAuth } from '@/lib/serverAuth'
import { downloadDriveFile } from '@/lib/driveDownload'

// Re-fetches a saved Drive file's text content for the Generation History
// panel's Copy button (XML/Text templates only) — the text itself isn't
// stored anywhere after generation, only the Drive link, so Copy on a past
// entry needs to pull it back from Drive on demand.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end()
  const authed = await requireAuth(req)
  if (!authed.ok) return res.status(authed.status).json({ error: authed.error })
  try {
    const driveUrl = String(req.query.drive_url || '')
    if (!driveUrl) return res.status(400).json({ error: 'drive_url required' })
    const bytes = await downloadDriveFile(driveUrl)
    res.json({ content: bytes.toString('utf-8') })
  } catch (e: any) {
    console.error('[fetch-drive-text]', e)
    res.status(500).json({ error: e.message })
  }
}
