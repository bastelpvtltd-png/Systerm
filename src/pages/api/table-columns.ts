import type { NextApiRequest, NextApiResponse } from 'next'
import { requireAuth } from '@/lib/serverAuth'

// Hardcoded columns — information_schema is not accessible via Supabase JS client.
// These match the actual table definitions.
const TABLE_COLUMNS: Record<string, string[]> = {
  cusdec: [
    'id','code','number','date','exporter','consignee','vessel','voyage_no',
    'bl_no','gross_mass','net_mass','discharge_port','location_of_goods',
    'cap','hs_code','preference','procedure_code','delivery_terms',
    'amount','pkges','tin_vat','invoice_number','boat_note_link',
    'export_release_passed','created_at',
  ],
  cdn: [
    'id','code','cusdec_number','shipper','consignee','container_no',
    'goods_description','gross_mass','vessel','voyage','voyage_date',
    'bl_no','slpa_no','voc','coc','lorry_no','trailer_no',
    'loading_port','discharge_port','driver_name','pkg_no','pkg_type',
    'volume','seal_no','con_type','marks','cdn_no',
    'boat_note_passed','export_release_passed','created_at',
  ],
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end()
  const authed = await requireAuth(req)
  if (!authed.ok) return res.status(authed.status).json({ error: authed.error })

  const table = String(req.query.table || '')
  const cols = TABLE_COLUMNS[table]
  if (!cols) return res.status(400).json({ error: 'Invalid table' })

  return res.json({ columns: cols })
}
