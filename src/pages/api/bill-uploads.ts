import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { Readable } from 'stream'
import { requireAuth } from '@/lib/serverAuth'
import { getDriveClient, resolveBillFolderId } from '@/lib/driveFolders'
import { describeDriveError } from '@/pages/api/upload-to-drive'

export const config = { api: { bodyParser: { sizeLimit: '20mb' } } }

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// GET  /api/bill-uploads?cusdec_number=E+41423   → list bills for a cusdec
// POST /api/bill-uploads                          → upload bill file + save record
// DELETE /api/bill-uploads?id=...                 → delete bill record + drive file
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const authed = await requireAuth(req)
  if (!authed.ok) return res.status(authed.status).json({ error: authed.error })

  if (req.method === 'GET') {
    const { cusdec_number, cusdec_id } = req.query
    if (!cusdec_number && !cusdec_id) return res.status(400).json({ error: 'cusdec_number or cusdec_id required' })

    let q = sb.from('document_uploads')
      .select('id, file_name, drive_url, extracted_data, uploaded_by_name, created_at')
      .eq('doc_type', 'bill')
      .order('created_at', { ascending: false })
      .limit(100)

    if (cusdec_number) {
      q = q.eq('extracted_data->>cusdec_number', cusdec_number as string)
    } else if (cusdec_id) {
      q = q.eq('extracted_data->>cusdec_id', cusdec_id as string)
    }

    const { data, error } = await q
    if (error) return res.status(500).json({ error: error.message })
    return res.json({ bills: data || [] })
  }

  if (req.method === 'POST') {
    const {
      base64, fileName, mimeType,
      bill_subtype, cusdec_number, cusdec_id, cusdec_reference,
    } = req.body

    if (!base64 || !fileName) return res.status(400).json({ error: 'base64 and fileName required' })
    if (!cusdec_number) return res.status(400).json({ error: 'cusdec_number required' })

    const { data: prof } = await sb.from('profiles').select('username, full_name').eq('id', authed.userId).maybeSingle()
    const uploaderName = prof?.full_name || prof?.username || ''

    // Upload to Drive: Bills/{cusdecNumber}/
    let driveUrl = ''
    try {
      const drive = getDriveClient()
      const mainFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID || ''
      const folderId = mainFolderId
        ? await resolveBillFolderId(drive, mainFolderId, cusdec_number)
        : ''

      const buffer = Buffer.from(base64, 'base64')
      const finalMime = mimeType || inferMimeType(fileName)

      const uploaded = await drive.files.create({
        requestBody: { name: fileName, parents: folderId ? [folderId] : undefined },
        media: { mimeType: finalMime, body: Readable.from(buffer) },
        fields: 'id, webViewLink',
      })
      await drive.permissions.create({
        fileId: uploaded.data.id!,
        requestBody: { role: 'reader', type: 'anyone' },
      })
      driveUrl = uploaded.data.webViewLink || ''
    } catch (e: any) {
      return res.status(500).json({ error: describeDriveError(e) })
    }

    // Save to document_uploads
    const { data, error } = await sb.from('document_uploads').insert({
      file_name: fileName,
      drive_url: driveUrl,
      doc_type: 'bill',
      extracted_data: {
        bill_subtype: bill_subtype || 'other',
        cusdec_number,
        cusdec_id: cusdec_id || null,
        reference: cusdec_reference || null,
      },
      is_saved_to_db: true,
      status: 'completed',
      uploaded_by: authed.userId,
      uploaded_by_name: uploaderName,
      reason: bill_subtype || 'Bill',
    }).select().single()

    if (error) return res.status(500).json({ error: error.message })
    return res.json({ bill: data, driveUrl })
  }

  if (req.method === 'DELETE') {
    const { id } = req.query
    if (!id) return res.status(400).json({ error: 'id required' })

    const { data: bill } = await sb.from('document_uploads').select('drive_url, uploaded_by').eq('id', id).maybeSingle()
    if (!bill) return res.status(404).json({ error: 'Not found' })

    const { data: prof } = await sb.from('profiles').select('is_admin').eq('id', authed.userId).maybeSingle()
    if (!prof?.is_admin && bill.uploaded_by !== authed.userId) return res.status(403).json({ error: 'Not authorized' })

    if (bill.drive_url) {
      try {
        const m = bill.drive_url.match(/\/d\/([a-zA-Z0-9_-]+)/)
        if (m?.[1]) {
          const drive = getDriveClient()
          await drive.files.delete({ fileId: m[1] })
        }
      } catch {}
    }

    await sb.from('document_uploads').delete().eq('id', id)
    return res.json({ ok: true })
  }

  res.status(405).end()
}

const EXT_MIME: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
}
function inferMimeType(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() || ''
  return EXT_MIME[ext] || 'application/octet-stream'
}
