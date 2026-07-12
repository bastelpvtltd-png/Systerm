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
// nothing left worth keeping — this removes the Drive file and every trace
// of it (document_uploads, pick_history_log, dashboard_notifications,
// user_tasks) in one call, which is also what takes it out of the
// Dashboard's Pending CUSDEC Passed count.
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

    const { data: doc } = await supabaseAdmin.from('document_uploads').select('drive_url, reason').eq('id', document_id).maybeSingle()
    if (!doc) return res.status(404).json({ error: 'Document not found' })
    if (!doc.reason) return res.status(400).json({ error: 'This document was not part of a reason-tagged Quick Upload' })

    if (doc.drive_url) await deleteDriveFileByUrl(doc.drive_url).catch((e: any) => console.error('[delete-reason-document] Drive delete failed:', e.message))

    await Promise.all([
      supabaseAdmin.from('pick_history_log').delete().eq('document_id', document_id),
      supabaseAdmin.from('dashboard_notifications').delete().eq('document_id', document_id),
      supabaseAdmin.from('user_tasks').delete().eq('document_id', document_id),
    ])
    await supabaseAdmin.from('document_uploads').delete().eq('id', document_id)

    res.json({ ok: true })
  } catch (err: any) {
    console.error('[delete-reason-document] error:', err)
    res.status(500).json({ error: err.message })
  }
}
