import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '@/lib/serverAuth'
import { checkNotifyHistory } from '@/lib/notifyHistory'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Called before a Send — from Upload Docs' duplicate-replace flow and from
// Docs Create's Boat Note / Party's Copy / CustomDocPanel — to ask: "has
// THIS document already been Notified, for real, according to Processed
// History?" Matched the exact same way document-uploads.ts matches an
// existing row for a resave (single_per_cusdec by cusdec_id+doc_type,
// otherwise by file_name), then checked against pick_history_log's own
// 'notify' events — not guessed from "it's already saved" or "it's a
// resave", which is what the old notifyDisabled logic did and which was
// wrong whenever a document had been Saved (or resaved) without ever
// actually being Notified.
//
// This is a read-only pre-check for the UI (e.g. to grey out the Notify
// tick before Send is even opened). The real, authoritative gate is still
// server-side in document-uploads.ts at the moment of Send — this endpoint
// existing doesn't relax that.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  const authed = await requireAuth(req)
  if (!authed.ok) return res.status(authed.status).json({ error: authed.error })
  try {
    const { file_name, doc_type, cusdec_id, single_per_cusdec } = req.body
    if (!file_name && !(cusdec_id && doc_type)) {
      return res.status(400).json({ error: 'file_name, or cusdec_id + doc_type, required' })
    }
    const result = await checkNotifyHistory(supabaseAdmin, { file_name, doc_type, cusdec_id, single_per_cusdec })
    res.json(result)
  } catch (err: any) {
    console.error('[check-notify-history] error:', err)
    res.status(500).json({ error: err.message })
  }
}