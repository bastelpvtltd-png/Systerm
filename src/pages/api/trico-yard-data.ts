import { NextApiRequest, NextApiResponse } from 'next'
import { supabase } from '@/lib/supabase'

// Server-side paging + search over the WHOLE trico_yard table.
//   ?page=1&pageSize=1000&search=...
// Returns { items, total, page, pageSize, latestUpdate } — `total` counts every
// row matching the search (all pages); `latestUpdate` is the newest updated_at
// in the whole table, independent of the page/search being viewed.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  // strip characters that would break the PostgREST .or() filter syntax
  const search = String(req.query.search || '').replace(/[,()%*]/g, ' ').trim()
  const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1)
  const pageSize = Math.min(1000, Math.max(1, parseInt(String(req.query.pageSize || '1000'), 10) || 1000))

  try {
    const from = (page - 1) * pageSize
    let query = supabase
      .from('trico_yard')
      .select('*', { count: 'exact' })
      .order('updated_at', { ascending: false })
      .order('id', { ascending: true }) // tiebreaker → stable paging
      .range(from, from + pageSize - 1)

    if (search) {
      query = query.or(
        ['container_no', 'cusdec_no', 'cdn', 'veh_no', 'shipper'].map(c => `${c}.ilike.%${search}%`).join(',')
      )
    }

    const [{ data, error, count }, latest] = await Promise.all([
      query,
      supabase.from('trico_yard').select('updated_at').order('updated_at', { ascending: false }).limit(1),
    ])
    if (error) throw error

    return res.status(200).json({
      items: data || [],
      total: count ?? (data || []).length,
      page,
      pageSize,
      latestUpdate: latest.data?.[0]?.updated_at || null,
    })
  } catch (error: any) {
    return res.status(200).json({ items: [], total: 0, warning: error.message })
  }
}