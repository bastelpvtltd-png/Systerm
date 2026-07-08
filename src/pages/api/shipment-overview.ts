import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '@/lib/serverAuth'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Searches by shipper/code/CUSDEC number/container number/reference/invoice
// number and returns a shipment-wise overview: each matched CUSDEC, with the
// CDN rows that belong to it (matched by code + cusdec_number, one CDN row
// per container — the CUSDEC's CAP tells how many there should be), and each
// CDN's corresponding Barcode row (matched by container_no). This is the one
// linked set the app treats CUSDEC/CDN/Barcode as, not a per-document-type
// file browser.
//
// Access control: non-admin accounts only ever see CUSDECs whose exporter is
// in their profile's assigned_shippers list — enforced here server-side, not
// just hidden in the UI, since this is the one endpoint that can return
// another shipper's data.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end()
  try {
    const authed = await requireAuth(req)
    if (!authed.ok) return res.status(authed.status).json({ error: authed.error })
    const { data: prof } = await supabaseAdmin.from('profiles').select('is_admin, assigned_shippers').eq('id', authed.userId).single()
    const isAdmin = !!prof?.is_admin
    const assignedShippers: string[] = prof?.assigned_shippers || []
    if (!isAdmin && !assignedShippers.length) return res.json({ overview: [] })

    const shipper = String(req.query.shipper || '').trim()
    const code = String(req.query.code || '').trim()
    const number = String(req.query.number || '').trim()
    const containerNo = String(req.query.container_no || '').trim()
    const reference = String(req.query.reference || '').trim()
    const invoiceNumber = String(req.query.invoice_number || '').trim()

    let cusdecRows: any[] = []

    if (containerNo) {
      // Trace backwards: container -> CDN row -> its (code, cusdec_number) -> CUSDEC
      const { data: cdnRows } = await supabaseAdmin.from('cdn').select('code, cusdec_number').ilike('container_no', `%${containerNo}%`)
      const pairs = new Map<string, { code: string; number: string }>()
      for (const r of cdnRows || []) {
        if (r.code && r.cusdec_number) pairs.set(`${r.code}|${r.cusdec_number}`, { code: r.code, number: r.cusdec_number })
      }
      for (const { code: c, number: n } of Array.from(pairs.values())) {
        const { data } = await supabaseAdmin.from('cusdec').select('*').eq('code', c).eq('number', n).limit(1)
        if (data?.[0]) cusdecRows.push(data[0])
      }
    } else if (shipper || code || number || reference || invoiceNumber) {
      let q = supabaseAdmin.from('cusdec').select('*')
      if (code) q = q.ilike('code', `%${code}%`)
      if (number) q = q.ilike('number', `%${number}%`)
      if (shipper) q = q.ilike('exporter', `%${shipper}%`)
      if (reference) q = q.ilike('reference', `%${reference}%`)
      if (invoiceNumber) q = q.ilike('invoice_number', `%${invoiceNumber}%`)
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

    if (!isAdmin) {
      const allowed = new Set(assignedShippers.map(s => s.toLowerCase()))
      cusdecRows = cusdecRows.filter(c => allowed.has((c.exporter || '').split('\n')[0].trim().toLowerCase()))
    }

    const matchedBoatNoteIds = new Set<string>()
    const overview = []
    for (const cusdec of cusdecRows) {
      const { data: cdns } = await supabaseAdmin.from('cdn').select('*').eq('code', cusdec.code).eq('cusdec_number', cusdec.number)
      const cdnWithBarcode = []
      const containerNos: string[] = []
      for (const cdn of cdns || []) {
        const { data: barcodeRows } = cdn.container_no
          ? await supabaseAdmin.from('barcode').select('*').eq('container_no', cdn.container_no).limit(1)
          : { data: [] }
        cdnWithBarcode.push({ cdn, barcode: barcodeRows?.[0] || null })
        if (cdn.container_no) containerNos.push(cdn.container_no)
      }

      // Boat notes aren't linked by a foreign key — they carry the same
      // container number (inside their jsonb `details` blob) as the CDN row
      // they were made for, so that's the only reliable way to attach them
      // to this CUSDEC's shipment.
      let boatNotes: any[] = []
      if (containerNos.length) {
        const { data: bnRows } = await supabaseAdmin.from('boat_notes').select('*')
          .in('details->>container_no', containerNos)
        boatNotes = bnRows || []
        boatNotes.forEach(b => matchedBoatNoteIds.add(b.id))
      }

      overview.push({ cusdec, cdns: cdnWithBarcode, boatNotes })
    }

    // Boat notes whose shipper matches the search but whose container didn't
    // line up with any matched CDN above (e.g. the CDN row itself hasn't been
    // uploaded yet) — surfaced separately so a shipper/reference search still
    // finds them instead of silently dropping them.
    let orphanBoatNotes: any[] = []
    if (shipper) {
      const { data: bnByShipper } = await supabaseAdmin.from('boat_notes').select('*')
        .ilike('details->>shipper', `%${shipper}%`)
      orphanBoatNotes = (bnByShipper || []).filter(b => !matchedBoatNoteIds.has(b.id))
      if (!isAdmin) {
        const allowed = new Set(assignedShippers.map(s => s.toLowerCase()))
        orphanBoatNotes = orphanBoatNotes.filter(b => allowed.has(String(b.details?.shipper || '').trim().toLowerCase()))
      }
    }

    res.json({ overview, orphanBoatNotes })
  } catch (err: any) {
    console.error('[shipment-overview] error:', err)
    res.status(500).json({ error: err.message })
  }
}
