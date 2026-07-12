import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { requireAuth, requireSection } from '@/lib/serverAuth'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const PAGE_SIZE = 50

interface HistoryEvent { action: string; user_name: string; action_timestamp: string }

// Processed History — one row per document (not one row per action), so a
// document that got uploaded, notified, picked, returned, and re-picked
// doesn't turn into five separate log lines: each column shows the LATEST
// who/when for that action, and the full raw event list rides along per
// row (for a "view full history" popup) since a return-then-re-pick cycle
// can repeat more than once and squeezing all of it into the row itself
// doesn't fit.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    try {
      const authed = await requireAuth(req)
      if (!authed.ok) return res.status(authed.status).json({ error: authed.error })

      const { user, fileName, reason } = req.query
      const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1)
      const from = (page - 1) * PAGE_SIZE
      const to = from + PAGE_SIZE - 1

      let matchingIds: string[] | null = null
      if (user) {
        const { data: matches } = await supabaseAdmin
          .from('pick_history_log').select('document_id').ilike('user_name', `%${user}%`)
        matchingIds = [...new Set((matches || []).map(m => m.document_id).filter(Boolean))]
      }

      let query = supabaseAdmin
        .from('document_uploads')
        .select('id, file_name, doc_type, uploaded_by_name, created_at, reason, reason_note', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(from, to)

      if (fileName) query = query.ilike('file_name', `%${fileName}%`)
      if (reason) query = query.eq('reason', reason as string)
      if (user && matchingIds) {
        if (matchingIds.length) query = query.or(`uploaded_by_name.ilike.%${user}%,id.in.(${matchingIds.join(',')})`)
        else query = query.ilike('uploaded_by_name', `%${user}%`)
      }

      const { data: docs, error, count } = await query
      if (error) throw error

      const docIds = (docs || []).map(d => d.id)
      const { data: events } = docIds.length
        ? await supabaseAdmin.from('pick_history_log').select('document_id, action, user_name, action_timestamp')
            .in('document_id', docIds).order('action_timestamp', { ascending: true })
        : { data: [] as any[] }

      const eventsByDoc = new Map<string, HistoryEvent[]>()
      for (const e of events || []) {
        if (!eventsByDoc.has(e.document_id)) eventsByDoc.set(e.document_id, [])
        eventsByDoc.get(e.document_id)!.push({ action: e.action, user_name: e.user_name, action_timestamp: e.action_timestamp })
      }

      function latest(history: HistoryEvent[], action: string): HistoryEvent | null {
        const matches = history.filter(h => h.action === action)
        return matches.length ? matches[matches.length - 1] : null
      }

      const items = (docs || []).map(d => {
        const history = eventsByDoc.get(d.id) || []
        return {
          document_id: d.id,
          file_name: d.file_name,
          doc_type: d.doc_type,
          uploaded_by_name: d.uploaded_by_name,
          uploaded_at: d.created_at,
          reason: d.reason,
          reason_note: d.reason_note,
          notify: latest(history, 'notify'),
          pick: latest(history, 'pick'),
          return: latest(history, 'return'),
          mail: latest(history, 'mail'),
          download: latest(history, 'download'),
          look: latest(history, 'look'),
          history,
        }
      })

      return res.json({ items, page, pageSize: PAGE_SIZE, total: count || 0, totalPages: Math.max(1, Math.ceil((count || 0) / PAGE_SIZE)) })
    } catch (err: any) {
      console.error('[pick-history] error:', err)
      return res.status(500).json({ error: err.message })
    }
  }

  if (req.method === 'DELETE') {
    // Deleting audit-trail entries is a lot more sensitive than reading
    // them — grantable per-user via section:pick-history.delete (default:
    // only admins have it) instead of a hardcoded is_admin check, same
    // granular-panel-access model as Database/Recycle Bin. Deletes every
    // pick_history_log row for the document (the whole row this panel now
    // shows), not a single action-line — the document itself and its
    // extracted data are never touched.
    const gated = await requireSection(req, 'section:pick-history.delete')
    if (!gated.ok) return res.status(gated.status).json({ error: gated.error })
    try {
      const documentId = String(req.query.document_id || req.query.id || '')
      if (!documentId) return res.status(400).json({ error: 'document_id required' })

      const { data: rows } = await supabaseAdmin.from('pick_history_log').select('*').eq('document_id', documentId)
      if (rows?.length) {
        const { data: prof } = await supabaseAdmin.from('profiles').select('username, full_name').eq('id', gated.userId).maybeSingle()
        await supabaseAdmin.from('deleted_records').insert(rows.map(row => ({
          table_name: 'pick_history_log', record_id: row.id, record_data: row,
          file_name: null, drive_url: null,
          deleted_by: gated.userId, deleted_by_name: prof?.full_name || prof?.username || '',
        })))
      }
      const { error } = await supabaseAdmin.from('pick_history_log').delete().eq('document_id', documentId)
      if (error) return res.status(400).json({ error: error.message })
      return res.json({ ok: true })
    } catch (err: any) {
      console.error('[pick-history] delete error:', err)
      return res.status(500).json({ error: err.message })
    }
  }

  res.status(405).end()
}
