import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '@/lib/serverAuth'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// CRUD for the "Shipment" tab's temporary_shipments table — entries live
// here (not in cusdec/cdn) until a matching CUSDEC upload merges and
// deletes them (see save-to-table.ts's cusdec auto-match step).
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const authed = await requireAuth(req)
  if (!authed.ok) return res.status(authed.status).json({ error: authed.error })

  try {
    if (req.method === 'GET') {
      const { data, error } = await supabaseAdmin
        .from('temporary_shipments')
        .select('*')
        .order('created_at', { ascending: false })
      if (error) return res.status(400).json({ error: error.message })
      return res.json({ shipments: data || [] })
    }

    if (req.method === 'POST') {
      const { reference, shipper, invoice_number, packing_number, consignee } = req.body
      if (!shipper || !invoice_number) {
        return res.status(400).json({ error: 'Shipper and Shipment Invoice Number are required' })
      }
      const { data, error } = await supabaseAdmin
        .from('temporary_shipments')
        .insert({
          reference: reference || null,
          shipper,
          invoice_number,
          packing_number: packing_number || null,
          consignee: consignee || null,
          created_by: authed.userId,
        })
        .select()
        .single()
      if (error) return res.status(400).json({ error: error.message })
      return res.json({ shipment: data })
    }

    if (req.method === 'DELETE') {
      const id = String(req.query.id || '')
      if (!id) return res.status(400).json({ error: 'id required' })
      const { error } = await supabaseAdmin.from('temporary_shipments').delete().eq('id', id)
      if (error) return res.status(400).json({ error: error.message })
      return res.json({ ok: true })
    }

    res.status(405).end()
  } catch (err: any) {
    console.error('[temp-shipments] error:', err)
    res.status(500).json({ error: err.message })
  }
}
