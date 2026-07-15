import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '@/lib/serverAuth'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const authed = await requireAuth(req)
  if (!authed.ok) return res.status(authed.status).json({ error: authed.error })

  const { data: prof } = await supabaseAdmin.from('profiles').select('is_admin').eq('id', authed.userId).single()
  const isAdmin = !!prof?.is_admin

  if (req.method === 'DELETE') {
    const id = String(req.query.id || '')
    if (!id) return res.status(400).json({ error: 'id required' })

    const { data: msg } = await supabaseAdmin.from('messages').select('sender_id').eq('id', id).single()
    if (!msg) return res.status(404).json({ error: 'Not found' })

    if (!isAdmin && msg.sender_id !== authed.userId) {
      return res.status(403).json({ error: 'Can only delete your own messages' })
    }

    if (!isAdmin) {
      const { data: reads } = await supabaseAdmin.from('message_reads').select('user_id').eq('message_id', id)
      const seenByOthers = (reads || []).some(r => r.user_id !== authed.userId)
      if (seenByOthers) return res.status(403).json({ error: 'Cannot delete — message has been seen' })
    }

    const { error } = await supabaseAdmin.from('messages').delete().eq('id', id)
    if (error) return res.status(400).json({ error: error.message })
    return res.json({ ok: true })
  }

  if (req.method === 'PATCH') {
    const { id, body: newBody } = req.body
    if (!id || !newBody?.trim()) return res.status(400).json({ error: 'id and body required' })

    const { data: msg } = await supabaseAdmin.from('messages').select('sender_id').eq('id', id).single()
    if (!msg) return res.status(404).json({ error: 'Not found' })

    if (!isAdmin && msg.sender_id !== authed.userId) {
      return res.status(403).json({ error: 'Can only edit your own messages' })
    }

    if (!isAdmin) {
      const { data: reads } = await supabaseAdmin.from('message_reads').select('user_id').eq('message_id', id)
      const seenByOthers = (reads || []).some(r => r.user_id !== authed.userId)
      if (seenByOthers) return res.status(403).json({ error: 'Cannot edit — message has been seen' })
    }

    const { data, error } = await supabaseAdmin
      .from('messages')
      .update({ body: newBody.trim(), updated_at: new Date().toISOString() })
      .eq('id', id).select().single()
    if (error) return res.status(400).json({ error: error.message })
    return res.json({ message: data })
  }

  res.status(405).end()
}
