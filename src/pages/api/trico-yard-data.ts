import { NextApiRequest, NextApiResponse } from 'next'
import { supabase } from '@/lib/supabase'

const PAGE_SIZE = 1000   // Supabase's max rows per request
const MAX_ROWS = 50000   // safety cap

// Returns EVERY trico_yard row (paged in 1000s — Supabase silently caps a
// single request at 1000, which is what was cutting the table off), newest
// update first. Search covers container, CUSDEC, CDN, vehicle and shipper.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  // strip characters that would break the PostgREST .or() filter syntax
  const search = String(req.query.search || '').replace(/[,()%*]/g, ' ').trim()

  try {
    const items: any[] = []
    for (let from = 0; from < MAX_ROWS; from += PAGE_SIZE) {
      let query = supabase
        .from('trico_yard')
        .select('*')
        // id as tiebreaker keeps paging stable (no skipped/duplicated rows)
        .order('updated_at', { ascending: false })
        .order('id', { ascending: true })
        .range(from, from + PAGE_SIZE - 1)

      if (search) {
        query = query.or(
          ['container_no', 'cusdec_no', 'cdn', 'veh_no', 'shipper'].map(c => `${c}.ilike.%${search}%`).join(',')
        )
      }

      const { data, error } = await query
      if (error) throw error
      items.push(...(data || []))
      if (!data || data.length < PAGE_SIZE) break
    }
    return res.status(200).json({ items, total: items.length })
  } catch (error: any) {
    return res.status(200).json({ items: [], warning: error.message })
  }
}