import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '@/lib/serverAuth'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const PAGE_SIZE = 1000   // Supabase's max rows per request
const MAX_ROWS = 50000   // safety cap so a runaway table can't hang the request

// Lists the synced vessel schedule (vessel_triggers, kept up to date by
// vesselTrigger.ts via manual trigger or the scheduled cron).
// Returns EVERY row in the table (paged in 1000s) — the old version had a
// .limit(500) that cut off newer rows, and searched only within those 500.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end()
  const authed = await requireAuth(req)
  if (!authed.ok) return res.status(authed.status).json({ error: authed.error })
  try {
    // strip characters that would break the PostgREST .or() filter syntax
    const search = String(req.query.search || '').replace(/[,()%*]/g, ' ').trim()

    const items: any[] = []
    for (let from = 0; from < MAX_ROWS; from += PAGE_SIZE) {
      let query = supabaseAdmin
        .from('vessel_triggers')
        .select('*')
        // id as a tiebreaker keeps paging stable (no skipped/duplicated rows)
        .order('etb', { ascending: false })
        .order('id', { ascending: true })
        .range(from, from + PAGE_SIZE - 1)

      if (search) {
        query = query.or(`vessel.ilike.%${search}%,voyage.ilike.%${search}%,terminal.ilike.%${search}%`)
      }

      const { data, error } = await query
      if (error) throw error
      items.push(...(data || []))
      if (!data || data.length < PAGE_SIZE) break
    }

    res.json({ items, total: items.length })
  } catch (err: any) {
    console.error('[vessel-triggers] error:', err)
    res.status(500).json({ error: err.message })
  }
}