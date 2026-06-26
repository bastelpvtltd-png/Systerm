import type { NextApiRequest, NextApiResponse } from 'next'
import { google } from 'googleapis'
import { Readable } from 'stream'

export const config = { api: { bodyParser: { sizeLimit: '20mb' } } }

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  try {
    const { base64, fileName, mimeType = 'application/pdf' } = req.body
    if (!base64 || !fileName) return res.status(400).json({ error: 'Missing base64 or fileName' })

    const clientId     = process.env.GOOGLE_CLIENT_ID || ''
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET || ''
    const refreshToken = process.env.GOOGLE_REFRESH_TOKEN || ''
    const folderId     = process.env.GOOGLE_DRIVE_FOLDER_ID || ''

    if (!clientId || !clientSecret || !refreshToken) {
      return res.status(500).json({ error: 'Google OAuth credentials not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN env vars.' })
    }

    const auth = new google.auth.OAuth2(clientId, clientSecret)
    auth.setCredentials({ refresh_token: refreshToken })

    const drive = google.drive({ version: 'v3', auth })
    const buffer = Buffer.from(base64, 'base64')

    const uploaded = await drive.files.create({
      requestBody: {
        name: fileName,
        parents: folderId ? [folderId] : undefined,
      },
      media: { mimeType, body: Readable.from(buffer) },
      fields: 'id, webViewLink',
    })

    await drive.permissions.create({
      fileId: uploaded.data.id!,
      requestBody: { role: 'reader', type: 'anyone' },
    })

    res.json({ driveId: uploaded.data.id, driveLink: uploaded.data.webViewLink })
  } catch (err: any) {
    console.error('Drive upload error:', err.message)
    res.status(500).json({ error: err.message })
  }
}
