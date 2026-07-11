import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { requireAdmin } from '@/lib/serverAuth'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'DELETE') return res.status(405).end()
  const authed = await requireAdmin(req)
  if (!authed.ok) return res.status(authed.status).json({ error: authed.error })
  const { id } = req.query
  if (!id) return res.status(400).json({ error: 'Missing id' })
  const { error } = await supabaseAdmin.from('uploaded_documents').delete().eq('id', id as string)
  if (error) return res.status(400).json({ error: error.message })
  res.json({ ok: true })
}
