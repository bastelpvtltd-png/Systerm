// Mirrors extracted document fields into the app's structured per-doc-type
// tables (cusdec, cdn, barcode, boat_notes) — not just the generic
// uploaded_documents.extracted_data jsonb blob. Uses the Supabase Management
// API for schema changes (adding a column for a newly-added custom field),
// since the service-role REST client can only do row-level CRUD, not DDL.

import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const MGMT_API = 'https://api.supabase.com/v1'
const PROJECT_REF = process.env.SUPABASE_PROJECT_REF
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN

export const DOC_TYPE_TABLE: Record<string, string> = {
  cusdec: 'cusdec',
  cdn: 'cdn',
  barcode: 'barcode',
  boat_note: 'boat_notes',
}

async function runManagementQuery(query: string): Promise<any[]> {
  const res = await fetch(`${MGMT_API}/projects/${PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  if (!res.ok) throw new Error(`Supabase management query failed: ${await res.text()}`)
  return res.json()
}

export async function getTableColumns(table: string): Promise<string[]> {
  const rows = await runManagementQuery(
    `select column_name from information_schema.columns where table_schema='public' and table_name='${table}'`
  )
  return rows.map((r: any) => r.column_name)
}

// Adds any keys that aren't already columns (as text) — lets a newly added
// custom field in the Documents popup get a real column with no manual step.
export async function ensureColumns(table: string, keys: string[]): Promise<void> {
  if (!ACCESS_TOKEN || !PROJECT_REF) return // management access not configured — skip silently
  const existing = await getTableColumns(table)
  const validKey = /^[a-z_][a-z0-9_]*$/ // guards against SQL injection via a crafted field key
  const missing = keys.filter(k => k && validKey.test(k) && !existing.includes(k))
  for (const key of missing) {
    await runManagementQuery(`alter table public."${table}" add column if not exists "${key}" text`)
  }
}

// Writes one document's extracted fields into its structured table.
// boat_notes keeps a jsonb `details` blob (matches its existing schema);
// cusdec/cdn/barcode get one real column per field.
export async function insertExtractedData(
  docType: string, data: Record<string, string>, driveUrl: string
): Promise<void> {
  const table = DOC_TYPE_TABLE[docType]
  if (!table) return

  if (table === 'boat_notes') {
    const { error } = await supabaseAdmin.from('boat_notes').insert({
      details: data, pdf_url: driveUrl, boat_note_no: data.entry_no || data.bl_no || null,
    })
    if (error) throw new Error(error.message)
    return
  }

  const dataKeys = Object.keys(data).filter(k => data[k])
  await ensureColumns(table, dataKeys)
  const columns = await getTableColumns(table)

  const row: Record<string, any> = { pdf_url: driveUrl }
  for (const [k, v] of Object.entries(data)) {
    if (v && columns.includes(k)) row[k] = v
  }
  const { error } = await supabaseAdmin.from(table).insert(row)
  if (error) throw new Error(error.message)
}
