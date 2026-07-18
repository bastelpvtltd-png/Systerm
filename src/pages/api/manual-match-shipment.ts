import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { mergeShipmentIntoCusdec } from '@/lib/docTables'
import { requireAuth } from '@/lib/serverAuth'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Fallback for when a CUSDEC upload's Invoice Number didn't auto-match any
// pending Shipment entry (missed extraction, typo, etc.) — lets the user
// pick the right temporary_shipments row by hand and runs the same
// merge-then-delete logic as the automatic path.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  const authed = await requireAuth(req)
  if (!authed.ok) return res.status(authed.status).json({ error: authed.error })
  try {
    const { cusdec_id, shipment_id } = req.body
    if (!cusdec_id || !shipment_id) return res.status(400).json({ error: 'cusdec_id and shipment_id required' })

    const { data: cusdecRow, error: cErr } = await supabaseAdmin.from('cusdec').select('*').eq('id', cusdec_id).single()
    if (cErr || !cusdecRow) return res.status(404).json({ error: 'CUSDEC row not found' })

    const { data: shipment, error: sErr } = await supabaseAdmin.from('temporary_shipments').select('*').eq('id', shipment_id).single()
    if (sErr || !shipment) return res.status(404).json({ error: 'Shipment entry not found' })

    if (shipment.locked_by && shipment.locked_by !== authed.userId) {
      const { data: prof } = await supabaseAdmin.from('profiles').select('is_admin').eq('id', authed.userId).maybeSingle()
      if (!prof?.is_admin) return res.status(403).json({ error: 'This shipment is picked by someone else' })
    }

    await mergeShipmentIntoCusdec(cusdecRow, shipment)
    res.json({ ok: true })
  } catch (err: any) {
    console.error('[manual-match-shipment] error:', err)
    res.status(500).json({ error: err.message })
  }
}
