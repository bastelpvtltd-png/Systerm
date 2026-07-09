import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '@/lib/serverAuth'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Powers the Dashboard's four pending-work cards, each meaning something
// specific in the real cusdec -> cdn -> boat note -> export release
// pipeline (none of this maps to the generic `status` columns the old
// dashboard queries used):
//
// - Shipments Pending: temporary_shipments rows still sitting unmatched — a
//   Shipment Entry was opened but no CUSDEC has been uploaded/matched to it
//   yet (a matching CUSDEC upload merges + deletes the row, per
//   save-to-table.ts's auto-match step).
// - CDN Pending: CUSDECs whose CAP isn't filled yet (CDN row count < CAP).
// - Boat Note Pending: CUSDECs whose CAP *is* complete but not every CDN has
//   passed Boat Note check yet (not blue).
// - Export Release Pending: CUSDECs that passed Boat Note (blue) but haven't
//   passed Export Release yet (not green).
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end()
  try {
    const authed = await requireAuth(req)
    if (!authed.ok) return res.status(authed.status).json({ error: authed.error })

    const [{ data: shipments }, { data: cusdecs }, { data: cdns }] = await Promise.all([
      supabaseAdmin.from('temporary_shipments').select('id, reference, shipper, invoice_number, packing_number, created_at').order('created_at', { ascending: false }),
      supabaseAdmin.from('cusdec').select('id, code, number, exporter, cap, export_release_passed'),
      supabaseAdmin.from('cdn').select('id, code, cusdec_number, container_no, boat_note_passed'),
    ])

    const cdnPending: any[] = []
    const boatNotePending: any[] = []
    const releasePending: any[] = []

    for (const c of cusdecs || []) {
      const own = (cdns || []).filter(d => d.code === c.code && d.cusdec_number === c.number)
      const cap = parseInt(c.cap || '', 10)
      const capKnown = !!cap && !Number.isNaN(cap)
      const capComplete = !capKnown || own.length >= cap
      const allBoatNotePassed = own.length > 0 && own.every(d => d.boat_note_passed)

      if (capKnown && own.length < cap) {
        cdnPending.push({ cusdecId: c.id, number: c.number, exporter: c.exporter, cap, cdnCount: own.length })
      } else if (capComplete && !allBoatNotePassed) {
        boatNotePending.push({ cusdecId: c.id, number: c.number, exporter: c.exporter, cap: cap || null, cdnCount: own.length, passedCount: own.filter(d => d.boat_note_passed).length })
      }

      if (allBoatNotePassed && !c.export_release_passed) {
        releasePending.push({ cusdecId: c.id, number: c.number, exporter: c.exporter })
      }
    }

    res.json({
      shipmentsPending: { count: (shipments || []).length, items: shipments || [] },
      cdnPending: { count: cdnPending.length, items: cdnPending },
      boatNotePending: { count: boatNotePending.length, items: boatNotePending },
      releasePending: { count: releasePending.length, items: releasePending },
    })
  } catch (err: any) {
    console.error('[dashboard-summary] error:', err)
    res.status(500).json({ error: err.message })
  }
}
