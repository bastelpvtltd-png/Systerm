import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'

// Creating an auth user requires the service-role key (admin API), which can
// only run server-side — the browser client was calling supabase.auth.admin.*
// with just the anon key, which silently does nothing. This is the real path.
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  try {
    const { username, password, full_name, position, is_admin, allowed_tabs } = req.body
    if (!username || !password) return res.status(400).json({ error: 'username and password required' })

    const email = `${username}@exportsys.local`
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email, password, email_confirm: true,
    })
    if (authError || !authData.user) return res.status(400).json({ error: authError?.message || 'Account creation failed' })

    const { error: profileError } = await supabaseAdmin.from('profiles').insert({
      id: authData.user.id, username, full_name: full_name || '', position: position || '',
      is_admin: !!is_admin, allowed_tabs: allowed_tabs || [],
    })
    if (profileError) {
      // Roll back the auth account so we don't leave an orphaned login with no profile
      await supabaseAdmin.auth.admin.deleteUser(authData.user.id)
      return res.status(400).json({ error: profileError.message })
    }

    res.json({ ok: true, id: authData.user.id })
  } catch (err: any) {
    console.error('[create-user] error:', err)
    res.status(500).json({ error: err.message })
  }
}
