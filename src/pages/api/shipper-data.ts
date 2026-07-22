import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '@/lib/serverAuth'

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// The shipper portal's own data endpoint — deliberately separate from
// shipment-overview.ts (staff tool, much wider access) so a shipper account
// can never even reach a route that returns anything beyond their own
// completed + fully-paid shipments, no matter what's passed in.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const authed = await requireAuth(req)
  if (!authed.ok) return res.status(authed.status).json({ error: authed.error })

  const { data: prof } = await sb.from('profiles').select('is_shipper, shipper_name, full_name, username').eq('id', authed.userId).maybeSingle()
  if (!prof?.is_shipper || !prof.shipper_name) return res.status(403).json({ error: 'Not a shipper account' })
  const shipperName = prof.shipper_name.trim().toLowerCase()

  if (req.method === 'GET') {
    // Every CUSDEC whose exporter's first line matches this shipper —
    // "completed" ones (shipment_complete + payment_complete, i.e. Also
    // Done) always show; everything else only shows once it exists at all,
    // same visibility rule Assigned Shippers uses elsewhere for the
    // exporter-name match itself, matched the same normalized way.
    const { data: rows, error } = await sb.from('cusdec').select('*').order('created_at', { ascending: false }).limit(500)
    if (error) return res.status(500).json({ error: error.message })
    const mine = (rows || []).filter(c => (c.exporter || '').split('\n')[0].trim().toLowerCase() === shipperName)
    const completed = mine.filter(c => c.shipment_complete && c.payment_complete)
    const inProgress = mine.filter(c => !(c.shipment_complete && c.payment_complete))
    return res.json({ completed, inProgress })
  }

  if (req.method === 'POST') {
    // Create a Shipment Entry — same table/shape temp-shipments.ts's own
    // POST uses, but the shipper field is always forced to this account's
    // own shipper_name (never trusts whatever the client sent).
    const { invoice_number, packing_number } = req.body
    if (!invoice_number) return res.status(400).json({ error: 'invoice_number required' })
    const code = prof.shipper_name.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4) || 'GEN'
    const now = new Date()
    const reference = `${code}-${now.getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`
    const { data, error } = await sb.from('temporary_shipments').insert({
      reference, shipper: prof.shipper_name, invoice_number, packing_number: packing_number || null,
      created_by: authed.userId,
    }).select().single()
    if (error) return res.status(500).json({ error: error.message })
    return res.json({ ok: true, shipment: data })
  }

  res.status(405).end()
}
