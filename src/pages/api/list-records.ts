import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const ALLOWED = ['cusdec', 'cdn', 'bill', 'boat_notes', 'uploaded_documents']

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end()
  const { table, filter, value, limit = '100' } = req.query

  if (!table || !ALLOWED.includes(table as string))
    return res.status(400).json({ error: 'Invalid table' })

  try {
    let query = supabaseAdmin
      .from(table as string)
      .select('*')
      .order('created_at', { ascending: false })
      .limit(Number(limit))

    if (filter && value) query = query.eq(filter as string, value as string)

    const { data, error } = await query
    if (error) return res.status(400).json({ error: error.message })
    res.json({ records: data || [] })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
}
