import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '@/lib/serverAuth'
import { deleteDriveFileByUrl } from '@/lib/driveFolders'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Delete from the Recent Generations list (uploaded_documents) — removes
// the Drive file, the history row itself, and whichever reference to that
// same drive_url is still sitting on a CUSDEC (boat_note_url/party_copy_url)
// or in cusdec_document_links (every other doc type's Save/Replace link),
// so a deleted generation doesn't leave a dangling "already saved" state
// that silently blocks a fresh Save or shows a broken link elsewhere.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  const authed = await requireAuth(req)
  if (!authed.ok) return res.status(authed.status).json({ error: authed.error })
  try {
    const { document_id } = req.body as { document_id?: string }
    if (!document_id) return res.status(400).json({ error: 'document_id required' })

    const { data: doc } = await supabaseAdmin.from('uploaded_documents').select('doc_type, drive_url').eq('id', document_id).maybeSingle()
    if (!doc) return res.status(404).json({ error: 'Document not found' })

    if (doc.drive_url) await deleteDriveFileByUrl(doc.drive_url).catch((e: any) => console.error('[delete-generation] Drive delete failed:', e.message))

    if (doc.doc_type === 'boat_note' && doc.drive_url) {
      await supabaseAdmin.from('cusdec').update({ boat_note_url: null, boat_note_drive_url: null, boat_note_saved_at: null, boat_note_created_at: null }).eq('boat_note_url', doc.drive_url)
      await supabaseAdmin.from('generated_boat_notes').delete().eq('drive_url', doc.drive_url)
    } else if (doc.doc_type === 'party_copy' && doc.drive_url) {
      await supabaseAdmin.from('cusdec').update({ party_copy_url: null }).eq('party_copy_url', doc.drive_url)
    } else if (doc.doc_type && doc.drive_url) {
      await supabaseAdmin.from('cusdec_document_links').delete().eq('document_type', doc.doc_type).eq('drive_url', doc.drive_url)
    }

    await supabaseAdmin.from('uploaded_documents').delete().eq('id', document_id)

    res.json({ ok: true })
  } catch (err: any) {
    console.error('[delete-generation] error:', err)
    res.status(500).json({ error: err.message })
  }
}
