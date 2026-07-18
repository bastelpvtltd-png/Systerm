import type { NextApiRequest, NextApiResponse } from 'next'
import { requireAuth } from '@/lib/serverAuth'
import { deleteDriveFileByUrl } from '@/lib/driveFolders'

// Generic "delete this one Drive file" for Automation > Merge PDF's
// temporary upload — that file only ever exists to give Mail a URL to
// attach, is never tracked in any table, so there's nothing else to
// unlink/clean up once Mail has sent (or the user cancels out of it).
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  const authed = await requireAuth(req)
  if (!authed.ok) return res.status(authed.status).json({ error: authed.error })
  try {
    const { drive_url } = req.body as { drive_url?: string }
    if (!drive_url) return res.status(400).json({ error: 'drive_url required' })
    await deleteDriveFileByUrl(drive_url)
    res.json({ ok: true })
  } catch (err: any) {
    console.error('[delete-temp-merge-file] error:', err)
    res.status(500).json({ error: err.message })
  }
}
