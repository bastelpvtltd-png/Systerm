import type { NextApiRequest, NextApiResponse } from 'next'
import { google } from 'googleapis'
import { Readable } from 'stream'
import { resolveUploadFolderId } from '@/lib/driveFolders'
import { requireAuth } from '@/lib/serverAuth'

export const config = { api: { bodyParser: { sizeLimit: '20mb' } } }

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  const authed = await requireAuth(req)
  if (!authed.ok) return res.status(authed.status).json({ error: authed.error })
  try {
    const { base64, fileName, mimeType = 'application/pdf', docType } = req.body
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

    const targetFolderId = folderId
      ? await resolveUploadFolderId(drive, folderId, docType)
      : ''

    const uploaded = await drive.files.create({
      requestBody: {
        name: fileName,
        parents: targetFolderId ? [targetFolderId] : undefined,
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
    console.error('Drive upload error:', err.response?.data || err.message)
    res.status(500).json({ error: describeDriveError(err) })
  }
}

// googleapis surfaces auth failures as an opaque "invalid_grant"/401 with no
// hint that it's the refresh token, not the upload itself, that's broken —
// this was the most common real cause behind reported "Upload Failed"
// errors (a revoked/expired GOOGLE_REFRESH_TOKEN), so it gets a specific,
// actionable message instead of the raw OAuth error string.
export function describeDriveError(err: any): string {
  const code = err?.response?.data?.error || err?.code
  const desc = err?.response?.data?.error_description || err?.message || ''
  if (code === 'invalid_grant' || /invalid_grant/i.test(desc)) {
    return 'Google Drive login has expired or was revoked (invalid_grant). Re-run scripts/get-drive-token.js to generate a fresh GOOGLE_REFRESH_TOKEN and update it in Vercel env vars.'
  }
  if (code === 'invalid_client' || /invalid_client/i.test(desc)) {
    return 'Google Drive client credentials are wrong (invalid_client) — check GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET match the OAuth client scripts/get-drive-token.js was run with.'
  }
  if (err?.response?.status === 403 || /insufficient|permission/i.test(desc)) {
    return 'Google Drive rejected this upload for a permissions reason (403) — the OAuth token may be missing the drive.file scope, or the target folder is no longer shared with it.'
  }
  return desc || 'Drive upload failed for an unknown reason — check server logs for the raw googleapis error.'
}
