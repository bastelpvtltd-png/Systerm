import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '@/lib/serverAuth'
import { getDriveClient, DOC_TYPE_FOLDER_NAMES, getOrCreateSubfolder } from '@/lib/driveFolders'

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

const SUPABASE_TABLES = [
  { key: 'cusdec', label: 'CUSDEC' },
  { key: 'cdn', label: 'CDN' },
  { key: 'barcode', label: 'Barcode' },
  { key: 'boat_notes', label: 'Boat Notes' },
  { key: 'uploaded_documents', label: 'Uploaded Documents' },
  { key: 'pdf_templates', label: 'PDF Templates' },
  { key: 'messages', label: 'Messages' },
  { key: 'profiles', label: 'Users (Profiles)' },
  { key: 'temporary_shipments', label: 'Shipment Entry' },
]

// Sums every file's size under a Drive folder, following nextPageToken so
// folders past the old 200-file single-page cap (list-drive-files.ts) still
// report an accurate total instead of silently truncating.
async function folderBytes(drive: ReturnType<typeof getDriveClient>, folderId: string): Promise<{ bytes: number; fileCount: number }> {
  let bytes = 0, fileCount = 0, pageToken: string | undefined
  do {
    const list = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false and mimeType != 'application/vnd.google-apps.folder'`,
      fields: 'nextPageToken, files(size)',
      pageSize: 1000,
      pageToken,
    })
    for (const f of list.data.files || []) bytes += Number(f.size || 0)
    fileCount += list.data.files?.length || 0
    pageToken = list.data.nextPageToken || undefined
  } while (pageToken)
  return { bytes, fileCount }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end()
  const authed = await requireAuth(req)
  if (!authed.ok) return res.status(authed.status).json({ error: authed.error })

  const [drive_result, supabase_result] = await Promise.allSettled([
    (async () => {
      const mainFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID || ''
      if (!mainFolderId) throw new Error('GOOGLE_DRIVE_FOLDER_ID not configured')
      const drive = getDriveClient()

      const [about, ...folderStats] = await Promise.all([
        drive.about.get({ fields: 'storageQuota' }),
        ...Object.entries(DOC_TYPE_FOLDER_NAMES).map(async ([docType, folderName]) => {
          const id = await getOrCreateSubfolder(drive, mainFolderId, folderName)
          const stats = await folderBytes(drive, id)
          return { docType, folderName, ...stats }
        }),
      ])
      const quota = about.data.storageQuota
      return {
        totalUsedBytes: Number(quota?.usage || 0),
        totalLimitBytes: quota?.limit ? Number(quota.limit) : null, // null = unlimited (Workspace)
        folders: folderStats.sort((a, b) => b.bytes - a.bytes),
      }
    })(),
    (async () => {
      const counts = await Promise.all(SUPABASE_TABLES.map(async t => {
        const { count, error } = await sb.from(t.key).select('*', { count: 'exact', head: true })
        return { key: t.key, label: t.label, rowCount: error ? null : (count ?? 0) }
      }))
      return { tables: counts }
    })(),
  ])

  res.json({
    drive: drive_result.status === 'fulfilled' ? drive_result.value : { error: drive_result.reason?.message || 'Failed to load Drive stats' },
    supabase: supabase_result.status === 'fulfilled' ? supabase_result.value : { error: supabase_result.reason?.message || 'Failed to load Supabase stats' },
  })
}
