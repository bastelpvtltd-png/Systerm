import type { drive_v3 } from 'googleapis'

// Maps our doc_type values to the Drive sub-folder name they belong in.
// Types not listed here (party_copy, bill, unknown) upload to the main folder.
export const DOC_TYPE_FOLDER_NAMES: Record<string, string> = {
  cdn: 'CDN',
  cusdec: 'CUSDEC',
  barcode: 'Barcode',
  boat_note: 'Boat Note',
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
