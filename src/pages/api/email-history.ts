import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '@/lib/serverAuth'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Preview's "Mail History" panel — only the signed-in user's own sent mail,
// not everyone's (per the user's own request: "eya yawwa ewwa witharai penne").
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end()
  try {
    const authed = await requireAuth(req)
    if (!authed.ok) return res.status(authed.status).json({ error: authed.error })
    const { data, error } = await supabaseAdmin
      .from('email_log').select('*').eq('sent_by', authed.userId)
      .order('sent_at', { ascending: false }).limit(200)
    if (error) throw error
    res.json({ items: data || [] })
  } catch (err: any) {
    console.error('[email-history] error:', err)
    res.status(500).json({ error: err.message })
  }
}
