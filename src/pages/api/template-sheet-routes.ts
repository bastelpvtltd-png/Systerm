import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '@/lib/serverAuth'

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

// Per-shipper (TIN VAT) sheet routing for a Google Sheet template — see
// supabase/migrations/20260718_template_sheet_routes.sql. GET lists every
// route for a template; POST replaces the full set for one route_type
// ('fill' or 'print') at once (simpler than per-row CRUD from the admin UI,
// which always edits the whole list together); DELETE removes one row.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const authed = await requireAuth(req)
  if (!authed.ok) return res.status(authed.status).json({ error: authed.error })

  try {
    if (req.method === 'GET') {
      const template_id = String(req.query.template_id || '')
      if (!template_id) return res.status(400).json({ error: 'template_id required' })
      const { data, error } = await sb.from('template_sheet_routes').select('*').eq('template_id', template_id).order('created_at')
      if (error) throw error
      return res.json({ routes: data || [] })
    }

    if (req.method === 'POST') {
      const { template_id, route_type, routes } = req.body as {
        template_id: string; route_type: 'fill' | 'print'
        routes: Array<{ sheet_gid: string; sheet_name: string; tin_vat_list: string[] }>
      }
      if (!template_id || !route_type || !Array.isArray(routes)) return res.status(400).json({ error: 'template_id, route_type and routes required' })

      await sb.from('template_sheet_routes').delete().eq('template_id', template_id).eq('route_type', route_type)
      if (routes.length) {
        const rows = routes.filter(r => r.sheet_gid && r.tin_vat_list?.length).map(r => ({
          template_id, route_type, sheet_gid: r.sheet_gid, sheet_name: r.sheet_name, tin_vat_list: r.tin_vat_list,
        }))
        if (rows.length) {
          const { error } = await sb.from('template_sheet_routes').insert(rows)
          if (error) throw error
        }
      }
      return res.json({ ok: true })
    }

    res.status(405).end()
  } catch (err: any) {
    console.error('[template-sheet-routes] error:', err)
    res.status(500).json({ error: err.message })
  }
}
