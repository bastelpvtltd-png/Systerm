import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '@/lib/serverAuth'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Freeform notes for documenting future system integrations/workflows —
// any signed-in user with the tab can read/write; nothing sensitive lives here.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const authed = await requireAuth(req)
    if (!authed.ok) return res.status(authed.status).json({ error: authed.error })

    if (req.method === 'GET') {
      const { data, error } = await supabaseAdmin.from('system_notes').select('*').order('updated_at', { ascending: false })
      if (error) throw error
      return res.json({ notes: data || [] })
    }

    if (req.method === 'POST') {
      const { id, title, content } = req.body
      if (!title) return res.status(400).json({ error: 'title required' })
      if (id) {
        const { error } = await supabaseAdmin.from('system_notes').update({ title, content, updated_at: new Date().toISOString() }).eq('id', id)
        if (error) throw error
      } else {
        const { error } = await supabaseAdmin.from('system_notes').insert({ title, content })
        if (error) throw error
      }
      return res.json({ ok: true })
    }

    if (req.method === 'DELETE') {
      const id = String(req.query.id || '')
      if (!id) return res.status(400).json({ error: 'id required' })
      const { error } = await supabaseAdmin.from('system_notes').delete().eq('id', id)
      if (error) throw error
      return res.json({ ok: true })
    }

    return res.status(405).end()
  } catch (err: any) {
    console.error('[system-notes] error:', err)
    res.status(500).json({ error: err.message })
  }
}
