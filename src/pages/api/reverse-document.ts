import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { requireAdmin } from '@/lib/serverAuth'
import { deleteDriveFileByUrl } from '@/lib/driveFolders'
import { DOC_TYPE_TABLE } from '@/lib/docTables'

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// ── සිංහලෙන් ──────────────────────────────────────────────────────────────
// Proceed History එකේ "Reverse" (mode: 'step') සහ "Full Delete" (mode:
// 'full-delete') දෙකම මෙතනින්. Reverse — Notify → Pick → Mail/Download →
// Approved (count) කියන chain එකේ එක step එකක් විතරක් පස්සට. Full Delete —
// Drive file + database row (cusdec→cdn→barcode/boat_note ඇතුළුව සම්බන්ධ
// හැම එකක්ම) සම්පූර්ණයෙන්ම ain කරනවා, delete කරන්න කලින් deleted_records
// (Recycle Bin) එකට archive කරලා — වැරදුනොත් අතින් restore කරගන්න පුළුවන්.
// ──────────────────────────────────────────────────────────────────────────
//
// Both are admin-only (same gate as Processed History's other destructive
// actions — restore/delete). "Reverse" undoes exactly ONE stage per click,
// same convention the rest of this pipeline already uses (Return/Restore/
// Revert are each one step, not a jump-to-start):
//   1) Approved (counted in Balance) → back to pending approval, its
//      work_counts row removed. Refused if it's already in a sent Balance
//      report (same guard doc-approvals.ts's own "revert" uses).
//   2) Pending approval (already Mailed/Downloaded, waiting to be counted)
//      → back into My Picked Tasks (same as Processed History's existing
//      "Restore to Picked Tasks", just reachable from the same button as
//      every other step).
//   3) Currently picked (not yet Mailed/Downloaded) → back to Active Log
//      (same as "Return"/Resolve in My Picked Tasks).
//   4) Already just Notified, never picked — nothing further back; Notify
//      itself is never reversed.
// A document currently holding an active Boat Note Pending lock (see
// boat_note_locks) can't be reversed at all until that resolves on its own
// at Mail/Download — that's what "reserved" items being un-reversible means.
type Mode = 'step' | 'full-delete'

async function archive(table: string, row: any, driveUrlField: string | null, userId: string, userName: string) {
  try {
    await sb.from('deleted_records').insert({
      table_name: table, record_id: row.id, record_data: row,
      file_name: row.file_name ?? null, drive_url: driveUrlField ? (row[driveUrlField] ?? null) : null,
      deleted_by: userId, deleted_by_name: userName,
    })
  } catch (e: any) { console.error('[reverse-document] archive failed:', e.message) }
}

// Finds the structured-table row (cusdec/cdn/barcode/boat_notes) this
// document_uploads row was actually saved as, if any (Save may never have
// been ticked — a Mail/Notify-only send has no structured row at all).
// cusdec is matched by id (document_uploads.cusdec_id IS cusdec.id — same
// assumption doc-approvals.ts's cusdecCap() makes); everything else by its
// stored Drive link, since that's the one thing guaranteed to point at the
// exact same physical file.
async function resolveStructuredRow(doc: any): Promise<{ table: string; row: any } | null> {
  const table = DOC_TYPE_TABLE[doc.doc_type]
  if (!table) return null
  if (doc.doc_type === 'cusdec' && doc.cusdec_id) {
    const { data } = await sb.from('cusdec').select('*').eq('id', doc.cusdec_id).maybeSingle()
    if (data) return { table, row: data }
  }
  if (doc.drive_url) {
    const { data } = await sb.from(table).select('*').eq('pdf_url', doc.drive_url).maybeSingle()
    if (data) return { table, row: data }
  }
  return null
}

