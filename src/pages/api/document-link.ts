import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '@/lib/serverAuth'
import { deleteDriveFileByUrl } from '@/lib/driveFolders'

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

// Generic "one saved link per (CUSDEC, document_type)" record — see
// supabase/migrations/20260718_cusdec_document_links.sql. GET checks
// whether one already exists (so the UI can ask "replace?" before
// overwriting); POST deletes the old Drive file (if any) and writes the new
// link, always leaving exactly one row per (cusdec_id, document_type).
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const authed = await requireAuth(req)
  if (!authed.ok) return res.status(authed.status).json({ error: authed.error })

  try {
    if (req.method === 'GET') {
      const cusdec_id = String(req.query.cusdec_id || '')
      const document_type = String(req.query.document_type || '')
      if (!cusdec_id || !document_type) return res.status(400).json({ error: 'cusdec_id and document_type required' })
      const { data } = await sb.from('cusdec_document_links').select('*').eq('cusdec_id', cusdec_id).eq('document_type', document_type).maybeSingle()
      return res.json({ link: data || null })
    }

    if (req.method === 'POST') {
      const { cusdec_id, document_type, drive_url, file_name } = req.body as {
        cusdec_id: string; document_type: string; drive_url: string; file_name?: string
      }
      if (!cusdec_id || !document_type || !drive_url) return res.status(400).json({ error: 'cusdec_id, document_type and drive_url required' })

      const { data: existing } = await sb.from('cusdec_document_links').select('drive_url').eq('cusdec_id', cusdec_id).eq('document_type', document_type).maybeSingle()
      if (existing?.drive_url && existing.drive_url !== drive_url) {
        await deleteDriveFileByUrl(existing.drive_url)
      }

      const { data, error } = await sb.from('cusdec_document_links')
        .upsert({ cusdec_id, document_type, drive_url, file_name: file_name || null, updated_at: new Date().toISOString() }, { onConflict: 'cusdec_id,document_type' })
        .select().single()
      if (error) throw error
      return res.json({ ok: true, link: data })
    }

    res.status(405).end()
  } catch (err: any) {
    console.error('[document-link] error:', err)
    res.status(500).json({ error: err.message })
  }
}
