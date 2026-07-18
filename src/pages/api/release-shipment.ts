import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '@/lib/serverAuth'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// "Resolve" — the picker hands a shipment back to the pool without
// necessarily having finished a CUSDEC for it (e.g. they can't complete it
// right now). Releases the lock so it's visible/pickable by anyone again;
// logged the same way pick/return already are on the document side.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  try {
    const authed = await requireAuth(req)
    if (!authed.ok) return res.status(authed.status).json({ error: authed.error })
    const { shipment_id } = req.body
    if (!shipment_id) return res.status(400).json({ error: 'shipment_id required' })

    const { data: row } = await supabaseAdmin.from('temporary_shipments').select('locked_by').eq('id', shipment_id).maybeSingle()
    if (!row) return res.status(404).json({ error: 'Shipment not found' })

    const { data: prof } = await supabaseAdmin.from('profiles').select('is_admin, username, full_name').eq('id', authed.userId).maybeSingle()
    if (row.locked_by !== authed.userId && !prof?.is_admin) {
      return res.status(403).json({ error: 'Only the person who picked this can resolve it' })
    }

    await supabaseAdmin.from('temporary_shipments').update({ locked_by: null, locked_by_name: null, locked_at: null }).eq('id', shipment_id)

    const userName = prof?.full_name || prof?.username || ''
    await supabaseAdmin.from('pick_history_log').insert({ document_id: shipment_id, user_id: authed.userId, user_name: userName, action: 'return' })

    res.json({ ok: true })
  } catch (err: any) {
    console.error('[release-shipment] error:', err)
    res.status(500).json({ error: err.message })
  }
}
