import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { getTableColumns } from '@/lib/docTables'
import { requireAuth, requireSection } from '@/lib/serverAuth'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Whitelisted so this endpoint can't be pointed at arbitrary/system tables.
const ALLOWED_TABLES = ['cusdec', 'cdn', 'barcode', 'boat_notes', 'uploaded_documents', 'pdf_templates', 'messages', 'profiles']
// Tables whose rows reference an uploaded PDF — deleting the row here also
// deletes that Drive file, same as every other delete path in the app.
const DRIVE_URL_COLUMN: Record<string, string> = {
  cusdec: 'pdf_url', cdn: 'pdf_url', barcode: 'pdf_url', boat_notes: 'pdf_url',
  uploaded_documents: 'drive_url',
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const auth = await requireAuth(req)
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error })
  const table = String(req.query.table || '')
  if (!ALLOWED_TABLES.includes(table)) return res.status(400).json({ error: 'Unknown or disallowed table' })

  try {
    if (req.method === 'GET') {
      const { data, error } = await supabaseAdmin
        .from(table).select('*').order('created_at', { ascending: false }).limit(300)
      if (error) return res.status(400).json({ error: error.message })
      // Column list from the schema, not just from row 0 — so headers still
      // show (e.g. all of cusdec's columns) even when the table has no rows yet.
      let columns: string[] = data?.length ? Object.keys(data[0]) : []
      try {
        const schemaCols = await getTableColumns(table)
        if (schemaCols.length) columns = schemaCols
      } catch { /* management API not configured — fall back to row-derived columns */ }
      return res.json({ rows: data, columns })
    }

    if (req.method === 'PATCH') {
      const { id, updates } = req.body
      if (!id || !updates) return res.status(400).json({ error: 'id and updates required' })
      const { error } = await supabaseAdmin.from(table).update({ ...updates, updated_at: new Date().toISOString() }).eq('id', id)
      if (error) return res.status(400).json({ error: error.message })
      return res.json({ ok: true })
    }

    if (req.method === 'DELETE') {
      const gated = await requireSection(req, 'section:database.delete')
      if (!gated.ok) return res.status(gated.status).json({ error: gated.error })
      const { id, all } = req.query
      const urlColumn = DRIVE_URL_COLUMN[table]
      const { data: prof } = await supabaseAdmin.from('profiles').select('username, full_name').eq('id', auth.userId).maybeSingle()
      const deletedByName = prof?.full_name || prof?.username || ''

      // Soft-delete: the full row is archived to deleted_records (Recycle Bin)
      // before it's actually removed, and its Drive PDF is left alone (still
      // linked by the same pdf_url/drive_url) so Undo can bring the row back
      // exactly as it was — nothing about "what got deleted, by whom, when"
      // is lost, and nothing is truly gone until purged from the bin itself.
      if (all === 'true') {
        const { data: rows } = await supabaseAdmin.from(table).select('*')
        if (rows?.length) {
          await supabaseAdmin.from('deleted_records').insert(rows.map(row => ({
            table_name: table, record_id: (row as any).id, record_data: row,
            file_name: (row as any).file_name || null, drive_url: urlColumn ? (row as any)[urlColumn] : null,
            deleted_by: auth.userId, deleted_by_name: deletedByName,
          })))
        }
        const { error } = await supabaseAdmin.from(table).delete().gte('created_at', '1970-01-01')
        if (error) return res.status(400).json({ error: error.message })
        return res.json({ ok: true })
      }
      if (!id) return res.status(400).json({ error: 'id required' })
      const { data: row } = await supabaseAdmin.from(table).select('*').eq('id', id).maybeSingle()
      if (row) {
        await supabaseAdmin.from('deleted_records').insert({
          table_name: table, record_id: id, record_data: row,
          file_name: (row as any).file_name || null, drive_url: urlColumn ? (row as any)[urlColumn] : null,
          deleted_by: auth.userId, deleted_by_name: deletedByName,
        })
      }
      const { error } = await supabaseAdmin.from(table).delete().eq('id', id)
      if (error) return res.status(400).json({ error: error.message })
      return res.json({ ok: true })
    }

    res.status(405).end()
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
}
