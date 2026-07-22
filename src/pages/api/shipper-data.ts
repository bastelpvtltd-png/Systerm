import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '@/lib/serverAuth'

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// The shipper portal's own data endpoint — deliberately separate from
// shipment-overview.ts (staff tool, much wider access) so a shipper account
// can never even reach a route that returns anything beyond their own
// completed + fully-paid shipments, no matter what's passed in.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const authed = await requireAuth(req)
  if (!authed.ok) return res.status(authed.status).json({ error: authed.error })

  const { data: prof } = await sb.from('profiles').select('is_shipper, shipper_name, full_name, username').eq('id', authed.userId).maybeSingle()
  if (!prof?.is_shipper || !prof.shipper_name) return res.status(403).json({ error: 'Not a shipper account' })
  const shipperName = prof.shipper_name.trim().toLowerCase()

  if (req.method === 'GET') {
    // Every CUSDEC whose exporter's first line matches this shipper —
    // "completed" ones (shipment_complete + payment_complete, i.e. Also
    // Done) always show; everything else only shows once it exists at all,
    // same visibility rule Assigned Shippers uses elsewhere for the
    // exporter-name match itself, matched the same normalized way.
    const { data: rows, error } = await sb.from('cusdec').select('*').order('created_at', { ascending: false }).limit(500)
    if (error) return res.status(500).json({ error: error.message })
    const mine = (rows || []).filter(c => (c.exporter || '').split('\n')[0].trim().toLowerCase() === shipperName)
    const completed = mine.filter(c => c.shipment_complete && c.payment_complete)
    const inProgress = mine.filter(c => !(c.shipment_complete && c.payment_complete))

    // Shipment Entries this account itself submitted — deliberately
    // filtered by created_by (this login), not by shipper name, so one
    // shipper account never sees another's entries even if two accounts
    // somehow share a shipper_name.
    const { data: myEntries } = await sb.from('temporary_shipments')
      .select('*').eq('created_by', authed.userId).order('created_at', { ascending: false })

    return res.json({ completed, inProgress, myEntries: myEntries || [] })
  }

  if (req.method === 'POST') {
    // Create a Shipment Entry — same table/fields/validation temp-shipments.ts's
    // own POST uses (the real Shipment Entry form's shape, incl. real_cap /
    // divide_cap sibling validation and the three Drive doc URLs, uploaded
    // client-side via the same /api/upload-to-drive every staff account
    // uses), but shipper is always forced to this account's own shipper_name
    // (never trusts whatever the client sent) and created_by is this login,
    // so "my entries" above only ever shows what this account actually submitted.
    const {
      invoice_number, packing_number, consignee, real_cap, cap: divide_cap,
      invoice_drive_url, packing_drive_url, license_drive_url,
    } = req.body
    if (!invoice_number) return res.status(400).json({ error: 'invoice_number required' })

    if (invoice_number) {
      const { data: siblings } = await sb.from('temporary_shipments')
        .select('real_cap, cap').eq('invoice_number', invoice_number)
      if (siblings && siblings.length > 0) {
        const existingRealCap = siblings.find(s => s.real_cap)?.real_cap
        if (existingRealCap && real_cap && existingRealCap !== real_cap) {
          return res.status(400).json({
            error: `Real CAP must match across all entries for invoice ${invoice_number} (existing: ${existingRealCap})`
          })
        }
        const effectiveRealCap = parseInt(real_cap || existingRealCap || '0', 10)
        if (divide_cap && effectiveRealCap > 0) {
          const existingSum = siblings.reduce((sum, s) => sum + (parseInt(s.cap || '0', 10)), 0)
          const newTotal = existingSum + parseInt(divide_cap, 10)
          if (newTotal > effectiveRealCap) {
            return res.status(400).json({
              error: `Divide CAPs would exceed Real CAP: ${existingSum} existing + ${divide_cap} new = ${newTotal} > ${effectiveRealCap}`
            })
          }
        }
      }
    }

    const code = prof.shipper_name.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4) || 'GEN'
    const now = new Date()
    const reference = `${code}-${now.getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`
    const { data, error } = await sb.from('temporary_shipments').insert({
      reference, shipper: prof.shipper_name, invoice_number, packing_number: packing_number || null,
      consignee: consignee || null, real_cap: real_cap || null, cap: divide_cap || null,
      invoice_drive_url: invoice_drive_url || null, packing_drive_url: packing_drive_url || null,
      license_drive_url: license_drive_url || null,
      created_by: authed.userId,
    }).select().single()
    if (error) return res.status(500).json({ error: error.message })
    return res.json({ ok: true, shipment: data })
  }

  res.status(405).end()
}
