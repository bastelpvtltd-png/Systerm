import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Searches by shipper/code/CUSDEC number/container number and returns a
// shipment-wise overview: each matched CUSDEC, with the CDN rows that belong
// to it (matched by code + cusdec_number, one CDN row per container — the
// CUSDEC's CAP tells how many there should be), and each CDN's corresponding
// Barcode row (matched by container_no). This is the one linked set the app
// treats CUSDEC/CDN/Barcode as, not a per-document-type file browser.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end()
  try {
    const shipper = String(req.query.shipper || '').trim()
    const code = String(req.query.code || '').trim()
    const number = String(req.query.number || '').trim()
    const containerNo = String(req.query.container_no || '').trim()

    let cusdecRows: any[] = []

    if (containerNo) {
      // Trace backwards: container -> CDN row -> its (code, cusdec_number) -> CUSDEC
      const { data: cdnRows } = await supabaseAdmin.from('cdn').select('code, cusdec_number').ilike('container_no', `%${containerNo}%`)
      const pairs = new Map<string, { code: string; number: string }>()
      for (const r of cdnRows || []) {
        if (r.code && r.cusdec_number) pairs.set(`${r.code}|${r.cusdec_number}`, { code: r.code, number: r.cusdec_number })
      }
      for (const { code: c, number: n } of pairs.values()) {
        const { data } = await supabaseAdmin.from('cusdec').select('*').eq('code', c).eq('number', n).limit(1)
        if (data?.[0]) cusdecRows.push(data[0])
      }
    } else if (shipper || code || number) {
      let q = supabaseAdmin.from('cusdec').select('*')
      if (code) q = q.ilike('code', `%${code}%`)
      if (number) q = q.ilike('number', `%${number}%`)
      if (shipper) q = q.ilike('exporter', `%${shipper}%`)
      const { data } = await q.limit(50)
      cusdecRows = data || []

      // "Shipper" on the CDN side is its own column — a shipper search should
      // also catch CUSDECs whose CDN rows carry that shipper name even if the
      // CUSDEC's own exporter field reads differently.
      if (shipper) {
        const { data: cdnByShipper } = await supabaseAdmin.from('cdn').select('code, cusdec_number').ilike('shipper', `%${shipper}%`)
        const known = new Set(cusdecRows.map(c => `${c.code}|${c.number}`))
        for (const r of cdnByShipper || []) {
          const key = `${r.code}|${r.cusdec_number}`
          if (r.code && r.cusdec_number && !known.has(key)) {
            known.add(key)
            const { data } = await supabaseAdmin.from('cusdec').select('*').eq('code', r.code).eq('number', r.cusdec_number).limit(1)
            if (data?.[0]) cusdecRows.push(data[0])
          }
        }
      }
    }

    const overview = []
    for (const cusdec of cusdecRows) {
      const { data: cdns } = await supabaseAdmin.from('cdn').select('*').eq('code', cusdec.code).eq('cusdec_number', cusdec.number)
      const cdnWithBarcode = []
      for (const cdn of cdns || []) {
        const { data: barcodeRows } = cdn.container_no
          ? await supabaseAdmin.from('barcode').select('*').eq('container_no', cdn.container_no).limit(1)
          : { data: [] }
        cdnWithBarcode.push({ cdn, barcode: barcodeRows?.[0] || null })
      }
      overview.push({ cusdec, cdns: cdnWithBarcode })
    }

    res.json({ overview })
  } catch (err: any) {
    console.error('[shipment-overview] error:', err)
    res.status(500).json({ error: err.message })
  }
}
