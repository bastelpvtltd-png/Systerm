import type { SupabaseClient } from '@supabase/supabase-js'

// Shared "is this document already on record as Notified?" logic, used by
// BOTH check-notify-history.ts (frontend pre-check, before a Send is even
// opened) and document-uploads.ts (server-side, the actual gate on whether
// a notify fires). Both must resolve the SAME existing document_uploads
// row and answer the SAME question the SAME way, or the UI and the DB can
// end up disagreeing about whether a document was already notified.
//
// This intentionally does NOT ask "does a document_uploads row already
// exist for this document" (that row can exist from a Save-only send that
// never notified anyone) and does NOT ask "does it already have a saved
// Drive link" (same problem). The only real source of truth is Processed
// History's own raw log — pick_history_log — which is written once, and
// only once, at the moment a 'notify' actually happens (see
// document-uploads.ts).

export interface NotifyMatchParams {
  file_name?: string
  doc_type?: string
  cusdec_id?: string
  // Docs Create (Boat Note, Party's Copy, Invoice...) is one-per-CUSDEC —
  // pass this so the PRIMARY match is (cusdec_id, doc_type), since a
  // regenerated file can have a different name than the one originally
  // saved. Every caller still gets the file_name fallback underneath it
  // (see findExistingDocumentUpload) — this only decides which match is
  // tried FIRST, and whether the file_name fallback is also scoped to
  // doc_type (needed there since Docs Create reuses generic names).
  single_per_cusdec?: boolean
}

export async function findExistingDocumentUpload(
  supabaseAdmin: SupabaseClient,
  { file_name, doc_type, cusdec_id, single_per_cusdec }: NotifyMatchParams
): Promise<{ id: string; reason: string | null; reason_note: string | null } | null> {
  if (single_per_cusdec && cusdec_id && doc_type) {
    const { data } = await supabaseAdmin
      .from('document_uploads')
      .select('id, reason, reason_note')
      .eq('cusdec_id', cusdec_id).eq('doc_type', doc_type)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (data) return data
  }
  // Always fall back to a file_name match — regardless of whether the
  // caller flagged this as a resave/single_per_cusdec send. Processed
  // History (document_uploads) must never end up with two rows for the
  // exact same file just because the page that sent it didn't happen to
  // recognise this particular resend as a duplicate (e.g. Upload Docs'
  // own structured-table duplicate check missing it for some reason) — if
  // a row with this file_name already exists, THIS send is an update to
  // that same row, full stop.
  if (file_name) {
    let q = supabaseAdmin.from('document_uploads').select('id, reason, reason_note').eq('file_name', file_name)
    if (single_per_cusdec && doc_type) q = q.eq('doc_type', doc_type)
    const { data } = await q.order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (data) return data
  }
  return null
}

export async function wasAlreadyNotified(
  supabaseAdmin: SupabaseClient,
  documentId: string
): Promise<{ alreadyNotified: boolean; notifiedAt?: string; notifiedBy?: string }> {
  const { data } = await supabaseAdmin
    .from('pick_history_log')
    .select('user_name, action_timestamp')
    .eq('document_id', documentId)
    .eq('action', 'notify')
    .order('action_timestamp', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!data) return { alreadyNotified: false }
  return { alreadyNotified: true, notifiedAt: data.action_timestamp, notifiedBy: data.user_name }
}

// Convenience wrapper for callers that only have the match params (the
// frontend pre-check) and don't need the raw existing-row id for anything
// else.
export async function checkNotifyHistory(
  supabaseAdmin: SupabaseClient,
  params: NotifyMatchParams
): Promise<{ alreadyNotified: boolean; documentId?: string; notifiedAt?: string; notifiedBy?: string }> {
  const existing = await findExistingDocumentUpload(supabaseAdmin, params)
  if (!existing) return { alreadyNotified: false }
  const result = await wasAlreadyNotified(supabaseAdmin, existing.id)
  return { ...result, documentId: existing.id }
}