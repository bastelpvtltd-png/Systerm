import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { buildReport } from './generate-balance-report'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// ── සිංහලෙන් ──────────────────────────────────────────────────────────────
// මාසික statement automatic හදන cron එක. දවසට වතාවක් run වුණත්
// වැඩක් කරන්නේ මාසෙ අන්තිම දවසේ විතරයි, ඒත් Automation tab එකේ
// Monthly Reports toggle එක ON නම් විතරයි. Manual "Generate" button
// එකේම buildReport() function එකමයි කැඳවන්නේ — දෙකම එකම දේ.
// ──────────────────────────────────────────────────────────────────────────
// Runs daily (see vercel.json — Vercel Hobby only allows once/day cron,
// same constraint cron-check-pending.ts is already built around) but only
// actually does anything on the LAST day of the month, and only when the
// Monthly Reports toggle in Automation is ON
// (app_settings.monthly_reports_enabled) — off by default so nothing
// generates unattended until someone turns it on. Calls the exact same
// buildReport() the manual "Generate" button in My Tasks calls — an
// automated statement is identical to a manually-generated one, same
// opening-balance carry-forward, same archiving.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const expected = process.env.CRON_SECRET
  const authHeader = req.headers.authorization || ''
  if (!expected || authHeader !== `Bearer ${expected}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const today = new Date()
  // Last UTC day of the month = one day before the 1st of next month, both
  // computed with Date.UTC so this never drifts with the server's local
  // timezone (the mismatch that bit the old "day === 10" check's cousin
  // logic elsewhere in this codebase).
  const lastDayOfMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0)).getUTCDate()
  if (today.getUTCDate() !== lastDayOfMonth) return res.json({ ok: true, skipped: 'not the last day of the month' })

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
