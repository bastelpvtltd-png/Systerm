import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { requireSection } from '@/lib/serverAuth'
import { runTricoCheck, needsGateCheck } from '@/lib/tricoCheckRun'
import { shipperName } from '@/lib/shipperName'

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const SECTION = 'section:automation.trico-checking'

// Trico Checking.
//   GET  → every CDN with gate add/in/out info, plus how many still need checking
//   POST { cdnIds?: string[], limit?: number, before?: ISO time the sweep started } → check a small batch now (the
//        page calls this in a loop; Vercel request time limits make one huge
//        request a bad idea).
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const authed = await requireSection(req, SECTION)
  if (!authed.ok) return res.status(authed.status).json({ error: authed.error })
  try {
    if (req.method === 'GET') {
      const { data, error } = await sb.from('cdn')
        .select('id, cusdec_number, container_no, shipper, gate_add_time, gate_in_time, gate_out_time, trico_checked_at, trico_check_note')
        .order('created_at', { ascending: false }).limit(1000)
      if (error) return res.status(500).json({ error: `${error.message} (run the SQL migration that adds the gate_* columns)` })
      const items = (data || []).filter(c => c.container_no).map(c => ({ ...c, shipper: shipperName(c.shipper), pending: needsGateCheck(c) }))
      return res.json({ items, pending: items.filter(i => i.pending).length })
    }
    if (req.method === 'POST') {
      const cdnIds = Array.isArray(req.body?.cdnIds) ? req.body.cdnIds : undefined
      const summary = await runTricoCheck({ cdnIds, limit: Number(req.body?.limit) || 5, maxMs: 8_000, before: typeof req.body?.before === 'string' ? req.body.before : undefined })
      return res.json(summary)
    }
    res.status(405).end()
  } catch (err: any) {
    console.error('[trico-check] error:', err)
    res.status(500).json({ error: err.message })
  }
}
