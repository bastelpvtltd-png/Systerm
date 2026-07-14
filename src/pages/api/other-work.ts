import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { requireAuth, requireAdmin } from '@/lib/serverAuth'

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// GET  /api/other-work              → own items (approved+pending)
// GET  /api/other-work?all=1        → admin: all users
// GET  /api/other-work?user_id=...  → admin: specific user
// POST /api/other-work              → admin creates item for a user
// PATCH /api/other-work             → admin approves/rejects; or update desc/amount while pending
// DELETE /api/other-work?id=...     → admin only
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const authed = await requireAuth(req)
  if (!authed.ok) return res.status(authed.status).json({ error: authed.error })

  if (req.method === 'GET') {
    const { all, user_id } = req.query
    let q = sb.from('other_work').select('*').order('created_at', { ascending: false })
    if (all || user_id) {
      const adminAuthed = await requireAdmin(req)
      if (!adminAuthed.ok) return res.status(adminAuthed.status).json({ error: adminAuthed.error })
      if (user_id) q = q.eq('user_id', user_id as string)
    } else {
      q = q.eq('user_id', authed.userId)
    }
    const { data, error } = await q.limit(200)
    if (error) return res.status(500).json({ error: error.message })
    return res.json({ items: data || [] })
  }

  if (req.method === 'POST') {
    const adminAuthed = await requireAdmin(req)
    if (!adminAuthed.ok) return res.status(adminAuthed.status).json({ error: adminAuthed.error })
    const { user_id, user_name, description, amount } = req.body
    if (!user_id || !description?.trim() || !amount) return res.status(400).json({ error: 'user_id, description and amount required' })
    const { data, error } = await sb.from('other_work').insert({
      user_id, user_name: user_name || null, description: description.trim(),
      amount: Number(amount), status: 'pending', created_by: authed.userId,
    }).select().single()
    if (error) return res.status(500).json({ error: error.message })
    return res.json({ ok: true, item: data })
  }

  if (req.method === 'PATCH') {
    const adminAuthed = await requireAdmin(req)
    if (!adminAuthed.ok) return res.status(adminAuthed.status).json({ error: adminAuthed.error })
    const { id, status, description, amount } = req.body
    if (!id) return res.status(400).json({ error: 'id required' })
    const patch: Record<string, any> = {}
    if (status === 'approved') { patch.status = 'approved'; patch.approved_by = authed.userId; patch.approved_at = new Date().toISOString() }
    else if (status === 'rejected') { patch.status = 'rejected' }
    if (description !== undefined) patch.description = description.trim()
    if (amount !== undefined) patch.amount = Number(amount)
    if (!Object.keys(patch).length) return res.status(400).json({ error: 'nothing to update' })
    const { data, error } = await sb.from('other_work').update(patch).eq('id', id).select().single()
    if (error) return res.status(500).json({ error: error.message })
    return res.json({ ok: true, item: data })
  }

  if (req.method === 'DELETE') {
    const adminAuthed = await requireAdmin(req)
    if (!adminAuthed.ok) return res.status(adminAuthed.status).json({ error: adminAuthed.error })
    const { id } = req.query
    if (!id) return res.status(400).json({ error: 'id required' })
    await sb.from('other_work').delete().eq('id', id as string)
    return res.json({ ok: true })
  }

  res.status(405).end()
}
