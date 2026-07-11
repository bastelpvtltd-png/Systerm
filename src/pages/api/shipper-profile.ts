import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '@/lib/serverAuth'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Per-shipper defaults (Bank Details, Consignee) for the Invoice/Packing
// List form's auto-fill. GET reads the saved profile for a shipper; POST
// upserts it (called after a non-temporary document save so next time the
// same shipper is picked, the fields prefill again).
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method === 'GET') {
      const shipper = String(req.query.shipper || '').trim()
      if (!shipper) return res.json({ profile: null })
      const { data } = await supabaseAdmin.from('shipper_profiles').select('*').eq('shipper', shipper).maybeSingle()
      return res.json({ profile: data || null })
    }

    if (req.method === 'POST') {
      const authed = await requireAuth(req)
      if (!authed.ok) return res.status(authed.status).json({ error: authed.error })
      const { shipper, consignee, bank_details, tin } = req.body
      if (!shipper) return res.status(400).json({ error: 'shipper required' })
      const patch: Record<string, any> = { shipper, consignee: consignee || null, bank_details: bank_details || null, updated_at: new Date().toISOString() }
      if (tin !== undefined) patch.tin = tin || null
      const { error } = await supabaseAdmin
        .from('shipper_profiles')
        .upsert(patch, { onConflict: 'shipper' })
      if (error) return res.status(400).json({ error: error.message })
      return res.json({ ok: true })
    }

    res.status(405).end()
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
}
