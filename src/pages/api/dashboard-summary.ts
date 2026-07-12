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

    const [{ data: shipments }, { data: cusdecs }, { data: cdns }, { data: reasonDocs }, { data: vesselTriggers }] = await Promise.all([
      supabaseAdmin.from('temporary_shipments').select('id, reference, shipper, invoice_number, packing_number, created_at').order('created_at', { ascending: false }),
      supabaseAdmin.from('cusdec').select('id, code, number, exporter, cap, export_release_passed'),
      supabaseAdmin.from('cdn').select('id, code, cusdec_number, container_no, vessel, voyage, boat_note_passed, export_release_passed'),
      // Reason-tagged Quick Upload queue — a document tagged reason:'CUSDEC
      // Passed' counts as pending until whoever picks it does Mail/Download
      // (which deletes it — see delete-reason-document.ts), so the count is
      // just "how many of these rows currently exist", not a status field.
      supabaseAdmin.from('document_uploads').select('id, file_name, reason, reason_note, created_at').eq('reason', 'CUSDEC Passed').order('created_at', { ascending: false }),
      supabaseAdmin.from('vessel_triggers').select('vessel, voyage, closing_time'),
    ])

    const cdnPending: any[] = []
    const boatNotePending: any[] = []
    const releasePending: any[] = []

    // Closing Time Passed — only checked for containers that aren't already
    // "not green" (Boat Note passed) or "not blue" (Export Release passed);
    // once either is true the closing deadline no longer matters. Matched
    // by vessel AND voyage together (not voyage alone) since the same
    // voyage number can show up against more than one vessel in the
    // schedule, each with its own closing time.
    const closingKey = (vessel: string, voyage: string) => `${(vessel || '').trim().toUpperCase()}|||${(voyage || '').trim().toUpperCase()}`
    const closingByKey = new Map((vesselTriggers || []).map(v => [closingKey(v.vessel, v.voyage), v.closing_time]))
    const now = new Date()
    const closingPassed: any[] = []
    for (const d of cdns || []) {
      if (d.boat_note_passed || d.export_release_passed) continue
      if (!d.vessel || !d.voyage) continue
      const closingTime = closingByKey.get(closingKey(d.vessel, d.voyage))
      if (!closingTime) continue
      const closingDate = new Date(String(closingTime).replace(' ', 'T'))
      if (Number.isNaN(closingDate.getTime()) || now <= closingDate) continue
      closingPassed.push({ cdnId: d.id, containerNo: d.container_no, cusdecNumber: d.cusdec_number, vessel: d.vessel, voyage: d.voyage, closingTime })
    }

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
      pendingCusdecPassed: { count: (reasonDocs || []).length, items: reasonDocs || [] },
      closingPassed: { count: closingPassed.length, items: closingPassed },
    })
  } catch (err: any) {
    console.error('[dashboard-summary] error:', err)
    res.status(500).json({ error: err.message })
  }
}
