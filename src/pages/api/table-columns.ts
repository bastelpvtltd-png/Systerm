import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '@/lib/serverAuth'

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

const ALLOWED_TABLES = ['cusdec', 'cdn']

// Fallback only used if DB query fails
const FALLBACK: Record<string, string[]> = {
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
  if (!ALLOWED_TABLES.includes(table)) return res.status(400).json({ error: 'Invalid table' })

  try {
    // Fetch actual column names from information_schema via service role
    const { data, error } = await (sb as any)
      .schema('information_schema')
      .from('columns')
      .select('column_name, ordinal_position')
      .eq('table_schema', 'public')
      .eq('table_name', table)
      .order('ordinal_position')

    if (!error && data?.length) {
      const columns: string[] = data.map((r: { column_name: string }) => r.column_name)
      return res.json({ columns })
    }

    // Fallback: try fetching a single row to infer columns
    const { data: rowData } = await sb.from(table).select('*').limit(1)
    if (rowData?.length) {
      const columns = Object.keys(rowData[0])
      return res.json({ columns })
    }

    // Last resort: hardcoded fallback
    return res.json({ columns: FALLBACK[table] || [] })
  } catch {
    return res.json({ columns: FALLBACK[table] || [] })
  }
}
