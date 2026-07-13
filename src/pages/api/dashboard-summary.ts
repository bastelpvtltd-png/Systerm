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

    const [{ data: shipments }, { data: cusdecs }, { data: cdns }, { data: reasonDocsRaw }, { data: vesselTriggers }] = await Promise.all([
      supabaseAdmin.from('temporary_shipments').select('id, reference, shipper, invoice_number, packing_number, created_at').order('created_at', { ascending: false }),
      supabaseAdmin.from('cusdec').select('id, code, number, exporter, cap, export_release_passed'),
      supabaseAdmin.from('cdn').select('id, code, cusdec_number, container_no, vessel, voyage, boat_note_passed, export_release_passed'),
      // Reason-tagged Quick Upload queue — a document tagged reason:'CUSDEC
      // Passed' counts as pending only while it's still sitting unpicked in
      // the Incoming pool (dashboard_notifications.is_active) — Pick turns
      // that off, Return turns it back on, same as Incoming itself. It was
      // previously counting every such row regardless of pick state, so a
      // document someone had already picked (and was sitting in their My
      // Picked Tasks) kept inflating this count until it got Mailed/Downloaded.
      supabaseAdmin.from('document_uploads').select('id, file_name, reason, reason_note, created_at').eq('reason', 'CUSDEC Passed').order('created_at', { ascending: false }),
      supabaseAdmin.from('vessel_triggers').select('vessel, voyage, opening_time, closing_time, etb'),
    ])
    let reasonDocs = reasonDocsRaw || []
    if (reasonDocs.length) {
      const { data: activeNotifs } = await supabaseAdmin.from('dashboard_notifications')
        .select('document_id').eq('is_active', true).in('document_id', reasonDocs.map(d => d.id))
      const activeIds = new Set((activeNotifs || []).map(n => n.document_id))
      reasonDocs = reasonDocs.filter(d => activeIds.has(d.id))
    }

    const cdnPending: any[] = []
    const boatNotePending: any[] = []
    const releasePending: any[] = []

    // Closing Time Passed / vessel-trigger lookup — matched by voyage exactly
    // (trimmed/uppercased) plus a *fuzzy* vessel-name match (same leading
    // characters), not a full exact vessel-name match. CDN uploads and the
    // scraped Vessel Trigger schedule don't always spell the vessel name
    // identically (extra suffix, punctuation, etc.), and requiring an exact
    // match meant this silently matched nothing. Voyage is still the primary
    // key (same voyage number can appear against more than one vessel in the
    // schedule) — vessel is only there to disambiguate between candidates
    // sharing that voyage.
    const normVoyage = (v: string) => (v || '').trim().toUpperCase()
    const normVessel = (v: string) => (v || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
    function vesselFuzzyMatch(a: string, b: string): boolean {
      const na = normVessel(a), nb = normVessel(b)
      if (!na || !nb) return false
      const len = Math.min(5, na.length, nb.length)
      return na.slice(0, len) === nb.slice(0, len)
    }
    const triggersByVoyage = new Map<string, typeof vesselTriggers>()
    for (const t of vesselTriggers || []) {
      const key = normVoyage(t.voyage)
      if (!triggersByVoyage.has(key)) triggersByVoyage.set(key, [])
      triggersByVoyage.get(key)!.push(t)
    }
    function findTrigger(vessel: string, voyage: string) {
      if (!vessel || !voyage) return null
      const candidates = triggersByVoyage.get(normVoyage(voyage)) || []
      return candidates.find(t => vesselFuzzyMatch(vessel, t.vessel)) || null
    }

    const now = new Date()
    const closingPassed: any[] = []
    for (const d of cdns || []) {
      if (d.boat_note_passed || d.export_release_passed) continue
      const match = findTrigger(d.vessel, d.voyage)
      if (!match?.closing_time) continue
      const closingDate = new Date(String(match.closing_time).replace(' ', 'T'))
      if (Number.isNaN(closingDate.getTime()) || now <= closingDate) continue
      closingPassed.push({ cdnId: d.id, containerNo: d.container_no, cusdecNumber: d.cusdec_number, vessel: d.vessel, voyage: d.voyage, closingTime: match.closing_time })
    }

    for (const c of cusdecs || []) {
      const own = (cdns || []).filter(d => d.code === c.code && d.cusdec_number === c.number)
      const cap = parseInt(c.cap || '', 10)
      const capKnown = !!cap && !Number.isNaN(cap)
      const capComplete = !capKnown || own.length >= cap
      // Missing the capComplete check here let a CUSDEC still waiting on
      // more CDN uploads show up in Export Release Pending the moment its
      // few uploaded-so-far CDN rows all happened to individually pass Boat
      // Note — Automation's Export Release Check panel already required
      // capComplete (see isBoatNotePassed in automationChecks.ts), so the
      // two disagreed: Dashboard showed a pending count with nothing to
      // actually show in the Automation tab's eligible list.
      const allBoatNotePassed = capComplete && own.length > 0 && own.every(d => d.boat_note_passed)

      const containers = own
        .filter(d => d.vessel && d.voyage)
        .map(d => {
          const trigger = findTrigger(d.vessel, d.voyage)
          return {
            containerNo: d.container_no, vessel: d.vessel, voyage: d.voyage,
            trigger: trigger ? { openingTime: trigger.opening_time, closingTime: trigger.closing_time, etb: trigger.etb } : null,
          }
        })

      if (capKnown && own.length < cap) {
        cdnPending.push({ cusdecId: c.id, number: c.number, exporter: c.exporter, cap, cdnCount: own.length, containers })
      } else if (capComplete && !allBoatNotePassed) {
        boatNotePending.push({ cusdecId: c.id, number: c.number, exporter: c.exporter, cap: cap || null, cdnCount: own.length, passedCount: own.filter(d => d.boat_note_passed).length, containers })
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
