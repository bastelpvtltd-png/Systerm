import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '@/lib/serverAuth'
import { getDriveClient, getOrCreateSubfolder, deleteDriveFileByUrl } from '@/lib/driveFolders'

export const config = { api: { bodyParser: { sizeLimit: '10mb' } } }

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

// Each user's own profile picture — uploaded to an "Images" subfolder under
// the main Drive folder, one file per user, named after them (not a random
// Drive ID) so it's easy to find by hand in Drive too. A new upload deletes
// the old file first, same replace pattern as every other Drive-backed link
// in this app (see document-link.ts).
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  const authed = await requireAuth(req)
  if (!authed.ok) return res.status(authed.status).json({ error: authed.error })

  try {
    const { base64, mimeType } = req.body as { base64: string; mimeType?: string }
    if (!base64) return res.status(400).json({ error: 'base64 required' })

    const { data: prof } = await sb.from('profiles').select('username, full_name, avatar_url').eq('id', authed.userId).maybeSingle()
    const name = (prof?.full_name || prof?.username || authed.userId).trim()
    const safeName = name.replace(/[/\\:*?"<>|]/g, '_')

    const mainFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID || ''
    if (!mainFolderId) return res.status(500).json({ error: 'GOOGLE_DRIVE_FOLDER_ID not configured' })

    const drive = getDriveClient()
    const imagesFolderId = await getOrCreateSubfolder(drive, mainFolderId, 'Images')

    if (prof?.avatar_url) {
      try { await deleteDriveFileByUrl(prof.avatar_url) } catch {}
    }

    const ext = (mimeType || '').includes('png') ? 'png' : (mimeType || '').includes('webp') ? 'webp' : 'jpg'
    const buffer = Buffer.from(base64, 'base64')
    const { Readable } = await import('stream')
    const uploaded = await drive.files.create({
      requestBody: { name: `${safeName}.${ext}`, parents: [imagesFolderId] },
      media: { mimeType: mimeType || 'image/jpeg', body: Readable.from(buffer) },
      fields: 'id, webViewLink',
    })
    await drive.permissions.create({ fileId: uploaded.data.id!, requestBody: { role: 'reader', type: 'anyone' } })

    const avatarUrl = uploaded.data.webViewLink!
    const { error } = await sb.from('profiles').update({ avatar_url: avatarUrl }).eq('id', authed.userId)
    if (error) throw error

    res.json({ ok: true, avatar_url: avatarUrl })
  } catch (err: any) {
    console.error('[upload-profile-picture] error:', err)
    res.status(500).json({ error: err.message })
  }
}
