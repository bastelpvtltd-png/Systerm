import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Feeds the Shipment Overview search boxes with real values from the
// database instead of free-typed guesses — shipper/code/number/container
// are all suggestion lists (still editable by hand), and each narrows the
// others: pick a shipper and the code/number/container lists shrink to
// just that shipper's CUSDECs, pick a code and number narrows further, etc.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end()
  try {
    const shipper = String(req.query.shipper || '').trim()
    const code = String(req.query.code || '').trim()
    const number = String(req.query.number || '').trim()

    let cusdecQuery = supabaseAdmin.from('cusdec').select('code, number, exporter').limit(1000)
    if (code) cusdecQuery = cusdecQuery.eq('code', code)
    if (number) cusdecQuery = cusdecQuery.eq('number', number)
    const { data: cusdecRows } = await cusdecQuery

    // Shipper suggestions always come from the full table (unfiltered by
    // shipper itself) — first line only, since "exporter" is a multi-line
    // name+address blob.
    const { data: allCusdec } = await supabaseAdmin.from('cusdec').select('exporter').limit(1000)
    const shippers = [...new Set((allCusdec || []).map(r => (r.exporter || '').split('\n')[0].trim()).filter(Boolean))].sort()

    const shipperFiltered = shipper
      ? (cusdecRows || []).filter(r => (r.exporter || '').split('\n')[0].trim().toLowerCase().includes(shipper.toLowerCase()))
      : (cusdecRows || [])

    const codes = [...new Set(shipperFiltered.map(r => r.code).filter(Boolean))].sort()
    const numbers = [...new Set(shipperFiltered.map(r => r.number).filter(Boolean))].sort()

    // Containers: CDN rows belonging to whichever CUSDECs matched above.
    let containers: string[] = []
    if (shipperFiltered.length) {
      const pairs = shipperFiltered.map(r => `(code.eq.${r.code},cusdec_number.eq.${r.number})`)
      // Supabase JS doesn't do OR-of-ANDs cleanly across many pairs — fetch
      // per matching CUSDEC's code/number set instead (small result sets in
      // practice: a handful of CUSDECs per shipper).
      const codeSet = [...new Set(shipperFiltered.map(r => r.code))]
      const numberSet = [...new Set(shipperFiltered.map(r => r.number))]
      let cdnQuery = supabaseAdmin.from('cdn').select('container_no, code, cusdec_number').limit(1000)
      if (codeSet.length) cdnQuery = cdnQuery.in('code', codeSet)
      const { data: cdnRows } = await cdnQuery
      containers = [...new Set((cdnRows || [])
        .filter(r => numberSet.includes(r.cusdec_number))
        .map(r => r.container_no).filter(Boolean))].sort()
    }

    res.json({ shippers, codes, numbers, containers })
  } catch (err: any) {
    console.error('[shipment-overview-options] error:', err)
    res.status(500).json({ error: err.message })
  }
}
