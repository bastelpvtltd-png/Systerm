import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '@/lib/serverAuth'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Admin/Overview "Pick History" audit log — who uploaded what, who picked
// it and when, searchable/filterable by document name, user, or action.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end()
  try {
    const authed = await requireAuth(req)
    if (!authed.ok) return res.status(authed.status).json({ error: authed.error })

    const { user, action, fileName } = req.query
    let query = supabaseAdmin
      .from('pick_history_log')
      .select('*, document_uploads(id, file_name, doc_type, uploaded_by_name)')
      .order('action_timestamp', { ascending: false })
      .limit(500)

    if (user) query = query.ilike('user_name', `%${user}%`)
    if (action) query = query.eq('action', action as string)

    const { data, error } = await query
    if (error) throw error

    const items = fileName
      ? (data || []).filter((r: any) => (r.document_uploads?.file_name || '').toLowerCase().includes(String(fileName).toLowerCase()))
      : (data || [])

    res.json({ items })
  } catch (err: any) {
    console.error('[pick-history] error:', err)
    res.status(500).json({ error: err.message })
  }
}
