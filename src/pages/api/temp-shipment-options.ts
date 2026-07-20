import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '@/lib/serverAuth'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Auto-suggest source for the Shipment entry form's Shipper/Consignee
// fields — pulled from existing CUSDEC records (first line only, since
// exporter/consignee are multi-line name+address blobs). The form still
// allows free typing for a brand-new name that hasn't appeared yet.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end()
  const authed = await requireAuth(req)
  if (!authed.ok) return res.status(authed.status).json({ error: authed.error })
  try {
    const { data, error } = await supabaseAdmin.from('cusdec').select('exporter, consignee').limit(2000)
    if (error) return res.status(400).json({ error: error.message })

    const firstLine = (v: string | null) => (v || '').split('\n')[0].trim()
    const shippers = Array.from(new Set((data || []).map(r => firstLine(r.exporter)).filter(Boolean))).sort()
    const consignees = Array.from(new Set((data || []).map(r => firstLine(r.consignee)).filter(Boolean))).sort()

    res.json({ shippers, consignees })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
}
