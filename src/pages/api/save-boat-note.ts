import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '@/lib/serverAuth'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// "Save Only" path for Boat Note — the PDF is already generated and
// uploaded to Drive by the caller; this just records the resulting file
// path on the CUSDEC row (boat_note_drive_url/boat_note_saved_at) instead
// of triggering a download, and logs it the same way Invoice/Packing List
// saves do (uploaded_documents) so it also shows up in Database/Recycle Bin.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  const authed = await requireAuth(req)
  if (!authed.ok) return res.status(authed.status).json({ error: authed.error })
  try {
    const { cusdec_id, drive_url, file_name } = req.body
    if (!cusdec_id || !drive_url) return res.status(400).json({ error: 'cusdec_id and drive_url required' })

    const nowIso = new Date().toISOString()
    const { data: cusdec, error } = await supabaseAdmin.from('cusdec')
      .update({ boat_note_drive_url: drive_url, boat_note_saved_at: nowIso })
      .eq('id', cusdec_id)
      .select('number')
      .maybeSingle()
    if (error) return res.status(400).json({ error: error.message })

    await supabaseAdmin.from('uploaded_documents').insert({
      doc_type: 'boat_note', file_name: file_name || 'boat_note.pdf', file_url: '', drive_url,
      uploaded_by: authed.userId, updated_at: nowIso,
    })

    // Every Save Only also archives into the "Done Boat Note" list.
    const { data: prof } = await supabaseAdmin.from('profiles').select('username, full_name').eq('id', authed.userId).maybeSingle()
    await supabaseAdmin.from('generated_boat_notes').insert({
      cusdec_id, cusdec_number: cusdec?.number || null, file_name: file_name || 'boat_note.pdf', drive_url,
      created_by: authed.userId, created_by_name: prof?.full_name || prof?.username || '',
    })

    res.json({ ok: true })
  } catch (err: any) {
    console.error('[save-boat-note] error:', err)
    res.status(500).json({ error: err.message })
  }
}
