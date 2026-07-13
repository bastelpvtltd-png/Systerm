import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { requireAuth, requireAdmin } from '@/lib/serverAuth'

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// GET  /api/document-conflicts          → admin: list unresolved conflicts
// POST /api/document-conflicts          → resolve a conflict (admin)
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const authed = await requireAuth(req)
  if (!authed.ok) return res.status(authed.status).json({ error: authed.error })

  if (req.method === 'GET') {
    const adminAuthed = await requireAdmin(req)
    if (!adminAuthed.ok) return res.status(adminAuthed.status).json({ error: adminAuthed.error })

    const resolved = req.query.resolved === 'true'
    const { data, error } = await sb
      .from('document_conflicts')
      .select('*, old_doc:old_doc_id(id,file_name,drive_url,doc_type,reason,extracted_data), new_doc:new_doc_id(id,file_name,drive_url,doc_type,reason,extracted_data)')
      .eq('resolved', resolved)
      .order('created_at', { ascending: false })
      .limit(100)
    if (error) return res.status(500).json({ error: error.message })
    return res.json({ conflicts: data || [] })
  }

  if (req.method === 'POST') {
    const adminAuthed = await requireAdmin(req)
    if (!adminAuthed.ok) return res.status(adminAuthed.status).json({ error: adminAuthed.error })

    const { conflict_id, resolution } = req.body
    if (!conflict_id || !resolution) return res.status(400).json({ error: 'conflict_id and resolution required' })
    if (!['keep_old', 'use_new', 'both'].includes(resolution)) return res.status(400).json({ error: 'invalid resolution' })

    const { error } = await sb.from('document_conflicts').update({
      resolved: true, resolved_by: authed.userId, resolution,
      resolved_at: new Date().toISOString(),
    }).eq('id', conflict_id)
    if (error) return res.status(500).json({ error: error.message })

    return res.json({ ok: true })
  }

  res.status(405).end()
}
