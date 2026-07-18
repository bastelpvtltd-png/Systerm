import type { NextApiRequest, NextApiResponse } from 'next'
import { Readable } from 'stream'
import { resolveUploadFolderId, getDriveClient } from '@/lib/driveFolders'
import { requireAuth } from '@/lib/serverAuth'

export const config = { api: { bodyParser: { sizeLimit: '20mb' } } }

// Extracted so server-side callers that aren't handling an HTTP request
// themselves (e.g. the automation triggers in autoCreateDocs.ts) can reuse
// the exact same upload path instead of duplicating it.
export async function uploadBufferToDrive(base64: string, fileName: string, mimeType: string | undefined, docType: string | undefined): Promise<{ driveId: string; driveLink: string }> {
  const finalMimeType = mimeType || inferMimeType(fileName)
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID || ''
  const drive = getDriveClient()
  const buffer = Buffer.from(base64, 'base64')

  const targetFolderId = folderId
    ? await resolveUploadFolderId(drive, folderId, docType)
    : ''

  const uploaded = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: targetFolderId ? [targetFolderId] : undefined,
    },
    media: { mimeType: finalMimeType, body: Readable.from(buffer) },
    fields: 'id, webViewLink',
  })

  await drive.permissions.create({
    fileId: uploaded.data.id!,
    requestBody: { role: 'reader', type: 'anyone' },
  })

  return { driveId: uploaded.data.id!, driveLink: uploaded.data.webViewLink! }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  const authed = await requireAuth(req)
  if (!authed.ok) return res.status(authed.status).json({ error: authed.error })
  try {
    const { base64, fileName, mimeType, docType } = req.body
    if (!base64 || !fileName) return res.status(400).json({ error: 'Missing base64 or fileName' })
    const { driveId, driveLink } = await uploadBufferToDrive(base64, fileName, mimeType, docType)
    res.json({ driveId, driveLink })
  } catch (err: any) {
    console.error('Drive upload error:', err.response?.data || err.message)
    res.status(500).json({ error: describeDriveError(err) })
  }
}

const EXT_MIME: Record<string, string> = {
  pdf: 'application/pdf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
  csv: 'text/csv',
  xml: 'application/xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
}
function inferMimeType(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() || ''
  return EXT_MIME[ext] || 'application/octet-stream'
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
  if (/storage quota/i.test(desc)) {
    return 'Google Drive rejected this upload: the service account has no storage quota of its own. Share the target Drive folder with the service account email as an Editor, or move it into a Shared Drive.'
  }
  if (err?.response?.status === 403 || /insufficient|permission/i.test(desc)) {
    return 'Google Drive rejected this upload for a permissions reason (403) — the account may be missing the drive scope, or the target folder is no longer shared with it.'
  }
  return desc || 'Drive upload failed for an unknown reason — check server logs for the raw googleapis error.'
}
