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

// Columns barely ever change (only via ensureColumns, when a custom field is
// added), but this was being re-fetched from the Management API on every
// single PDF extraction — a slow network round trip that added up across a
// batch upload. Cache each table's columns for a few minutes per warm
// serverless instance instead.
const columnsCache = new Map<string, { columns: string[]; expiresAt: number }>()
const COLUMNS_CACHE_TTL_MS = 5 * 60 * 1000

export async function getTableColumns(table: string): Promise<string[]> {
  const cached = columnsCache.get(table)
  if (cached && cached.expiresAt > Date.now()) return cached.columns
  const rows = await runManagementQuery(
    `select column_name from information_schema.columns where table_schema='public' and table_name='${table}'`
  )
  const columns = rows.map((r: any) => r.column_name)
  columnsCache.set(table, { columns, expiresAt: Date.now() + COLUMNS_CACHE_TTL_MS })
  return columns
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
  if (missing.length) columnsCache.delete(table) // next getTableColumns call sees the new column immediately
}

// Structural columns that must never be dropped even if a matching field key
// somehow appears (id/created_at/etc. predate the dynamic column system).
const PROTECTED_COLUMNS = new Set(['id', 'shipment_id', 'created_at', 'uploaded_at', 'uploaded_by', 'pdf_url', 'status', 'details', 'cusdec_no', 'cdn_no', 'boat_note_no'])

// Deletes a row from a doc-type table and, if it has a stored Drive link,
// deletes that Drive file too — every path that removes a row (duplicate
// replace, CDN cap cleanup, or the Database browser) goes through this so a
// row is never deleted without its uploaded PDF going with it.
export async function deleteRowAndDriveFile(table: string, id: string, urlColumn: string = 'pdf_url'): Promise<void> {
  // cusdec_document_links and final_document_tasks both cascade-delete their
  // rows automatically (FK "on delete cascade" to cusdec), but that only
  // removes the database rows — the actual Drive files they point at would
  // otherwise be orphaned, since nothing else ever cleans those up.
  if (table === 'cusdec') {
    const [{ data: links }, { data: tasks }] = await Promise.all([
      supabaseAdmin.from('cusdec_document_links').select('drive_url').eq('cusdec_id', id),
      supabaseAdmin.from('final_document_tasks').select('drive_url').eq('cusdec_id', id).in('status', ['pending', 'picked']),
    ])
    await Promise.all([...(links || []), ...(tasks || [])].map(r => r.drive_url ? deleteDriveFileByUrl(r.drive_url) : Promise.resolve()))
  }

  const { data } = await supabaseAdmin.from(table).select(urlColumn).eq('id', id).maybeSingle()
  const url = (data as any)?.[urlColumn]
  if (url) await deleteDriveFileByUrl(url)
  await supabaseAdmin.from(table).delete().eq('id', id)
}

// Finds existing rows that look like the same real-world document, using
// the natural key the user specified per doc type — CUSDEC: code+number+date,
// CDN/Barcode: container_no. Used right before saving so the Upload Docs
// popup can show every match found, let each be edited or deleted-and-
// replaced in place, or the new one added alongside them anyway.
export async function findExistingMatches(docType: string, data: Record<string, string>): Promise<any[]> {
  const table = DOC_TYPE_TABLE[docType]
  if (!table || table === 'boat_notes') return []

  if (docType === 'cusdec') {
    if (!data.code || !data.number || !data.date) return []
    const { data: rows } = await supabaseAdmin.from('cusdec').select('*')
      .eq('code', data.code).eq('number', data.number).eq('date', data.date)
    return rows || []
  }
  if (docType === 'cdn' || docType === 'barcode') {
    if (!data.container_no) return []
    const { data: rows } = await supabaseAdmin.from(table).select('*').eq('container_no', data.container_no)
    return rows || []
  }
  return []
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
  // Only approved CDNs count toward CAP — pending_admin_approval=true rows don't count yet
  const approvedRows = (cdnRows || []).filter((r: any) => !r.pending_admin_approval)
  return { cap, currentCount: approvedRows.length, rows: cdnRows || [] }
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
  options: { mode?: SaveMode; replaceId?: string; uploadedBy?: string } = {}
): Promise<{ ok: true; row?: any } | { ok: false; reason: 'cap_exceeded'; capInfo: { cap: number; currentCount: number; rows: any[] } }> {
  const table = DOC_TYPE_TABLE[docType]
  if (!table) return { ok: true }
  const { mode = 'insert', replaceId, uploadedBy } = options

  if (mode === 'replace' && replaceId) {
    await deleteRowAndDriveFile(table, replaceId)
  } else if (docType === 'cdn' && data.code && data.cusdec_number) {
    const capInfo = await checkCdnCap(data.code, data.cusdec_number)
    if (capInfo && capInfo.currentCount >= capInfo.cap) {
      return { ok: false, reason: 'cap_exceeded', capInfo }
    }
  }

  if (table === 'boat_notes') {
    const nowIso = new Date().toISOString()
    const { data: inserted, error } = await supabaseAdmin.from('boat_notes').insert({
      details: data, pdf_url: driveUrl, uploaded_at: nowIso, updated_at: nowIso, uploaded_by: uploadedBy || null,
      boat_note_no: data.entry_no || data.bl_no || null,
    }).select().single()
    if (error) throw new Error(error.message)
    return { ok: true, row: inserted }
  }

  const dataKeys = Object.keys(data).filter(k => data[k])
  await ensureColumns(table, dataKeys)
  const columns = await getTableColumns(table)

  const nowIso = new Date().toISOString()
  const row: Record<string, any> = { pdf_url: driveUrl, uploaded_at: nowIso, updated_at: nowIso, uploaded_by: uploadedBy || null }
  for (const [k, v] of Object.entries(data)) {
    if (v && columns.includes(k)) row[k] = v
  }
  const { data: inserted, error } = await supabaseAdmin.from(table).insert(row).select().single()
  if (error) throw new Error(error.message)
  return { ok: true, row: inserted }
}

