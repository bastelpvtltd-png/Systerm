import { google } from 'googleapis'

// Downloads a Drive-hosted file's raw bytes given its share URL — same OAuth
// pattern already used by render-drive-page.ts, pulled out since the
// template engine needs it too.
export async function downloadDriveFile(driveUrl: string): Promise<Buffer> {
  const match = String(driveUrl).match(/\/d\/([a-zA-Z0-9_-]+)/)
  if (!match) throw new Error('Could not parse a Drive file id from driveUrl')
  const fileId = match[1]

  const clientId = process.env.GOOGLE_CLIENT_ID || ''
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || ''
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN || ''
  if (!clientId || !clientSecret || !refreshToken) throw new Error('Google OAuth credentials not configured')

  const auth = new google.auth.OAuth2(clientId, clientSecret)
  auth.setCredentials({ refresh_token: refreshToken })
  const drive = google.drive({ version: 'v3', auth })

  const file = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'arraybuffer' })
  return Buffer.from(file.data as ArrayBuffer)
}
