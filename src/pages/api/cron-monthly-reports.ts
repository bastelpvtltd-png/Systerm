import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { buildReport } from './generate-balance-report'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Runs daily (see vercel.json — Vercel Hobby only allows once/day cron,
// same constraint cron-check-pending.ts is already built around) but only
// actually does anything on the 10th, and only when the Monthly Reports
// toggle in Automation is ON (app_settings.monthly_reports_enabled) —
// off by default so nothing generates unattended until someone turns it on.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const expected = process.env.CRON_SECRET
  const authHeader = req.headers.authorization || ''
  if (!expected || authHeader !== `Bearer ${expected}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const today = new Date()
  if (today.getUTCDate() !== 10) return res.json({ ok: true, skipped: 'not the 10th' })

  const { data: setting } = await supabaseAdmin.from('app_settings').select('value').eq('key', 'monthly_reports_enabled').maybeSingle()
  if (setting?.value !== 'true') return res.json({ ok: true, skipped: 'monthly reports disabled' })

  const { data: users } = await supabaseAdmin.from('profiles').select('id').eq('is_shipper', false)
  const results: Record<string, any> = {}
  for (const u of users || []) {
    try {
      results[u.id] = await buildReport(u.id)
    } catch (e: any) {
      results[u.id] = { ok: false, error: e.message }
    }
  }
  res.json({ ok: true, generated: Object.keys(results).length, results })
}
