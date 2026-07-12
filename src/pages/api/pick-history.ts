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

      // Base this on pick_history_log, not document_uploads — a document
      // only belongs in Processed History once something's actually
      // happened to it (notify/pick/etc), and deleting all of its log rows
      // must make the row disappear for good rather than resurface on the
      // next refresh with blank action columns (document_uploads itself is
      // never touched by delete, on purpose — it just can't be the source
      // of which rows exist here anymore).
      let logQuery = supabaseAdmin.from('pick_history_log').select('document_id, action, user_name, action_timestamp')
      if (user) logQuery = logQuery.ilike('user_name', `%${user}%`)
      const { data: userFilteredEvents } = await logQuery
      const userMatchedIds = user ? new Set((userFilteredEvents || []).map(e => e.document_id)) : null

      const { data: allEvents } = await supabaseAdmin.from('pick_history_log').select('document_id, action, user_name, action_timestamp')
      const eventsByDoc = new Map<string, HistoryEvent[]>()
      for (const e of allEvents || []) {
        if (!eventsByDoc.has(e.document_id)) eventsByDoc.set(e.document_id, [])
        eventsByDoc.get(e.document_id)!.push({ action: e.action, user_name: e.user_name, action_timestamp: e.action_timestamp })
      }

      let candidateIds = Array.from(eventsByDoc.keys())
      if (userMatchedIds) candidateIds = candidateIds.filter(id => userMatchedIds.has(id))

      let docsQuery = supabaseAdmin.from('document_uploads').select('id, file_name, doc_type, uploaded_by_name, created_at, reason, reason_note')
        .in('id', candidateIds.length ? candidateIds : ['00000000-0000-0000-0000-000000000000'])
      if (fileName) docsQuery = docsQuery.ilike('file_name', `%${fileName}%`)
      if (reason) docsQuery = docsQuery.eq('reason', reason as string)
      const { data: docs, error } = await docsQuery
      if (error) throw error

      const latest = (history: HistoryEvent[], action: string): HistoryEvent | null => {
        const matches = history.filter(h => h.action === action)
        return matches.length ? matches[matches.length - 1] : null
      }

      const allItems = (docs || []).map(d => {
        const history = (eventsByDoc.get(d.id) || []).sort((a, b) => a.action_timestamp.localeCompare(b.action_timestamp))
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
          _sortKey: history.length ? history[history.length - 1].action_timestamp : d.created_at,
        }
      }).sort((a, b) => b._sortKey.localeCompare(a._sortKey))

      const total = allItems.length
      const from = (page - 1) * PAGE_SIZE
      const items = allItems.slice(from, from + PAGE_SIZE).map(({ _sortKey, ...rest }) => rest)

      return res.json({ items, page, pageSize: PAGE_SIZE, total, totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)) })
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
