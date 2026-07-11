import type { NextApiRequest, NextApiResponse } from 'next'
import { google } from 'googleapis'
import { requireSection } from '@/lib/serverAuth'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  const authed = await requireSection(req, 'section:database.delete')
  if (!authed.ok) return res.status(authed.status).json({ error: authed.error })
  try {
    const { fileId } = req.body
    if (!fileId) return res.status(400).json({ error: 'fileId required' })

    const clientId = process.env.GOOGLE_CLIENT_ID || ''
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET || ''
    const refreshToken = process.env.GOOGLE_REFRESH_TOKEN || ''
    if (!clientId || !clientSecret || !refreshToken) throw new Error('Google OAuth credentials not configured')

    const auth = new google.auth.OAuth2(clientId, clientSecret)
    auth.setCredentials({ refresh_token: refreshToken })
    const drive = google.drive({ version: 'v3', auth })

    await drive.files.delete({ fileId })
    res.json({ ok: true })
  } catch (err: any) {
    console.error('[delete-drive-file] error:', err)
    res.status(500).json({ error: err.message })
  }
}
