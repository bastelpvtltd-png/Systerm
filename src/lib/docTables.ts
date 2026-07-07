// Mirrors extracted document fields into the app's structured per-doc-type
// tables (cusdec, cdn, barcode, boat_notes) — not just the generic
// uploaded_documents.extracted_data jsonb blob. Uses the Supabase Management
// API for schema changes (adding a column for a newly-added custom field),
// since the service-role REST client can only do row-level CRUD, not DDL.

import { createClient } from '@supabase/supabase-js'
import { deleteDriveFileByUrl } from './driveFolders'

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

// Structural columns that must never be dropped even if a matching field key
// somehow appears (id/created_at/etc. predate the dynamic column system).
const PROTECTED_COLUMNS = new Set(['id', 'shipment_id', 'created_at', 'uploaded_at', 'pdf_url', 'status', 'details', 'cusdec_no', 'cdn_no', 'boat_note_no'])

// Deletes a row from a doc-type table and, if it has a stored Drive link,
// deletes that Drive file too — every path that removes a row (duplicate
// replace, CDN cap cleanup, or the Database browser) goes through this so a
// row is never deleted without its uploaded PDF going with it.
export async function deleteRowAndDriveFile(table: string, id: string, urlColumn: string = 'pdf_url'): Promise<void> {
  const { data } = await supabaseAdmin.from(table).select(urlColumn).eq('id', id).maybeSingle()
  const url = (data as any)?.[urlColumn]
  if (url) await deleteDriveFileByUrl(url)
  await supabaseAdmin.from(table).delete().eq('id', id)
}

// Finds an existing row that looks like the same real-world document, using
// the natural key the user specified per doc type — CUSDEC: code+number+date,
// CDN/Barcode: container_no. Used right before saving so the Upload Docs
// popup can ask "replace this, or add as a new row?" instead of silently
// creating a duplicate.
export async function findExistingMatch(docType: string, data: Record<string, string>): Promise<any | null> {
  const table = DOC_TYPE_TABLE[docType]
  if (!table || table === 'boat_notes') return null

  if (docType === 'cusdec') {
    if (!data.code || !data.number || !data.date) return null
    const { data: rows } = await supabaseAdmin.from('cusdec').select('*')
      .eq('code', data.code).eq('number', data.number).eq('date', data.date).limit(1)
    return rows?.[0] || null
  }
  if (docType === 'cdn' || docType === 'barcode') {
    if (!data.container_no) return null
    const { data: rows } = await supabaseAdmin.from(table).select('*').eq('container_no', data.container_no).limit(1)
    return rows?.[0] || null
  }
  return null
}

// A CUSDEC's CAP (column 17) is the number of CDN rows it should ever have.
// Before a brand-new CDN row can be added, the actual count for that CUSDEC
// must be under CAP — if not, the save is blocked until an existing CDN row
// is deleted (freeing a slot) or the CUSDEC's CAP is corrected.
export async function checkCdnCap(code: string, cusdecNumber: string): Promise<{ cap: number; currentCount: number; rows: any[] } | null> {
  if (!code || !cusdecNumber) return null
  const { data: cusdecRows } = await supabaseAdmin.from('cusdec').select('cap').eq('code', code).eq('number', cusdecNumber).limit(1)
  const cap = parseInt(cusdecRows?.[0]?.cap || '', 10)
  if (!cusdecRows?.[0] || !cap || Number.isNaN(cap)) return null
  const { data: cdnRows } = await supabaseAdmin.from('cdn').select('*').eq('code', code).eq('cusdec_number', cusdecNumber)
  return { cap, currentCount: cdnRows?.length || 0, rows: cdnRows || [] }
}

export async function dropColumn(table: string, key: string): Promise<void> {
  if (!ACCESS_TOKEN || !PROJECT_REF) return
  const validKey = /^[a-z_][a-z0-9_]*$/
  if (!key || !validKey.test(key) || PROTECTED_COLUMNS.has(key)) return
  await runManagementQuery(`alter table public."${table}" drop column if exists "${key}"`)
}

export type SaveMode = 'insert' | 'replace'

// Writes one document's extracted fields into its structured table.
// boat_notes keeps a jsonb `details` blob (matches its existing schema);
// cusdec/cdn/barcode get one real column per field.
//
// mode 'replace' deletes the matched existing row (and its Drive file) first,
// then inserts fresh — used when the user picks "delete existing and save
// this one" after a duplicate match. mode 'insert' (default) adds a new row
// alongside whatever's already there, except for CDN: a brand-new CDN row is
// blocked if it would push the CUSDEC's CDN count over that CUSDEC's CAP.
export async function insertExtractedData(
  docType: string, data: Record<string, string>, driveUrl: string,
  options: { mode?: SaveMode; replaceId?: string } = {}
): Promise<{ ok: true } | { ok: false; reason: 'cap_exceeded'; capInfo: { cap: number; currentCount: number; rows: any[] } }> {
  const table = DOC_TYPE_TABLE[docType]
  if (!table) return { ok: true }
  const { mode = 'insert', replaceId } = options

  if (mode === 'replace' && replaceId) {
    await deleteRowAndDriveFile(table, replaceId)
  } else if (docType === 'cdn' && data.code && data.cusdec_number) {
    const capInfo = await checkCdnCap(data.code, data.cusdec_number)
    if (capInfo && capInfo.currentCount >= capInfo.cap) {
      return { ok: false, reason: 'cap_exceeded', capInfo }
    }
  }

  if (table === 'boat_notes') {
    const { error } = await supabaseAdmin.from('boat_notes').insert({
      details: data, pdf_url: driveUrl, uploaded_at: new Date().toISOString(),
      boat_note_no: data.entry_no || data.bl_no || null,
    })
    if (error) throw new Error(error.message)
    return { ok: true }
  }

  const dataKeys = Object.keys(data).filter(k => data[k])
  await ensureColumns(table, dataKeys)
  const columns = await getTableColumns(table)

  const row: Record<string, any> = { pdf_url: driveUrl, uploaded_at: new Date().toISOString() }
  for (const [k, v] of Object.entries(data)) {
    if (v && columns.includes(k)) row[k] = v
  }
  const { error } = await supabaseAdmin.from(table).insert(row)
  if (error) throw new Error(error.message)
  return { ok: true }
}
