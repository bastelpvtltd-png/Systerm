import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '@/lib/serverAuth'

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

const ALLOWED = ['cusdec', 'cdn']

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end()
  const authed = await requireAuth(req)
  if (!authed.ok) return res.status(authed.status).json({ error: authed.error })

  const table = String(req.query.table || '')
  if (!ALLOWED.includes(table)) return res.status(400).json({ error: 'Invalid table' })

  try {
    const { data: cols, error } = await sb
      .from('information_schema.columns' as any)
      .select('column_name')
      .eq('table_name', table)
      .eq('table_schema', 'public')
      .order('ordinal_position')
    if (error) throw error
    return res.json({ columns: (cols || []).map((r: any) => r.column_name) })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}
