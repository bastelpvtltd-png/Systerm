import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { requireAuth, requireSection } from '@/lib/serverAuth'
import { deleteDriveFileByUrl } from '@/lib/driveFolders'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Every delete from the Database admin page (admin-data.ts) archives the full
// row here first instead of destroying it outright — this is what actually
// shows "what got deleted, by whom, when" and lets it be brought straight
// back (Undo) instead of the delete being final and silent.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const auth = await requireAuth(req)
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error })

  try {
    if (req.method === 'GET') {
      const { data, error } = await supabaseAdmin.from('deleted_records').select('*').order('deleted_at', { ascending: false }).limit(300)
      if (error) throw error
      return res.json({ items: data || [] })
    }

    if (req.method === 'POST') {
      // Restore is exactly as sensitive as the delete that put something
      // here — same access gate as admin-data.ts's DELETE branch.
      const gated = await requireSection(req, 'section:database.delete')
      if (!gated.ok) return res.status(gated.status).json({ error: gated.error })
      // Restore — re-insert the archived row (same id) into its original
      // table, then drop it from the bin.
      const id = String(req.body.id || '')
      if (!id) return res.status(400).json({ error: 'id required' })
      const { data: entry } = await supabaseAdmin.from('deleted_records').select('*').eq('id', id).maybeSingle()
      if (!entry) return res.status(404).json({ error: 'Not found in Recycle Bin' })
      const { error: insertErr } = await supabaseAdmin.from(entry.table_name).upsert(entry.record_data)
      if (insertErr) return res.status(400).json({ error: insertErr.message })
      await supabaseAdmin.from('deleted_records').delete().eq('id', id)
      return res.json({ ok: true, table: entry.table_name })
    }

    if (req.method === 'DELETE') {
      // Purge permanently — this is the only place that actually deletes the
      // Drive PDF, since a normal delete from Database no longer does.
      const gated = await requireSection(req, 'section:database.delete')
      if (!gated.ok) return res.status(gated.status).json({ error: gated.error })
      const id = String(req.query.id || '')
      if (!id) return res.status(400).json({ error: 'id required' })
      const { data: entry } = await supabaseAdmin.from('deleted_records').select('drive_url').eq('id', id).maybeSingle()
      let driveDeleteFailed = false
      if (entry?.drive_url) {
        try {
          await deleteDriveFileByUrl(entry.drive_url)
        } catch (e: any) {
          // The database purge still completes either way — an orphaned
          // Drive file is recoverable (delete it by hand later), a record
          // stuck in the bin forever because Drive is unreachable isn't.
          // This used to fail completely silently (before the Drive auth
          // fix, every purge's Drive delete was failing and nobody could
          // tell), so it's at least logged now instead of swallowed.
          driveDeleteFailed = true
          console.error('[recycle-bin] Drive file delete failed during purge:', e.message)
        }
      }
      await supabaseAdmin.from('deleted_records').delete().eq('id', id)
      return res.json({ ok: true, driveDeleteFailed })
    }

    res.status(405).end()
  } catch (err: any) {
    console.error('[recycle-bin] error:', err)
    res.status(500).json({ error: err.message })
  }
}
