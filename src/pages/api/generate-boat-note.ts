import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  try {
    const { cusdec_id, cdn_ids } = req.body
    if (!cusdec_id || !cdn_ids?.length) return res.status(400).json({ error: 'Missing cusdec_id or cdn_ids' })

    // Fetch CUSDEC
    const { data: cusdec, error: ce } = await supabaseAdmin
      .from('cusdec').select('*').eq('id', cusdec_id).single()
    if (ce || !cusdec) return res.status(404).json({ error: 'CUSDEC not found' })

    // Fetch CDN rows
    const { data: cdns, error: cdne } = await supabaseAdmin
      .from('cdn').select('*').in('id', cdn_ids)
    if (cdne || !cdns?.length) return res.status(404).json({ error: 'CDN records not found' })

    // Build boat note data
    const boatNotes = cdns.map((cdn: any) => ({
      shipper:         cusdec.exporter || cdn.shipper || '',
      consignee:       cusdec.consignee || cdn.consignee || '',
      entry_no:        `E ${cusdec.number || cusdec.cusdec_no || ''}`,
      bl_no:           cdn.bl_no || cusdec.bl_no || '',
      slpa_no:         cdn.slpa_no || '',
      voyage:          cdn.voyage || cusdec.voyage_no || '',
      voyage_date:     cdn.voyage_date || '',
      vessel:          cdn.vessel || cusdec.vessel || '',
      terminal:        cdn.location || '',
      lorry_no:        cdn.lorry_no || '',
      trailer_no:      cdn.trailer_no || '',
      driver_name:     cdn.driver_name || '',
      container_no:    cdn.container_no || '',
      con_type:        cdn.con_type || '',
      seal_no:         cdn.seal_no || '',
      goods:           cdn.goods_description || 'WASTE PAPER',
      gross_mass:      cdn.gross_mass || cusdec.gross_mass || '',
      cdn_no:          cdn.cdn_no || '',
      pkg_no:          cdn.pkg_no || '',
      pkg_type:        cdn.pkg_type || '',
      voc:             cdn.voc || '',
      coc:             cdn.coc || '',
      loading_port:    cdn.loading_port || 'COLOMBO',
      discharge_port:  cdn.discharge_port || '',
    }))

    res.json({ ok: true, boat_notes: boatNotes, cusdec_no: cusdec.number || cusdec.cusdec_no })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
}
