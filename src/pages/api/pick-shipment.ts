import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '@/lib/serverAuth'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Claims a temporary_shipments row for the calling user — same atomic
// lock-out pattern as pick-task.ts: the UPDATE only matches if locked_by is
// STILL null at the moment it runs, so two users clicking Pick within
// milliseconds of each other can't both win. Once picked, the row is hidden
// from everyone else (temp-shipments.ts GET filters it out) and only the
// picker can edit it or turn it into a CUSDEC.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  try {
    const authed = await requireAuth(req)
    if (!authed.ok) return res.status(authed.status).json({ error: authed.error })
    const { shipment_id } = req.body
    if (!shipment_id) return res.status(400).json({ error: 'shipment_id required' })

    const { data: prof } = await supabaseAdmin.from('profiles').select('username, full_name').eq('id', authed.userId).maybeSingle()
    const userName = prof?.full_name || prof?.username || ''

    const { data: claimed, error: claimErr } = await supabaseAdmin
      .from('temporary_shipments')
      .update({ locked_by: authed.userId, locked_by_name: userName, locked_at: new Date().toISOString() })
      .eq('id', shipment_id)
      .is('locked_by', null)
      .select()
    if (claimErr) throw claimErr

    if (!claimed?.length) {
      const { data: current } = await supabaseAdmin.from('temporary_shipments').select('locked_by_name').eq('id', shipment_id).maybeSingle()
      return res.status(409).json({ error: current?.locked_by_name ? `Already picked by ${current.locked_by_name}` : 'Already picked by someone else' })
    }

    await supabaseAdmin.from('pick_history_log').insert({ document_id: shipment_id, user_id: authed.userId, user_name: userName, action: 'pick' })

    res.json({ ok: true, shipment: claimed[0] })
  } catch (err: any) {
    console.error('[pick-shipment] error:', err)
    res.status(500).json({ error: err.message })
  }
}
