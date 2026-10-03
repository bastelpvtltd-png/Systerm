import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { requireSection } from '@/lib/serverAuth'

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const SECTION = 'section:dashboard.automation-errors'

// Dashboard > "Automate Errors": every automation job that failed and hasn't been dismissed,
// with the step (Data / Navis / SLPA / Save document) and the exact field it failed on.
//   GET                       → { errors: [...] }
//   POST { id } | { all:true } → dismiss one / all (hides them; the job rows stay for history)
// Re-queuing the same CDN from Barcode Enter dismisses its old failure automatically.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const authed = await requireSection(req, SECTION)
  if (!authed.ok) return res.status(authed.status).json({ error: authed.error })
  try {
    if (req.method === 'GET') {
      const { data, error } = await sb.from('automation_jobs')
        .select('id, kind, cdn_id, container_no, cusdec_number, shipper, error, error_step, error_field, attempts, created_by_name, finished_at, has_screenshot, navis_done:result->navis_done')
        .eq('status', 'failed').is('error_dismissed_at', null)
        .order('finished_at', { ascending: false }).limit(200)
      if (error) return res.status(500).json({ error: `${error.message} (run sql/2026-10-02_barcode_errors.sql)` })
      return res.json({ errors: data || [] })
    }
    if (req.method === 'POST') {
      const now = new Date().toISOString()
      if (req.body?.all) {
        const { error } = await sb.from('automation_jobs').update({ error_dismissed_at: now }).eq('status', 'failed').is('error_dismissed_at', null)
        if (error) throw error
      } else if (req.body?.id) {
        const { error } = await sb.from('automation_jobs').update({ error_dismissed_at: now }).eq('id', String(req.body.id)).eq('status', 'failed')
        if (error) throw error
      } else return res.status(400).json({ error: 'id or all required' })
      return res.json({ ok: true })
    }
    res.status(405).end()
  } catch (err: any) {
    console.error('[automation-errors] error:', err)
    res.status(500).json({ error: err.message })
  }
}
