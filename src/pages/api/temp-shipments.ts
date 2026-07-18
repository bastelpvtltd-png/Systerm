import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '@/lib/serverAuth'
import { getDriveClient } from '@/lib/driveFolders'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Reference format: EXPORTER-YYYY-MMDD-N
// N = sequential count for this exporter code this year (across both tables so
// references stay unique even after shipments are merged into cusdec and deleted
// from temporary_shipments).
async function generateReference(shipper: string): Promise<string> {
  const code = (shipper || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4) || 'GEN'
  const now = new Date()
  const year = now.getFullYear()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  const prefix = `${code}-${year}-`

  const [{ count: tempCount }, { count: cusdecCount }] = await Promise.all([
    supabaseAdmin.from('temporary_shipments').select('*', { count: 'exact', head: true }).like('reference', `${prefix}%`).then(r => ({ count: r.count || 0 })),
    supabaseAdmin.from('cusdec').select('*', { count: 'exact', head: true }).like('reference', `${prefix}%`).then(r => ({ count: r.count || 0 })),
  ])
  const n = (tempCount as number) + (cusdecCount as number) + 1

  return `${code}-${year}-${mm}${dd}-${n}`
}

// CRUD for the "Shipment" tab's temporary_shipments table — entries live here
// until a matching CUSDEC upload merges and deletes them.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const authed = await requireAuth(req)
  if (!authed.ok) return res.status(authed.status).json({ error: authed.error })

  try {
    if (req.method === 'GET') {
      let query = supabaseAdmin.from('temporary_shipments').select('*').order('created_at', { ascending: false })
      const reference = String(req.query.reference || '').trim()
      if (reference) query = query.eq('reference', reference)

      // A picked row is invisible to everyone except the picker (and admins,
      // who can always see the full pool) — same "locked out" idea as the
      // document pick system, applied directly here since this row isn't a
      // document_uploads row.
      const { data: prof } = await supabaseAdmin.from('profiles').select('is_admin').eq('id', authed.userId).maybeSingle()
      if (!prof?.is_admin) query = query.or(`locked_by.is.null,locked_by.eq.${authed.userId}`)

      const { data, error } = await query
      if (error) return res.status(400).json({ error: error.message })
      return res.json({ shipments: data || [] })
    }

    if (req.method === 'POST') {
      const {
        shipper, invoice_number, packing_number, consignee,
        invoice_drive_url, packing_drive_url, license_drive_url,
        divide_invoice_drive_url, divide_packing_drive_url,
        real_cap, cap: divide_cap,
        new_invoice, new_packing,
      } = req.body
      if (!shipper || !invoice_number) {
        return res.status(400).json({ error: 'Shipper and Shipment Invoice Number are required' })
      }

      // Real CAP / Divide CAP validation across rows with same invoice_number
      if (invoice_number) {
        const { data: siblings } = await supabaseAdmin
          .from('temporary_shipments')
          .select('real_cap, cap')
          .eq('invoice_number', invoice_number)

        if (siblings && siblings.length > 0) {
          // All rows (including this new one) must share the same real_cap
          const existingRealCap = siblings.find(s => s.real_cap)?.real_cap
          if (existingRealCap && real_cap && existingRealCap !== real_cap) {
            return res.status(400).json({
              error: `Real CAP must match across all entries for invoice ${invoice_number} (existing: ${existingRealCap})`
            })
          }

          // Sum of all divide_caps must not exceed real_cap
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

      // When real doc URLs are provided, sync them to all existing rows with the same invoice_number
      const realDocUpdates: Record<string, any> = {}
      if (invoice_drive_url) realDocUpdates.invoice_drive_url = invoice_drive_url
      if (packing_drive_url) realDocUpdates.packing_drive_url = packing_drive_url
      if (license_drive_url) realDocUpdates.license_drive_url = license_drive_url
      if (real_cap) realDocUpdates.real_cap = real_cap
      if (Object.keys(realDocUpdates).length && invoice_number) {
        await supabaseAdmin.from('temporary_shipments').update(realDocUpdates).eq('invoice_number', invoice_number)
      }

      const reference = await generateReference(shipper)
      const { data, error } = await supabaseAdmin
        .from('temporary_shipments')
        .insert({
          reference,
          shipper,
          invoice_number,
          packing_number: packing_number || null,
          consignee: consignee || null,
          invoice_drive_url: invoice_drive_url || null,
          packing_drive_url: packing_drive_url || null,
          license_drive_url: license_drive_url || null,
          divide_invoice_drive_url: divide_invoice_drive_url || null,
          divide_packing_drive_url: divide_packing_drive_url || null,
          real_cap: real_cap || null,
          cap: divide_cap || null,
          new_invoice: new_invoice || null,
          new_packing: new_packing || null,
          created_by: authed.userId,
        })
        .select()
        .single()
      if (error) return res.status(400).json({ error: error.message })
      return res.json({ shipment: data })
    }

    if (req.method === 'PATCH') {
      // Bulk-sync real doc URL(s) to all rows that share an invoice_number —
      // triggered immediately after a real Invoice/Packing/License is uploaded
      // so all split entries for that invoice pick up the new Drive link at once.
      if (req.body._syncRealDoc) {
        const { invoice_number, invoice_drive_url, packing_drive_url, license_drive_url, real_cap } = req.body
        if (!invoice_number) return res.status(400).json({ error: 'invoice_number required for sync' })
        const patch: Record<string, any> = {}
        if (invoice_drive_url) patch.invoice_drive_url = invoice_drive_url
        if (packing_drive_url) patch.packing_drive_url = packing_drive_url
        if (license_drive_url) patch.license_drive_url = license_drive_url
        if (real_cap) patch.real_cap = real_cap
        if (Object.keys(patch).length) {
          await supabaseAdmin.from('temporary_shipments').update(patch).eq('invoice_number', invoice_number)
        }
        return res.json({ ok: true })
      }

      const id = String(req.body.id || '')
      if (!id) return res.status(400).json({ error: 'id required' })

      const { data: row } = await supabaseAdmin.from('temporary_shipments').select('created_by, invoice_number, locked_by').eq('id', id).single()
      const { data: prof } = await supabaseAdmin.from('profiles').select('is_admin').eq('id', authed.userId).single()
      if (!prof?.is_admin) {
        // Picked rows are locked to the picker only — overrides the normal
        // "owner can edit their own entry" rule while a pick is active.
        if (row?.locked_by) {
          if (row.locked_by !== authed.userId) return res.status(403).json({ error: 'This shipment is picked by someone else' })
        } else if (row?.created_by !== authed.userId) {
          return res.status(403).json({ error: 'You can only edit your own entries' })
        }
      }

      const { id: _id, created_at: _ca, created_by: _cb, reference: _ref, ...updates } = req.body

      // Real CAP / Divide CAP validation on edit
      const invoiceNum = updates.invoice_number || row?.invoice_number
      const newRealCap = updates.real_cap
      const newDivideCap = updates.cap

      if (invoiceNum && (newRealCap || newDivideCap)) {
        const { data: siblings } = await supabaseAdmin
          .from('temporary_shipments')
          .select('real_cap, cap')
          .eq('invoice_number', invoiceNum)
          .neq('id', id)

        if (siblings && siblings.length > 0) {
          const existingRealCap = siblings.find(s => s.real_cap)?.real_cap
          if (existingRealCap && newRealCap && existingRealCap !== newRealCap) {
            return res.status(400).json({
              error: `Real CAP must match across all entries for invoice ${invoiceNum} (existing: ${existingRealCap})`
            })
          }

          const effectiveRealCap = parseInt(newRealCap || existingRealCap || '0', 10)
          if (newDivideCap && effectiveRealCap > 0) {
            const existingSum = siblings.reduce((sum, s) => sum + (parseInt(s.cap || '0', 10)), 0)
            const newTotal = existingSum + parseInt(newDivideCap, 10)
            if (newTotal > effectiveRealCap) {
              return res.status(400).json({
                error: `Divide CAPs would exceed Real CAP: ${existingSum} others + ${newDivideCap} = ${newTotal} > ${effectiveRealCap}`
              })
            }
          }
        }
      }

      // Sync real doc changes to siblings
      const realDocUpdates: Record<string, any> = {}
      if (updates.invoice_drive_url) realDocUpdates.invoice_drive_url = updates.invoice_drive_url
      if (updates.packing_drive_url) realDocUpdates.packing_drive_url = updates.packing_drive_url
      if (updates.license_drive_url) realDocUpdates.license_drive_url = updates.license_drive_url
      if (updates.real_cap) realDocUpdates.real_cap = updates.real_cap
      if (Object.keys(realDocUpdates).length && invoiceNum) {
        await supabaseAdmin.from('temporary_shipments').update(realDocUpdates).eq('invoice_number', invoiceNum).neq('id', id)
      }

      const { data, error } = await supabaseAdmin.from('temporary_shipments').update(updates).eq('id', id).select().single()
      if (error) return res.status(400).json({ error: error.message })
      return res.json({ shipment: data })
    }

    if (req.method === 'DELETE') {
      const id = String(req.query.id || '')
      if (!id) return res.status(400).json({ error: 'id required' })

      const { data: row } = await supabaseAdmin
        .from('temporary_shipments').select('invoice_drive_url, packing_drive_url, license_drive_url, divide_invoice_drive_url, divide_packing_drive_url, invoice_number').eq('id', id).single()

      const { error } = await supabaseAdmin.from('temporary_shipments').delete().eq('id', id)
      if (error) return res.status(400).json({ error: error.message })

      // Only delete divide-specific Drive files — real invoice/packing/license may be shared
      // with sibling rows (same invoice_number), so don't delete those.
      const divideUrls = [row?.divide_invoice_drive_url, row?.divide_packing_drive_url].filter(Boolean)
      if (divideUrls.length) {
        try {
          const drive = getDriveClient()
          await Promise.all(divideUrls.map(async (url) => {
            const match = (url as string).match(/\/d\/([^/]+)/)
            if (match?.[1]) drive.files.delete({ fileId: match[1] }).catch(() => {})
          }))
        } catch {}
      }

      // Delete real docs only if no other row with same invoice_number exists
      if (row?.invoice_number) {
        const { count } = await supabaseAdmin.from('temporary_shipments')
          .select('*', { count: 'exact', head: true })
          .eq('invoice_number', row.invoice_number)
        if ((count || 0) === 0) {
          const realUrls = [row.invoice_drive_url, row.packing_drive_url, row.license_drive_url].filter(Boolean)
          if (realUrls.length) {
            try {
              const drive = getDriveClient()
              await Promise.all(realUrls.map(async (url) => {
                const match = (url as string).match(/\/d\/([^/]+)/)
                if (match?.[1]) drive.files.delete({ fileId: match[1] }).catch(() => {})
              }))
            } catch {}
          }
        }
      }

      return res.json({ ok: true })
    }

    res.status(405).end()
  } catch (err: any) {
    console.error('[temp-shipments] error:', err)
    res.status(500).json({ error: err.message })
  }
}
