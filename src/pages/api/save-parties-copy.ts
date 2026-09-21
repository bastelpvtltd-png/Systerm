import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '@/lib/serverAuth'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Records the Party's Copy PDF's Drive link on the CUSDEC row
// (cusdec.party_copy_url) — always a single link, a new save replaces
// whatever was there before (the caller confirms with the user first).
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  const authed = await requireAuth(req)
  if (!authed.ok) return res.status(authed.status).json({ error: authed.error })
  try {
    const { cusdec_id, drive_url, file_name } = req.body
    if (!cusdec_id || !drive_url) return res.status(400).json({ error: 'cusdec_id and drive_url required' })

    const { error } = await supabaseAdmin.from('cusdec')
      .update({ party_copy_url: drive_url })
      .eq('id', cusdec_id)
    if (error) return res.status(400).json({ error: error.message })

    // Saving the Party's Copy again (Replace) is the same document — update
    // its existing History row instead of adding a second one.
    const nowIso = new Date().toISOString()
    const partyFileName = file_name || 'party_copy.pdf'
    const { data: prevDoc } = await supabaseAdmin.from('uploaded_documents').select('id')
      .eq('doc_type', 'party_copy').eq('file_name', partyFileName)
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (prevDoc) {
      await supabaseAdmin.from('uploaded_documents')
        .update({ drive_url, uploaded_by: authed.userId, updated_at: nowIso })
        .eq('id', prevDoc.id)
    } else {
      await supabaseAdmin.from('uploaded_documents').insert({
        doc_type: 'party_copy', file_name: partyFileName, file_url: '', drive_url,
        uploaded_by: authed.userId, updated_at: nowIso,
      })
    }

    res.json({ ok: true })
  } catch (err: any) {
    console.error('[save-parties-copy] error:', err)
    res.status(500).json({ error: err.message })
  }
}