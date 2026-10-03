import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { requireAdmin } from '@/lib/serverAuth'
import { shipperKey, shipperName } from '@/lib/shipperName'

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

// Admin-only: which saved Navis / SLPA / Trico login each shipper uses.
// Passwords never pass through here — only credential ids and usernames.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const authed = await requireAdmin(req)
  if (!authed.ok) return res.status(authed.status).json({ error: authed.error })
  try {
    if (req.method === 'GET') {
      const [{ data: cdns }, { data: map }, { data: creds }] = await Promise.all([
        sb.from('cdn').select('shipper').not('shipper', 'is', null).limit(5000),
        sb.from('shipper_portal_credentials').select('*'),
        sb.from('automation_credentials').select('id, identity_name, username').order('identity_name'),
      ])
      const shippers = new Map<string, string>()
      for (const c of cdns || []) { const n = shipperName(c.shipper); if (n) shippers.set(shipperKey(n), n) }
      for (const m of map || []) shippers.set(m.shipper_key, m.shipper_name)
      return res.json({
        shippers: Array.from(shippers, ([key, name]) => ({ key, name })).sort((a, b) => a.name.localeCompare(b.name)),
        mappings: map || [],
        credentials: creds || [],
      })
    }

    if (req.method === 'POST') {
      const { shipper_name, navis_credential_id, slpa_credential_id, trico_credential_id } = req.body
      const name = shipperName(shipper_name)
      if (!name) return res.status(400).json({ error: 'shipper_name required' })
      const { error } = await sb.from('shipper_portal_credentials').upsert({
        shipper_key: shipperKey(name), shipper_name: name,
        navis_credential_id: navis_credential_id || null,
        slpa_credential_id: slpa_credential_id || null,
        trico_credential_id: trico_credential_id || null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'shipper_key' })
      if (error) throw error
      return res.json({ ok: true })
    }

    res.status(405).end()
  } catch (err: any) {
    console.error('[shipper-credential-map] error:', err)
    res.status(500).json({ error: err.message })
  }
}
