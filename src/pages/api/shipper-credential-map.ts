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
      const [{ data: cusdecs }, { data: map }, { data: creds }] = await Promise.all([
        sb.from('cusdec').select('exporter').not('exporter', 'is', null).limit(5000),
        sb.from('shipper_portal_credentials').select('*'),
        sb.from('automation_credentials').select('id, identity_name, url, username').order('identity_name'),
      ])
      // Only real exporters (from CUSDEC, the authoritative source — same list
      // users.tsx's shipper assignment uses) are selectable here. A saved
      // mapping whose shipper no longer matches any CUSDEC exporter (e.g. a
      // one-off spelling that was never the real name) is dropped from the
      // list rather than kept forever just because a row exists for it.
      const shippers = new Map<string, string>()
      for (const c of cusdecs || []) { const n = shipperName(c.exporter); if (n) shippers.set(shipperKey(n), n) }
      const mappings = (map || []).filter(m => shippers.has(m.shipper_key))
      return res.json({
        shippers: Array.from(shippers, ([key, name]) => ({ key, name })).sort((a, b) => a.name.localeCompare(b.name)),
        mappings,
        credentials: creds || [],
      })
    }

    if (req.method === 'POST') {
      const { shipper_name, navis_credential_id, slpa_credential_id, trico_credential_id } = req.body
      const name = shipperName(shipper_name)
      if (!name) return res.status(400).json({ error: 'shipper_name required' })
      const { data: match } = await sb.from('cusdec').select('exporter').ilike('exporter', `${name}%`).limit(1).maybeSingle()
      if (!match) return res.status(400).json({ error: `"${name}" is not an exporter name in the CUSDEC database — nothing saved` })
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