// ── Cusdec ⇄ Shipment automation ─────────────────────────────────────────
// A Shipment entry (temporary_shipments) is opened before any paperwork
// exists. Once a CUSDEC upload comes in with a matching Invoice Number, its
// leftover fields (Reference, Packing Number, Consignee if the CUSDEC's own
// extraction missed it) get folded into the CUSDEC row and the shipment
// entry is deleted — the CUSDEC row is now the single source of truth.
// Extracted CUSDEC data always wins: only columns that are still empty on
// the CUSDEC row get filled in from the shipment, nothing is overwritten.
function generateReference(exporter?: string): string {
  const code = (exporter || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4) || 'REF'
  const y = new Date().getFullYear()
  const rand = Math.floor(100000 + Math.random() * 900000)
  return `${code}-${y}-${rand}`
}

export async function matchAndMergeShipment(cusdecRow: any, actingUserId?: string): Promise<{ matched: boolean; shipmentId?: string }> {
  if (!cusdecRow?.id) return { matched: false }

  if (cusdecRow.invoice_number) {
    const { data: shipment } = await supabaseAdmin
      .from('temporary_shipments')
      .select('*')
      .eq('invoice_number', cusdecRow.invoice_number)
      .limit(1)
      .maybeSingle()

    // A shipment picked by someone else is off-limits to auto-merge — it'd
    // otherwise delete the row (and the pick with it) out from under the
    // person who's mid-workflow on it. Only the picker's own CUSDEC save
    // (or an unpicked shipment) can complete the merge.
    if (shipment && (!shipment.locked_by || shipment.locked_by === actingUserId)) {
      await mergeShipmentIntoCusdec(cusdecRow, shipment)
      return { matched: true, shipmentId: shipment.id }
    }
  }

  // Also try matching by an already-known Reference when Invoice Number
  // didn't match — this is how a "CUSDEC Passed" reason-tagged send with a
  // Reference typed in (see SendModal.tsx) attaches to a Shipment Entry that
  // was opened before this CUSDEC existed, same merge as the Invoice Number
  // path just keyed differently.
  if (cusdecRow.reference) {
    const { data: shipment } = await supabaseAdmin
      .from('temporary_shipments')
      .select('*')
      .eq('reference', cusdecRow.reference)
      .limit(1)
      .maybeSingle()

    if (shipment && (!shipment.locked_by || shipment.locked_by === actingUserId)) {
      await mergeShipmentIntoCusdec(cusdecRow, shipment)
      return { matched: true, shipmentId: shipment.id }
    }
  }

  // No matching shipment — every CUSDEC still gets its own reference number
  // (same generator Shipment Entry itself uses), not just the ones that
  // happen to merge with a pre-existing Shipment Entry.
  if (!cusdecRow.reference) {
    const reference = generateReference(cusdecRow.exporter)
    await supabaseAdmin.from('cusdec').update({ reference }).eq('id', cusdecRow.id)
  }
  return { matched: false }
}