// Same relationships as docTables.ts's cascadeDeleteCusdec/cascadeDeleteCdn
// (CUSDEC owns its CDNs, a CDN owns its barcode + boat note), reimplemented
// here as a "list what this touches" pass rather than an immediate delete,
// so Full Delete can show the person what's about to disappear BEFORE
// anything is actually removed.
async function gatherCascade(root: { table: string; row: any }): Promise<{ table: string; row: any }[]> {
  const all: { table: string; row: any }[] = [root]
  if (root.table === 'cusdec' && root.row.code && root.row.number) {
    const { data: cdnRows } = await sb.from('cdn').select('*').eq('code', root.row.code).eq('cusdec_number', root.row.number)
    for (const c of (cdnRows || [])) {
      all.push({ table: 'cdn', row: c })
      if (c.container_no) {
        const { data: barcodeRows } = await sb.from('barcode').select('*').eq('container_no', c.container_no)
        for (const b of (barcodeRows || [])) all.push({ table: 'barcode', row: b })
        const { data: boatNotes } = await sb.from('boat_notes').select('*').eq('details->>container_no', c.container_no)
        for (const bn of (boatNotes || [])) all.push({ table: 'boat_notes', row: bn })
      }
    }
  } else if (root.table === 'cdn' && root.row.container_no) {
    const { data: barcodeRows } = await sb.from('barcode').select('*').eq('container_no', root.row.container_no)
    for (const b of (barcodeRows || [])) all.push({ table: 'barcode', row: b })
    const { data: boatNotes } = await sb.from('boat_notes').select('*').eq('details->>container_no', root.row.container_no)
    for (const bn of (boatNotes || [])) all.push({ table: 'boat_notes', row: bn })
  }
  return all
}

