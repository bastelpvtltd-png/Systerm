import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '@/lib/serverAuth'
import { deleteDriveFileByUrl } from '@/lib/driveFolders'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// A reason-tagged Quick Upload (documents-upload.tsx's "Quick Upload" panel)
// is meant to be temporary: nothing was ever extracted into a structured
// table for it, so once whoever picked it does Mail or Download there's
// nothing worth keeping in Drive — but the record of it having existed
// (document_uploads row + its pick_history_log notify/pick/mail/download
// trail) stays, so it still shows up in Processed History same as any real
// document. Only the Drive file itself is deleted (drive_url cleared after),
// plus dashboard_notifications/user_tasks so it drops out of Incoming/My
// Picked Tasks and the Dashboard's Pending CUSDEC Passed count.
//
// Not admin-gated like delete-document.ts/recycle-bin.ts — this is a normal
// part of the self-service Mail/Download flow for any signed-in user who
// picked the item, not a destructive admin action on someone else's data.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  const authed = await requireAuth(req)
  if (!authed.ok) return res.status(authed.status).json({ error: authed.error })
  try {
    const { document_id } = req.body as { document_id?: string }
    if (!document_id) return res.status(400).json({ error: 'document_id required' })

    const { data: doc } = await supabaseAdmin.from('document_uploads').select('drive_url, reason, is_saved_to_db').eq('id', document_id).maybeSingle()
    if (!doc) return res.status(404).json({ error: 'Document not found' })
    if (!doc.reason) return res.status(400).json({ error: 'This document was not part of a reason-tagged Quick Upload' })
    // Once Save was ticked, this has a real structured-table row + Drive file
    // like any other saved document — it must not be cascade-deleted just
    // because it also happens to carry a reason tag.
    if (doc.is_saved_to_db) return res.status(400).json({ error: 'This document was saved to the database — it is not temporary and cannot be removed this way' })

    if (doc.drive_url) await deleteDriveFileByUrl(doc.drive_url).catch((e: any) => console.error('[delete-reason-document] Drive delete failed:', e.message))

    await Promise.all([
      supabaseAdmin.from('dashboard_notifications').delete().eq('document_id', document_id),
      supabaseAdmin.from('user_tasks').delete().eq('document_id', document_id),
      supabaseAdmin.from('document_uploads').update({ drive_url: null, status: 'completed' }).eq('id', document_id),
    ])

    res.json({ ok: true })
  } catch (err: any) {
    console.error('[delete-reason-document] error:', err)
    res.status(500).json({ error: err.message })
  }
}
