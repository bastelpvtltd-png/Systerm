import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '@/lib/serverAuth'
import { readSync } from '@/lib/syncStatus'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const SORTABLE = ['terminal', 'vessel', 'voyage', 'opening_time', 'closing_time', 'etb', 'last_update', 'updated_at']

// Server-side paging + search + sort over the WHOLE vessel_triggers table.
//   ?page=1&pageSize=100&search=...&sortKey=etb&sortDir=asc
// Returns { items, total, page, pageSize } — `total` is the number of rows
// matching the search across every page, so the UI can show "Page X of Y".
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end()
  const authed = await requireAuth(req)
  if (!authed.ok) return res.status(authed.status).json({ error: authed.error })
  try {
    // strip characters that would break the PostgREST .or() filter syntax
    const search = String(req.query.search || '').replace(/[,()%*]/g, ' ').trim()
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1)
    const pageSize = Math.min(1000, Math.max(1, parseInt(String(req.query.pageSize || '100'), 10) || 100))
    const sortKey = SORTABLE.includes(String(req.query.sortKey)) ? String(req.query.sortKey) : 'updated_at'
    // default: most recently updated rows first
    const ascending = String(req.query.sortDir) === 'asc'

    const from = (page - 1) * pageSize
    let query = supabaseAdmin
      .from('vessel_triggers')
      .select('*', { count: 'exact' })
      .order(sortKey, { ascending })
      .order('id', { ascending: true }) // tiebreaker → stable paging
      .range(from, from + pageSize - 1)

    if (search) {
      query = query.or(`vessel.ilike.%${search}%,voyage.ilike.%${search}%,terminal.ilike.%${search}%`)
    }

    const { data, error, count } = await query
    if (error) throw error
    res.json({ items: data || [], total: count ?? (data || []).length, page, pageSize, lastSync: await readSync('vessel_trigger') })
  } catch (err: any) {
    console.error('[vessel-triggers] error:', err)
    res.status(500).json({ error: err.message })
  }
}