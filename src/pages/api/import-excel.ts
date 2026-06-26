import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'

export const config = { api: { bodyParser: { sizeLimit: '20mb' } } }

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  try {
    const { base64, sheet } = req.body
    if (!base64) return res.status(400).json({ error: 'No file data' })

    const xlsx = require('xlsx')
    const buffer = Buffer.from(base64, 'base64')
    const wb = xlsx.read(buffer, { type: 'buffer' })

    const results: Record<string, any> = {}

    // Import CUSDEC DETAILS sheet
    if (wb.SheetNames.includes('CUSDEC DETAILS') && (!sheet || sheet === 'cusdec')) {
      const ws = wb.Sheets['CUSDEC DETAILS']
      const rows: any[][] = xlsx.utils.sheet_to_json(ws, { header: 1, defval: '' })
      const headers = rows[0] as string[]

      const cusdecRows = rows.slice(1).filter(r => r[0] && r[1])  // CODE and NUMBER required
      const cusdecData = cusdecRows.map(row => ({
        code:              String(row[headers.indexOf('CODE')] || ''),
        number:            String(row[headers.indexOf('NUMBER ')] || row[headers.indexOf('NUMBER')] || ''),
        date:              String(row[headers.indexOf('DATE ')] || row[headers.indexOf('DATE')] || ''),
        exporter:          String(row[headers.indexOf('Exporter')] || ''),
        consignee:         String(row[headers.indexOf('Consignee')] || ''),
        total_packages:    String(row[headers.indexOf('Total Packages')] || ''),
        country_of_export: String(row[headers.indexOf('Country of Export')] || ''),
        vessel:            String(row[headers.indexOf('Vessel')] || ''),
        voyage_no:         String(row[headers.indexOf('Voyage No./DaTE')] || row[headers.indexOf('Voyage No./DATE')] || ''),
        discharge_port:    String(row[headers.indexOf('Discharging')] || ''),
        location_of_goods: String(row[headers.indexOf('Location of Goods')] || ''),
        amount:            String(row[headers.indexOf('Amount')] || ''),
        hs_code:           String(row[headers.indexOf('(HS) Code')] || ''),
        gross_mass:        String(row[headers.indexOf('Gross Mass (K')] || ''),
        net_mass:          String(row[headers.indexOf('Net Mass (K')] || ''),
        bl_no:             String(row[headers.indexOf('BL No.')] || ''),
        cusdec_no:         String(row[headers.indexOf('NUMBER ')] || row[headers.indexOf('NUMBER')] || ''),
        status:            'pending',
      }))

      let cusdecOk = 0, cusdecFail = 0
      for (const rec of cusdecData) {
        // Check if number already exists
        const { data: existing } = await supabaseAdmin
          .from('cusdec').select('id').eq('number', rec.number).single()
        if (existing) { cusdecFail++; continue }

        const { error } = await supabaseAdmin.from('cusdec').insert(rec)
        if (error) cusdecFail++; else cusdecOk++
      }
      results.cusdec = { total: cusdecData.length, imported: cusdecOk, skipped: cusdecFail }
    }

    // Import CDN DETAILS sheet
    if (wb.SheetNames.includes('CDN DETAILS') && (!sheet || sheet === 'cdn')) {
      const ws = wb.Sheets['CDN DETAILS']
      const rows: any[][] = xlsx.utils.sheet_to_json(ws, { header: 1, defval: '' })
      const headers = rows[0] as string[]

      const cdnRows = rows.slice(1).filter(r => r[0] && r[headers.indexOf('CDN NO')] || r[headers.indexOf('CDN NO') >= 0 ? headers.indexOf('CDN NO') : -1])
      const cdnData = rows.slice(1).filter(r => r[0]).map(row => ({
        code:             String(row[headers.indexOf('CODE')] || ''),
        cusdec_number:    String(row[headers.indexOf('NUMBER')] || ''),
        shipper:          String(row[headers.indexOf('SHIPPER')] || '').replace(/\r\n/g, ' '),
        consignee:        String(row[headers.indexOf('CONSIGNEE')] || '').replace(/\r\n/g, ' '),
        voyage:           String(row[headers.indexOf('VOEGE')] || ''),
        voyage_date:      String(row[headers.indexOf('VOEGE DATE')] || ''),
        bl_no:            String(row[headers.indexOf('BL')] || ''),
        driver_name:      String(row[headers.indexOf('DRIVER NAME')] || ''),
        location:         String(row[headers.indexOf('LOCATION')] || ''),
        lorry_no:         String(row[headers.indexOf('LORRY ')] || row[headers.indexOf('LORRY')] || ''),
        trailer_no:       String(row[headers.indexOf('TRAILOR')] || ''),
        loading_port:     String(row[headers.indexOf('LOADING')] || ''),
        discharge_port:   String(row[headers.indexOf('DISCHARGE')] || ''),
        vessel:           String(row[headers.indexOf('VESEL')] || ''),
        voc:              String(row[headers.indexOf('VOC')] || ''),
        coc:              String(row[headers.indexOf('COC')] || ''),
        slpa_no:          String(row[headers.indexOf('SLPA')] || ''),
        pkg_no:           String(row[headers.indexOf('PKG NO')] || ''),
        pkg_type:         String(row[headers.indexOf('PKG TYPE')] || ''),
        volume:           String(row[headers.indexOf('VOLUME')] || ''),
        goods_description:String(row[headers.indexOf('GOODS')] || ''),
        container_no:     String(row[headers.indexOf('CONATIEN')] || ''),
        con_type:         String(row[headers.indexOf('CON TYPE')] || ''),
        seal_no:          String(row[headers.indexOf('SEAL')] || ''),
        marks:            String(row[headers.indexOf('MARK')] || ''),
        gross_mass:       String(row[headers.indexOf('GROSS')] || ''),
        cdn_no:           String(row[headers.indexOf('CDN NO')] || ''),
        status:           'pending',
      }))

      let cdnOk = 0, cdnFail = 0
      for (const rec of cdnData) {
        if (!rec.cdn_no) { cdnFail++; continue }
        const { data: existing } = await supabaseAdmin
          .from('cdn').select('id').eq('cdn_no', rec.cdn_no).single()
        if (existing) { cdnFail++; continue }

        const { error } = await supabaseAdmin.from('cdn').insert(rec)
        if (error) cdnFail++; else cdnOk++
      }
      results.cdn = { total: cdnData.length, imported: cdnOk, skipped: cdnFail }
    }

    res.json({ ok: true, results })
  } catch (err: any) {
    console.error('import-excel error:', err.message)
    res.status(500).json({ error: err.message })
  }
}
