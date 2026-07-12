import { google, drive_v3 } from 'googleapis'

// Same credential setup used across upload/delete/list Drive endpoints,
// centralized so server-side callers (like the duplicate-row cleanup in
// docTables.ts) don't each re-implement the wiring.
//
// Prefers a service account (GOOGLE_SERVICE_ACCOUNT_JSON) when one is
// configured — its key doesn't expire the way a user OAuth refresh token
// does (Google's OAuth consent screens in "Testing" mode revoke refresh
// tokens after ~7 days of inactivity, which was the actual cause behind
// "Upload Failed" errors: invalid_grant/"Token has been expired or
// revoked"). Falls back to the OAuth2 refresh-token flow
// (scripts/get-drive-token.js) if no service account key is set.
// Note: a service account has no personal Drive storage quota of its own —
// the target folder must be a Shared Drive, or shared with the service
// account's email as an Editor on someone else's Drive, or uploads will
// fail with a distinct "storage quota" error (see describeDriveError in
// upload-to-drive.ts).
export function getDriveClient(): drive_v3.Drive {
  const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || ''
  if (serviceAccountJson) {
    const credentials = JSON.parse(serviceAccountJson)
    const auth = new google.auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/drive'] })
    return google.drive({ version: 'v3', auth })
  }

  const clientId = process.env.GOOGLE_CLIENT_ID || ''
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || ''
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN || ''
  if (!clientId || !clientSecret || !refreshToken) throw new Error('Google Drive credentials not configured (neither GOOGLE_SERVICE_ACCOUNT_JSON nor GOOGLE_CLIENT_ID/SECRET/REFRESH_TOKEN are set)')
  const auth = new google.auth.OAuth2(clientId, clientSecret)
  auth.setCredentials({ refresh_token: refreshToken })
  return google.drive({ version: 'v3', auth })
}

// Extracts the Drive file id from a stored webViewLink like
// https://drive.google.com/file/d/<ID>/view — used to delete the matching
// Drive file whenever the DB row that references it is deleted/replaced.
export function driveFileIdFromUrl(url: string | null | undefined): string | null {
  if (!url) return null
  const m = String(url).match(/\/d\/([a-zA-Z0-9_-]+)/)
  return m ? m[1] : null
}

export async function deleteDriveFileByUrl(url: string | null | undefined): Promise<void> {
  const fileId = driveFileIdFromUrl(url)
  if (!fileId) return
  try {
    const drive = getDriveClient()
    await drive.files.delete({ fileId })
  } catch (e: any) {
    console.error('[deleteDriveFileByUrl] failed:', e.message)
  }
}

// Maps our doc_type values to the Drive sub-folder name they belong in.
// Types not listed here (party_copy, bill, unknown) upload to the main folder.
export const DOC_TYPE_FOLDER_NAMES: Record<string, string> = {
  cdn: 'CDN',
  cusdec: 'CUSDEC',
  barcode: 'Barcode',
  boat_note: 'Boat Note',
  invoice: 'Invoice',
  packing_list: 'Packing List',
  template: 'Templates',
}

const folderIdCache = new Map<string, string>()

// Finds the sub-folder by name under parentId, creating it if it doesn't exist yet.
export async function getOrCreateSubfolder(
  drive: drive_v3.Drive,
  parentId: string,
  folderName: string
): Promise<string> {
  const cacheKey = `${parentId}/${folderName}`
  const cached = folderIdCache.get(cacheKey)
  if (cached) return cached

  const escapedName = folderName.replace(/'/g, "\\'")
  const list = await drive.files.list({
    q: `'${parentId}' in parents and name = '${escapedName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: 'files(id, name)',
    spaces: 'drive',
  })

  const existing = list.data.files?.[0]
  if (existing?.id) {
    folderIdCache.set(cacheKey, existing.id)
    return existing.id
  }

  const created = await drive.files.create({
    requestBody: {
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId],
    },
    fields: 'id',
  })

  const newId = created.data.id!
  folderIdCache.set(cacheKey, newId)
  return newId
}

// Resolves which Drive folder a document should upload into for the given doc_type.
export async function resolveUploadFolderId(
  drive: drive_v3.Drive,
  mainFolderId: string,
  docType: string | undefined
): Promise<string> {
  const folderName = docType ? DOC_TYPE_FOLDER_NAMES[docType] : undefined
  if (!folderName) return mainFolderId
  return getOrCreateSubfolder(drive, mainFolderId, folderName)
}