export async function mergeShipmentIntoCusdec(cusdecRow: any, shipment: any): Promise<void> {
  const fill: Record<string, any> = {}
  if (!cusdecRow.reference && shipment.reference) fill.reference = shipment.reference
  if (!cusdecRow.packing_number && shipment.packing_number) fill.packing_number = shipment.packing_number
  if (!cusdecRow.consignee && shipment.consignee) fill.consignee = shipment.consignee
  if (!cusdecRow.exporter && shipment.shipper) fill.exporter = shipment.shipper
  if (!cusdecRow.reference) fill.reference = fill.reference || generateReference(cusdecRow.exporter || shipment.shipper)

  // Shipment entry's invoice_number is authoritative — it was typed by the user,
  // not extracted from a PDF, so it's always preferred over the cusdec extraction.
  if (shipment.invoice_number) fill.invoice_number = shipment.invoice_number

  // Carry over all document URLs from the shipment entry to the cusdec row
  // so documents attached before the cusdec existed aren't lost after the merge.
  if (shipment.invoice_drive_url) fill.invoice_drive_url = shipment.invoice_drive_url
  if (shipment.packing_drive_url) fill.packing_drive_url = shipment.packing_drive_url
  if (shipment.license_drive_url) fill.license_drive_url = shipment.license_drive_url
  if (shipment.divide_invoice_drive_url) fill.divide_invoice_drive_url = shipment.divide_invoice_drive_url
  if (shipment.divide_packing_drive_url) fill.divide_packing_drive_url = shipment.divide_packing_drive_url
  if (shipment.real_cap) fill.real_cap = shipment.real_cap
  if (shipment.cap) fill.divide_cap = shipment.cap  // cap column = divide_cap

  if (Object.keys(fill).length) {
    // Ensure columns exist before writing — doc URL fields may not exist yet on older cusdec rows
    await ensureColumns('cusdec', Object.keys(fill))
    const { error } = await supabaseAdmin.from('cusdec').update(fill).eq('id', cusdecRow.id)
    if (error) throw new Error(error.message)
  }
  await supabaseAdmin.from('temporary_shipments').delete().eq('id', shipment.id)
}

// cusdec/cdn/barcode/boat_notes are all one shipment's paperwork — deleting
// the parent without its children just leaves orphaned rows (and orphaned
// Drive PDFs) with nothing to find them by. Shared between admin-data.ts
// (single-row delete) and database-export.ts (bulk date-range delete).
export async function cascadeDeleteCdn(cdnRow: any): Promise<void> {
  if (!cdnRow?.container_no) return
  const { data: barcodeRows } = await supabaseAdmin.from('barcode').select('*').eq('container_no', cdnRow.container_no)
  for (const b of (barcodeRows || [])) {
    if (b.pdf_url) await deleteDriveFileByUrl(b.pdf_url).catch((e: any) => console.error('[cascadeDeleteCdn] Drive delete failed:', e.message))
    await supabaseAdmin.from('barcode').delete().eq('id', b.id)
  }
}

export async function cascadeDeleteCusdec(cusdecRow: any): Promise<void> {
  if (!cusdecRow?.code || !cusdecRow?.number) return
  const { data: cdnRows } = await supabaseAdmin.from('cdn').select('*').eq('code', cusdecRow.code).eq('cusdec_number', cusdecRow.number)
  const containerNos: string[] = []
  for (const c of (cdnRows || [])) {
    if (c.container_no) containerNos.push(c.container_no)
    await cascadeDeleteCdn(c)
    if (c.pdf_url) await deleteDriveFileByUrl(c.pdf_url).catch((e: any) => console.error('[cascadeDeleteCusdec] Drive delete failed:', e.message))
    await supabaseAdmin.from('cdn').delete().eq('id', c.id)
  }
  // boat_notes has no dedicated cusdec_number column — it carries the same
  // container_no (inside its jsonb `details` blob) as the CDN row it was made
  // for (see shipment-overview.ts, which links them back the same way).
  if (containerNos.length) {
    const { data: boatNotes } = await supabaseAdmin.from('boat_notes').select('*').in('details->>container_no', containerNos)
    for (const bn of (boatNotes || [])) {
      if (bn.pdf_url) await deleteDriveFileByUrl(bn.pdf_url).catch((e: any) => console.error('[cascadeDeleteCusdec] Drive delete failed:', e.message))
      await supabaseAdmin.from('boat_notes').delete().eq('id', bn.id)
    }
  }
}
