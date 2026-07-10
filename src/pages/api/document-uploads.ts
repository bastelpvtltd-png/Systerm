import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '@/lib/serverAuth'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// The "Send" modal's umbrella record — created once per sent document
// regardless of which of Save/Mail/Notify were ticked, so Notify/Pick can
// reference a stable document_id even when Save wasn't ticked (the file
// still needs a Drive link to be viewable by other users via "Look Only").
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method === 'POST') {
      const authed = await requireAuth(req)
      if (!authed.ok) return res.status(authed.status).json({ error: authed.error })
      const { file_name, drive_url, doc_type, extracted_data, is_saved_to_db } = req.body
      if (!file_name) return res.status(400).json({ error: 'file_name required' })

      const { data: prof } = await supabaseAdmin.from('profiles').select('username, full_name').eq('id', authed.userId).maybeSingle()
      const uploadedByName = prof?.full_name || prof?.username || ''

      const { data, error } = await supabaseAdmin.from('document_uploads').insert({
        file_name, drive_url: drive_url || null, doc_type: doc_type || null,
        extracted_data: extracted_data || null, is_saved_to_db: !!is_saved_to_db,
        status: is_saved_to_db ? 'completed' : 'pending_action',
        uploaded_by: authed.userId, uploaded_by_name: uploadedByName,
      }).select().single()
      if (error) throw error
      return res.json({ document: data })
    }
    res.status(405).end()
  } catch (err: any) {
    console.error('[document-uploads] error:', err)
    res.status(500).json({ error: err.message })
  }
}
