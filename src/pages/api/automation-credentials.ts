import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { requireAdmin } from '@/lib/serverAuth'
import { encryptSecret } from '@/lib/credentialsCrypto'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Stores login credentials for third-party portals (Navis/SLPA/Trico) used by
// the Automation tab's RPA shortcuts. Admin-only in both directions: only an
// admin can add/view/delete entries, and the password is never sent back to
// the browser in plaintext — GET always masks it.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const authed = await requireAdmin(req)
    if (!authed.ok) return res.status(authed.status).json({ error: authed.error })

    if (req.method === 'GET') {
      const { data, error } = await supabaseAdmin.from('automation_credentials')
        .select('id, identity_name, url, username, created_at').order('identity_name')
      if (error) throw error
      return res.json({ credentials: data || [] })
    }

    if (req.method === 'POST') {
      const { identity_name, url, username, password } = req.body
      if (!identity_name || !url) return res.status(400).json({ error: 'identity_name and url are required' })
      const password_encrypted = password ? encryptSecret(password) : null
      const { error } = await supabaseAdmin.from('automation_credentials')
        .insert({ identity_name, url, username: username || null, password_encrypted })
      if (error) throw error
      return res.json({ ok: true })
    }

    if (req.method === 'DELETE') {
      const id = String(req.query.id || '')
      if (!id) return res.status(400).json({ error: 'id required' })
      const { error } = await supabaseAdmin.from('automation_credentials').delete().eq('id', id)
      if (error) throw error
      return res.json({ ok: true })
    }

    return res.status(405).end()
  } catch (err: any) {
    console.error('[automation-credentials] error:', err)
    res.status(500).json({ error: err.message })
  }
}
