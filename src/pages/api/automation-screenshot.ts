import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { requireSection } from '@/lib/serverAuth'

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

// GET ?id=<jobId> -> the screenshot (base64 jpeg) + debug text saved when that job failed or was a
// test-mode run. Allowed for people who can use Barcode Enter or see the Dashboard error panel.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end()
  let authed = await requireSection(req, 'section:automation.barcode-enter')
  if (!authed.ok) authed = await requireSection(req, 'section:dashboard.automation-errors')
  if (!authed.ok) return res.status(authed.status).json({ error: authed.error })
  const id = String(req.query.id || '')
  if (!id) return res.status(400).json({ error: 'id required' })
  const { data, error } = await sb.from('automation_jobs').select('screenshot, debug').eq('id', id).maybeSingle()
  if (error) return res.status(500).json({ error: error.message })
  if (!data?.screenshot && !data?.debug) return res.status(404).json({ error: 'No screenshot saved for this job' })
  res.json({ screenshot: data.screenshot || null, debug: data.debug || null })
}
