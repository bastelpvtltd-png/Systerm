import { createClient } from '@supabase/supabase-js'

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

// Same "no logged-in user" fallback autoCreateDocs.ts uses: try a NULL user
// first, and if the table refuses NULL retry with an admin profile id.
export async function adminUserId(): Promise<string | null> {
  const { data } = await sb.from('profiles').select('id').eq('is_admin', true).limit(1).maybeSingle()
  return data?.id ?? null
}

export async function insertWithUserFallback(table: string, row: Record<string, any>, userCols: string[], wantRow = false): Promise<{ data: any; error: any }> {
  const attempt = (uid: string | null) => {
    const r: Record<string, any> = { ...row }
    for (const c of userCols) r[c] = uid
    const q = sb.from(table).insert(r)
    return wantRow ? q.select().single() : q
  }
  let res: any = await attempt(null)
  if (res.error) {
    const uid = await adminUserId()
    if (uid) res = await attempt(uid)
  }
  return { data: res.data ?? null, error: res.error ?? null }
}

// Puts an automation-made document into the Activity Log (document_uploads +
// dashboard_notifications + pick_history_log) so anyone can pick it up — the same
// three writes a manual Send with Notify ticked ends up making.
export async function notifyToActivityLog(p: {
  fileName: string; driveLink: string; docType: string; reason: string
  extractedData?: Record<string, any>; cusdecId?: string | null; byName?: string
}): Promise<{ documentId: string | null; error: string | null }> {
  const by = p.byName || 'Automation'
  const { data: doc, error } = await insertWithUserFallback('document_uploads', {
    file_name: p.fileName, drive_url: p.driveLink, doc_type: p.docType,
    extracted_data: p.extractedData || null,
    is_saved_to_db: true, status: 'notified',
    uploaded_by_name: by, reason: p.reason, cusdec_id: p.cusdecId || null,
  }, ['uploaded_by'], true)
  if (error || !doc) return { documentId: null, error: `Activity Log entry failed: ${error?.message || 'unknown error'}` }

  const { error: nErr } = await insertWithUserFallback('dashboard_notifications', {
    document_id: doc.id, uploaded_by_name: by,
  }, ['uploaded_by'])
  if (nErr) return { documentId: doc.id, error: `Activity Log entry failed: ${nErr.message}` }

  await insertWithUserFallback('pick_history_log', {
    document_id: doc.id, user_name: by, action: 'notify',
    pdf_notify_user: by, notify_update_time: new Date().toISOString(),
  }, ['user_id'])
  return { documentId: doc.id, error: null }
}
