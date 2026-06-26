import type { NextApiRequest, NextApiResponse } from 'next'
import { google } from 'googleapis'
import { Readable } from 'stream'

export const config = { api: { bodyParser: { sizeLimit: '20mb' } } }

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  try {
    const { base64, fileName, mimeType = 'application/pdf' } = req.body

    const saJson = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '{}')
    const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID || ''

    const auth = new google.auth.GoogleAuth({
      credentials: saJson,
      scopes: ['https://www.googleapis.com/auth/drive.file'],
    })

    const drive = google.drive({ version: 'v3', auth })
    const buffer = Buffer.from(base64, 'base64')
    const stream = Readable.from(buffer)

    const uploaded = await drive.files.create({
      requestBody: {
        name: fileName,
        parents: [folderId],
      },
      media: { mimeType, body: stream },
      fields: 'id, webViewLink',
    })

    // Make file publicly viewable
    await drive.permissions.create({
      fileId: uploaded.data.id!,
      requestBody: { role: 'reader', type: 'anyone' },
    })

    res.json({ driveId: uploaded.data.id, driveLink: uploaded.data.webViewLink })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
}