// Every Processed History row (document_uploads) whose Drive link matches
// one of the structured rows about to be removed — these must go together
// with the underlying file, or History keeps a row pointing at nothing.
async function findDocUploadsForRows(rows: { table: string; row: any }[]): Promise<any[]> {
  const urls = Array.from(new Set(rows.map(r => r.row.pdf_url).filter(Boolean)))
  if (!urls.length) return []
  const { data } = await sb.from('document_uploads').select('*').in('drive_url', urls)
  return data || []
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  const gated = await requireAdmin(req)
  if (!gated.ok) return res.status(gated.status).json({ error: gated.error })

  try {
    const { document_id, mode, confirmed } = req.body as { document_id: string; mode: Mode; confirmed?: boolean }
    if (!document_id || !mode) return res.status(400).json({ error: 'document_id and mode required' })

    const { data: prof } = await sb.from('profiles').select('username, full_name').eq('id', gated.userId).maybeSingle()
    const actingName = prof?.full_name || prof?.username || ''

    const { data: doc } = await sb.from('document_uploads').select('*').eq('id', document_id).maybeSingle()
    if (!doc) return res.status(404).json({ error: 'Document not found' })

    // ── Reverse (one step back) ───────────────────────────────────────────
    if (mode === 'step') {
      const { data: locks } = await sb.from('boat_note_locks').select('id').eq('document_id', document_id).limit(1)
      if (locks?.length) {
        return res.status(400).json({ error: 'This document currently holds an active Boat Note Pending lock — it releases on its own at Mail/Download and cannot be reversed until then.' })
      }

      const STAGE_ORDER = ['billing', 'boat_note', 'final_document', 'upload']
      const STAGE_TO_WORK_ACTION: Record<string, string> = { upload: 'approved-upload', billing: 'approved-billing', boat_note: 'approved-boat-note', final_document: 'approved-final-document' }
      const { data: approvedRows } = await sb.from('doc_approvals').select('*').eq('document_id', document_id).eq('status', 'approved')
      const approved = (approvedRows || []).sort((a: any, b: any) => STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage))[0]
      if (approved) {
        const wcAction = STAGE_TO_WORK_ACTION[approved.stage]
        if (wcAction) {
          const { data: wcRows } = await sb.from('work_counts').select('id, reported').eq('document_id', document_id).eq('action', wcAction)
          if ((wcRows || []).some((r: any) => r.reported)) {
            return res.status(400).json({ error: 'Cannot reverse: already included in a sent Balance report.' })
          }
          const wcIds = (wcRows || []).map((r: any) => r.id)
          if (wcIds.length) await sb.from('work_counts').delete().in('id', wcIds)
        }
        await sb.from('doc_approvals').update({ status: 'pending', decided_by: null, decided_by_name: null, decided_at: null }).eq('id', approved.id)
        await sb.from('pick_history_log').insert({ document_id, user_id: gated.userId, user_name: actingName, action: 'reverse' })
        return res.json({ ok: true, movedTo: 'pending_approval' })
      }

      const { data: pendingRows } = await sb.from('doc_approvals').select('id').eq('document_id', document_id).eq('status', 'pending')
      const { data: completedTask } = await sb.from('user_tasks').select('*').eq('document_id', document_id).eq('status', 'completed')
        .order('picked_at', { ascending: false }).limit(1).maybeSingle()
      if (pendingRows?.length || completedTask) {
        if (pendingRows?.length) await sb.from('doc_approvals').delete().in('id', pendingRows.map((r: any) => r.id))
        const { data: existingActive } = await sb.from('user_tasks').select('id').eq('document_id', document_id).eq('status', 'active').maybeSingle()
        if (!existingActive) {
          const userId = completedTask?.user_id || gated.userId
          const userName = completedTask?.user_name || actingName
          await sb.from('user_tasks').insert({ document_id, user_id: userId, user_name: userName, status: 'active' })
          await sb.from('document_uploads').update({ status: 'picked' }).eq('id', document_id)
        }
        await sb.from('pick_history_log').insert({ document_id, user_id: gated.userId, user_name: actingName, action: 'reverse' })
        return res.json({ ok: true, movedTo: 'picked' })
      }

      const { data: activeTask } = await sb.from('user_tasks').select('id').eq('document_id', document_id).eq('status', 'active').maybeSingle()
      if (activeTask) {
        await sb.from('user_tasks').update({ status: 'returned' }).eq('id', activeTask.id)
        await sb.from('dashboard_notifications').update({ is_active: true }).eq('document_id', document_id)
        await sb.from('document_uploads').update({ status: 'notified' }).eq('id', document_id)
        await sb.from('pick_history_log').insert({ document_id, user_id: gated.userId, user_name: actingName, action: 'reverse' })
        return res.json({ ok: true, movedTo: 'active_log' })
      }

      return res.status(400).json({ error: 'Already at Active Log — Notify itself cannot be reversed.' })
    }

    // ── Full Delete (Drive + Database, cascading) ─────────────────────────
    if (mode === 'full-delete') {
      const structured = await resolveStructuredRow(doc)
      const cascade = structured ? await gatherCascade(structured) : []
      const relatedDocs = cascade.length ? await findDocUploadsForRows(cascade) : []
      const allDocUploads = relatedDocs.some((d: any) => d.id === doc.id) ? relatedDocs : [doc, ...relatedDocs]

      if (!confirmed) {
        return res.json({
          needsConfirmation: true,
          files: allDocUploads.map((d: any) => d.file_name),
          count: allDocUploads.length,
        })
      }

      // Archive first (Recycle Bin can restore any of this later), only
      // then touch Drive/the live tables — a failed step after this point
      // never leaves something un-archived.
      for (const item of cascade) await archive(item.table, item.row, 'pdf_url', gated.userId, actingName)
      for (const d of allDocUploads) await archive('document_uploads', d, 'drive_url', gated.userId, actingName)

      for (const item of cascade) {
        if (item.row.pdf_url) await deleteDriveFileByUrl(item.row.pdf_url)
        await sb.from(item.table).delete().eq('id', item.row.id)
      }
      const cascadeUrls = new Set(cascade.map(c => c.row.pdf_url).filter(Boolean))
      for (const d of allDocUploads) {
        if (d.drive_url && !cascadeUrls.has(d.drive_url)) await deleteDriveFileByUrl(d.drive_url)
        await sb.from('pick_history_log').delete().eq('document_id', d.id)
        await sb.from('document_uploads').delete().eq('id', d.id)
      }

      return res.json({ ok: true, deleted: allDocUploads.length })
    }

    return res.status(400).json({ error: 'Unknown mode' })
  } catch (err: any) {
    console.error('[reverse-document] error:', err)
    return res.status(500).json({ error: err.message })
  }
}
