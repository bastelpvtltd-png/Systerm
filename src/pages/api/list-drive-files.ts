import type { NextApiRequest, NextApiResponse } from 'next'
import { google } from 'googleapis'
import { DOC_TYPE_FOLDER_NAMES, getOrCreateSubfolder } from '@/lib/driveFolders'
import { requireAuth } from '@/lib/serverAuth'

function driveClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID || ''
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || ''
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN || ''
  if (!clientId || !clientSecret || !refreshToken) throw new Error('Google OAuth credentials not configured')
  const auth = new google.auth.OAuth2(clientId, clientSecret)
  auth.setCredentials({ refresh_token: refreshToken })
  return google.drive({ version: 'v3', auth })
}

// Lists the PDFs sitting in the doc-type sub-folders (and the main folder)
// under GOOGLE_DRIVE_FOLDER_ID, so an admin can see and clean up what's
// actually stored in Drive without opening Drive itself.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end()
  const authed = await requireAuth(req)
  if (!authed.ok) return res.status(authed.status).json({ error: authed.error })
  try {
    const mainFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID || ''
    if (!mainFolderId) return res.status(500).json({ error: 'GOOGLE_DRIVE_FOLDER_ID not configured' })
    const drive = driveClient()

    const folders: { label: string; id: string }[] = [{ label: 'Main', id: mainFolderId }]
    for (const [docType, folderName] of Object.entries(DOC_TYPE_FOLDER_NAMES)) {
      const id = await getOrCreateSubfolder(drive, mainFolderId, folderName)
      folders.push({ label: folderName, id })
    }

    const results = await Promise.all(folders.map(async f => {
      const list = await drive.files.list({
        q: `'${f.id}' in parents and trashed = false and mimeType != 'application/vnd.google-apps.folder'`,
        fields: 'files(id, name, webViewLink, modifiedTime, size)',
        orderBy: 'modifiedTime desc',
        pageSize: 200,
      })
      return { folder: f.label, files: list.data.files || [] }
    }))

    res.json({ folders: results })
  } catch (err: any) {
    console.error('[list-drive-files] error:', err)
    res.status(500).json({ error: err.message })
  }
}
