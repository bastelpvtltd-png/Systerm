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
  // single_per_cusdec (Docs Create: Boat Note, Party's Copy, Invoice...) —
  // matched by (cusdec_id, doc_type), since a regenerated file can have a
  // different name than the one originally saved.
  // Otherwise (Upload Docs' duplicate-replace) — matched by file_name only,
  // since one CUSDEC can own many CDNs/barcodes there and (cusdec_id,
  // doc_type) would not be unique.
  single_per_cusdec?: boolean
}

export async function findExistingDocumentUpload(
  supabaseAdmin: SupabaseClient,
  { file_name, doc_type, cusdec_id, single_per_cusdec }: NotifyMatchParams
): Promise<{ id: string } | null> {
  if (single_per_cusdec && cusdec_id && doc_type) {
    const { data } = await supabaseAdmin
      .from('document_uploads')
      .select('id')
      .eq('cusdec_id', cusdec_id).eq('doc_type', doc_type)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (data) return data
  }
  if (file_name) {
    let q = supabaseAdmin.from('document_uploads').select('id').eq('file_name', file_name)
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
