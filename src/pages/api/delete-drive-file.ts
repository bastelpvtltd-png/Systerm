import type { NextApiRequest, NextApiResponse } from 'next'
import { getDriveClient } from '@/lib/driveFolders'
import { requireSection } from '@/lib/serverAuth'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  const authed = await requireSection(req, 'section:database.delete')
  if (!authed.ok) return res.status(authed.status).json({ error: authed.error })
  try {
    const { fileId } = req.body
    if (!fileId) return res.status(400).json({ error: 'fileId required' })

    const drive = getDriveClient()
    await drive.files.delete({ fileId })
    res.json({ ok: true })
  } catch (err: any) {
    console.error('[delete-drive-file] error:', err)
    res.status(500).json({ error: err.message })
  }
}
