import { createClient } from '@supabase/supabase-js'
import { google } from 'googleapis'
import { spreadsheetIdFromUrl, batchWriteValues, exportSheetAsPdf, getSheetsList } from '@/lib/googleSheets'
import { buildAsycudaXml, resolveXmlValues, defaultXmlMappings } from '@/lib/asycudaXml'
import { normalizeGrossMass } from '@/lib/grossMassFormat'

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

// Lets a mapping's column_name reference a slice of a composite/space-
// separated column instead of only whole columns — e.g. cdn.cdn_no is
// stored as one string ("2026 CBEX1 C 46385" = "YEAR CODE SERIAL NUMBER"),
// so a mapping can target just one token with "cdn_no[1]" rather than
// needing a separate real column per token.
function resolveColumnValue(row: Record<string, any> | null | undefined, columnName: string): string {
  if (!row) return ''
  const m = columnName.match(/^([a-zA-Z0-9_]+)\[(\d+)\]$/)
  const raw = m ? String(row[m[1]] ?? '').trim().split(/\s+/)[Number(m[2])] ?? '' : (row[columnName] ?? '')
  return applyWeightNormalization(m ? m[1] : columnName, raw)
}

// CDN/CUSDEC gross_mass (and net_mass) come out of PDF extraction in
// inconsistent formats — "20 190.00", "20,190.00", "20.190.00", "20190",
// "20190 00", "20190,00" — which must all land in the sheet as "20,190.00".
// Only weight columns go through this; every other mapped field is passed
// through unchanged.
const WEIGHT_COLUMNS = new Set(['gross_mass', 'net_mass'])
function applyWeightNormalization(baseColumnName: string, value: any): string {
  if (!WEIGHT_COLUMNS.has(baseColumnName)) return value ?? ''
  const { formatted, ok } = normalizeGrossMass(value)
  // If it couldn't be brought under the 35,000kg ceiling, fall back to the
  // raw value rather than writing something silently wrong — same
  // conservative behavior as normalizeGrossMass's own `ok` flag.
  return ok ? formatted : (value ?? '')
}

// A Google Sheet mapping's empty_fallback (Templates → "If Empty, Write")
// is what actually goes into the cell when there's no real value — blank
// (the default) keeps today's behavior of writing nothing.
function withFallback(value: string, fallback?: string | null): string {
  return value === '' && fallback ? fallback : value
}

// Whether the caller explicitly sent a value for this field — Database mode
// now always sends manual_values as the (possibly-edited) field preview
// alongside cusdec_id, so an explicit key here means "use this," even for
// a cusdec/cdn-sourced field, overriding the raw column value.
function hasOverride(fieldLabel: string, manualValues: Record<string, string> | undefined | null): boolean {
  return !!manualValues && Object.prototype.hasOwnProperty.call(manualValues, fieldLabel)
}

// "co_2026-07-20.pdf" told you nothing about which shipment it was for —
// this builds "PY_JES_20-07.pdf" style names instead (doc type's first two
// letters + shipper's first word's first three letters + DD-MM) whenever a
// CUSDEC is known (Database mode). Falls back to the old generic name for
// Manual Entry, which has no CUSDEC to pull a shipper from.
function buildFileName(document_type: string, cusdecRow: Record<string, any> | null, ext: string): string {
  const today = new Date()
  const dd = String(today.getDate()).padStart(2, '0')
  const mm = String(today.getMonth() + 1).padStart(2, '0')
  const shipperWord = String(cusdecRow?.exporter || '').split('\n')[0].trim().split(/\s+/)[0] || ''
  if (cusdecRow && shipperWord) {
    const docCode = document_type.slice(0, 2).toUpperCase()
    const shipperCode = shipperWord.slice(0, 3).toUpperCase()
    return `${docCode}_${shipperCode}_${dd}-${mm}.${ext}`
  }
  return `${document_type}_${today.toISOString().slice(0, 10)}.${ext}`
}

function getDriveClient() {
  const auth = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET)
  auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN })
  return google.drive({ version: 'v3', auth })
}

export interface GenerateDocumentInput {
  document_type: string
  cusdec_id?: string
  manual_values?: Record<string, string>
  cdn_ids?: string[]
  // Manual Entry mode has no CUSDEC to route by TIN VAT — the caller picks
  // the sheet explicitly instead. Ignored (routing/mapping defaults win)
  // when omitted.
  fill_sheet_gid?: string
  print_sheet_gid?: string
}

export interface GenerateDocumentResult {
  fileName: string
  base64: string
  mimeType?: string
  content?: string
}

// Shared by /api/doc-generate.ts (the normal Generate flow) and
// /api/generate-parties-copy-pro.ts (which needs the raw template PDF bytes
// before merging with the CUSDEC's own PDF) — pulled out so there's exactly
// one place that knows how to fill a template, not two copies drifting apart.
export async function generateDocumentPdf(input: GenerateDocumentInput): Promise<GenerateDocumentResult> {
  const { document_type, cusdec_id, manual_values, cdn_ids, fill_sheet_gid, print_sheet_gid } = input
  if (!document_type) throw new Error('document_type required')

  let copyId: string | null = null
  try {
    // Load template + mappings
    const { data: tpl } = await sb.from('doc_templates').select('*, template_mappings(*)').eq('document_type', document_type).maybeSingle()
    if (!tpl) throw new Error('No template configured for this document type')

    // Load CUSDEC + CDN data
    let cusdecRow: Record<string, any> | null = null
    let cdnRows: Record<string, any>[] = []
    if (cusdec_id) {
      const { data: cusdec } = await sb.from('cusdec').select('*').eq('id', cusdec_id).maybeSingle()
      cusdecRow = cusdec || null
      if (cusdec) {
        let q = sb.from('cdn').select('*').eq('code', cusdec.code).eq('cusdec_number', cusdec.number)
        if (cdn_ids?.length) q = q.in('id', cdn_ids) as typeof q
        const { data: cdns } = await q
        cdnRows = cdns || []
      }
    }

    // ASYCUDA CUSDEC XML — a fixed field set (see asycudaXml.ts), never
    // free-text substitution: mapped values are resolved from the CUSDEC/CDN
    // row (or manual_values) into an XmlValues object, then run through the
    // same buildAsycudaXml() serializer the dedicated Cusdec XML tab uses,
    // so the output structure always matches a real ASYCUDA export exactly
    // regardless of which fields are mapped where.
    if (tpl.template_format === 'asycuda_xml') {
      const mappings: Array<{ field_label: string; data_source: 'cusdec' | 'cdn' | 'manual'; column_name: string }> =
        tpl.template_mappings?.length ? tpl.template_mappings : defaultXmlMappings()
      const values = resolveXmlValues(mappings, cusdecRow, cdnRows[0] || null, manual_values || {})
      const content = buildAsycudaXml(values)
      const fileName = `${values.regNumber ? `CUSDEC_${values.regNumber}` : document_type}_${new Date().toISOString().slice(0, 10)}.xml`
      return {
        fileName,
        base64: Buffer.from(content, 'utf-8').toString('base64'),
        mimeType: 'application/xml',
        content,
      }
    }

    // XML / Text templates — no spreadsheet at all: resolve each mapping's
    // value the same way as the Sheets path below, then substitute
    // {{field_label}} tags directly into the typed template body.
    if (tpl.template_format && tpl.template_format !== 'google_sheet') {
      const mappings: Array<{ field_label: string; data_source: string; column_name: string; is_repeating: boolean }> = tpl.template_mappings || []
      let content: string = tpl.template_content || ''
      for (const m of mappings) {
        let value = ''
        // Docs Create's Database mode now pre-fills its field preview from
        // the CUSDEC/CDN row and lets it be edited before Generate — an
        // explicit manual_values entry (even in cusdec_id mode) is that
        // edit and wins over the raw column, same field_label either way.
        if (hasOverride(m.field_label, manual_values)) value = (manual_values as Record<string, string>)[m.field_label]
        else if (m.data_source === 'manual') value = (manual_values || {})[m.field_label] ?? ''
        else if (m.data_source === 'cusdec') {
          value = cusdecRow ? resolveColumnValue(cusdecRow, m.column_name) : ''
        } else if (m.data_source === 'cdn') {
          if (m.is_repeating && cdnRows.length) value = cdnRows.map(r => resolveColumnValue(r, m.column_name)).join('\n')
          else value = cdnRows[0] ? resolveColumnValue(cdnRows[0], m.column_name) : ''
        }
        const escaped = m.field_label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        content = content.replace(new RegExp(`\\{\\{\\s*${escaped}\\s*\\}\\}`, 'g'), String(value))
      }
      const ext = tpl.template_format === 'xml' ? 'xml' : 'txt'
      const fileName = `${document_type}_${new Date().toISOString().slice(0, 10)}.${ext}`
      return {
        fileName,
        base64: Buffer.from(content, 'utf-8').toString('base64'),
        mimeType: tpl.template_format === 'xml' ? 'application/xml' : 'text/plain',
        content,
      }
    }

    const spreadsheetId = spreadsheetIdFromUrl(tpl.template_url)
    if (!spreadsheetId) throw new Error('Invalid Google Sheets URL in template')

    // Per-shipper sheet routing: a fill/print route matched by the CUSDEC's
    // TIN VAT (unique, unlike exporter-name spelling) overrides EVERY
    // mapping's sheet uniformly — the whole template's data moves to that
    // one physical tab, not per-field. Manual Entry mode has no CUSDEC to
    // route by, so the caller's explicit fill_sheet_gid/print_sheet_gid
    // (picked by hand) plays the same role instead.
    const { data: sheetRoutes } = await sb.from('template_sheet_routes').select('*').eq('template_id', tpl.id)
    const tinVat = (cusdecRow?.tin_vat as string | undefined) || undefined
    // TIN VAT compared trimmed + case-insensitive so stray whitespace/casing
    // between the CUSDEC row and the saved route can never break a match.
    const normTin = (v?: string | null) => String(v ?? '').trim().toUpperCase()
    // '__all__' in a route's tin_vat_list (Templates' "All Shippers" checkbox
    // — see templates.tsx's SheetRouteEditor) matches every CUSDEC, including
    // ones with no tin_vat at all, and is checked first so it wins over any
    // specific-TIN-VAT route.
    const findRoute = (type: 'fill' | 'print') => {
      const list = (sheetRoutes || []).filter(r => r.route_type === type)
      return list.find(r => (r.tin_vat_list || []).includes('__all__'))
        || (tinVat ? list.find(r => (r.tin_vat_list || []).some((t: string) => normTin(t) === normTin(tinVat))) : undefined)
    }

    // Resolve the live sheet list from the ORIGINAL spreadsheet before
    // copying — a cheap read that lets us fail fast (with the current list
    // of tabs to offer the caller) instead of burning a Drive copy on a
    // generate that can't be routed. Sheet IDs (gid) survive a full-file
    // Drive copy unchanged, so this list stays valid for the copy too.
    const liveSheets = await getSheetsList(spreadsheetId)
    const firstSheetTitle = liveSheets[0]?.title || 'Sheet1'
    const tabTitle = (gid: string) => liveSheets.find(s => String(s.sheetId) === String(gid))?.title

    // An explicit gid (chosen in the caller's one-time "pick a sheet" popup)
    // wins for THAT call only; otherwise the matched route decides. Either
    // way the tab must still exist.
    if (fill_sheet_gid && !tabTitle(fill_sheet_gid)) throw new Error('The selected Fill Sheet no longer exists in the spreadsheet — pick again.')
    if (print_sheet_gid && !tabTitle(print_sheet_gid)) throw new Error('The selected Print Sheet no longer exists in the spreadsheet — pick again.')

    const fillRoute: { sheet_gid: string; sheet_name?: string } | undefined = fill_sheet_gid ? { sheet_gid: fill_sheet_gid } : findRoute('fill')
    const printRoute: { sheet_gid: string; sheet_name?: string } | undefined = print_sheet_gid ? { sheet_gid: print_sheet_gid } : findRoute('print')
    // A saved route is resolved by its sheet ID (gid) first — that survives
    // renaming the tab — and, if no tab in the spreadsheet carries that ID
    // any more (spreadsheet re-created/re-linked, tab duplicated and the old
    // one deleted, ids saved from a different copy of the file), by the tab
    // NAME saved with the route. Only when neither exists is the tab
    // genuinely gone.
    const norm = (v?: string | null) => String(v ?? '').trim().toLowerCase()
    const tabForRoute = (r?: { sheet_gid: string; sheet_name?: string }) => {
      if (!r) return undefined
      return tabTitle(r.sheet_gid)
        || (r.sheet_name ? liveSheets.find(s => s.title === r.sheet_name)?.title : undefined)
        || (r.sheet_name ? liveSheets.find(s => norm(s.title) === norm(r.sheet_name))?.title : undefined)
    }
    const routedFillSheet = tabForRoute(fillRoute)
    const routedPrintSheet = tabForRoute(printRoute)

    // Sheet Routing is the ONLY source of truth for which tab to fill/print
    // once any route exists for this template — there's no falling back to
    // the old per-mapping/per-template sheet-name fields (frozen since Sheet
    // Routing shipped, so they silently point at a renamed/deleted tab). If
    // routing is in use on a side but this shipper isn't covered (or their
    // route's tab no longer exists), fail explicitly — ONCE, for both sides
    // together, so the caller shows a single popup — and hand back the live
    // tab list plus which side(s) still need a pick. A pick made there applies
    // to that one generate only; nothing is saved.
    const fillRoutingInUse = !!sheetRoutes?.some(r => r.route_type === 'fill')
    const printRoutingInUse = !!sheetRoutes?.some(r => r.route_type === 'print')
    const needFill = fillRoutingInUse && !routedFillSheet
    const needPrint = printRoutingInUse && !routedPrintSheet
    if (needFill || needPrint) {
      // When a route matched but its tab can't be found, spell out what was
      // saved and what the spreadsheet really contains, so a stale/mismatched
      // sheet ID or a different spreadsheet is obvious at a glance.
      const tabsFound = liveSheets.map(s => `${s.title} (${s.sheetId})`).join(', ')
      const why = (label: 'Fill' | 'Print', route?: { sheet_gid: string; sheet_name?: string }) => route
        ? `The routed ${label} Sheet tab ("${route.sheet_name || '?'}", id ${route.sheet_gid}) was not found in the spreadsheet …${spreadsheetId.slice(-6)}. Tabs found: ${tabsFound || 'none'}.`
        : tinVat
          ? `No ${label} Sheet route matches this shipper's TIN VAT (${tinVat}).`
          : `No ${label} Sheet route could be matched (no TIN VAT on this record).`
      const parts: string[] = []
      if (needFill) parts.push(why('Fill', fillRoute))
      if (needPrint) parts.push(why('Print', printRoute))
      const err: any = new Error(`${parts.join(' ')} Pick the sheet below (used for this one generate only), or add a route in Templates.`)
      err.code = 'SHEET_SELECTION_REQUIRED'
      err.sheets = liveSheets
      err.needFill = needFill
      err.needPrint = needPrint
      throw err
    }

    // Copy the template so the original stays clean
    const drive = getDriveClient()
    const copyResp = await drive.files.copy({
      fileId: spreadsheetId,
      requestBody: { name: `_tmp_${document_type}_${Date.now()}` },
    })
    copyId = copyResp.data.id!

    // Build cell updates from mappings — each mapping can target a specific sheet
    const mappings: Array<{ field_label: string; data_source: string; column_name: string; is_repeating: boolean; target_cell_or_range: string; empty_fallback?: string | null }> = tpl.template_mappings || []
    const updates: Array<{ range: string; value: string | number | null }> = []

    for (const m of mappings) {
      const sheetForField = routedFillSheet || firstSheetTitle
      const sheetPrefix = `${sheetForField}!`

      if (m.is_repeating && m.target_cell_or_range.includes(':')) {
        const rangeMatch = m.target_cell_or_range.replace(/\s/g, '').match(/^([A-Za-z]+)(\d+):([A-Za-z]+)(\d+)$/)
        if (rangeMatch) {
          const col = rangeMatch[1].toUpperCase()
          const startRow = parseInt(rangeMatch[2])
          const endRow = parseInt(rangeMatch[4])
          if (hasOverride(m.field_label, manual_values)) {
            // Database mode's edited field preview (or plain Manual Entry) —
            // newline-joined rows, one Sheet row each, wins over the raw
            // CUSDEC/CDN rows either way.
            const manualRows = (manual_values as Record<string, string>)[m.field_label].split('\n').filter(Boolean)
            manualRows.slice(0, endRow - startRow + 1).forEach((val, i) => {
              updates.push({ range: `${sheetPrefix}${col}${startRow + i}`, value: withFallback(val, m.empty_fallback) })
            })
          } else {
            const sourceRows = m.data_source === 'manual' ? [] : m.data_source === 'cdn' ? cdnRows : cusdecRow ? [cusdecRow] : []
            sourceRows.slice(0, endRow - startRow + 1).forEach((row, i) => {
              const cellValue = applyWeightNormalization(m.column_name, row[m.column_name] ?? '')
              updates.push({ range: `${sheetPrefix}${col}${startRow + i}`, value: withFallback(cellValue, m.empty_fallback) })
            })
          }
        }
        continue
      }

      let value = ''
      if (hasOverride(m.field_label, manual_values)) value = (manual_values as Record<string, string>)[m.field_label]
      else if (m.data_source === 'manual') value = (manual_values || {})[m.field_label] ?? ''
      else if (m.data_source === 'cusdec') value = cusdecRow ? applyWeightNormalization(m.column_name, cusdecRow[m.column_name] ?? '') : ''
      else if (m.data_source === 'cdn') value = cdnRows[0] ? applyWeightNormalization(m.column_name, cdnRows[0][m.column_name] ?? '') : ''
      updates.push({ range: `${sheetPrefix}${m.target_cell_or_range.toUpperCase()}`, value: withFallback(value, m.empty_fallback) })
    }

    if (updates.length) await batchWriteValues(copyId, updates)

    // Export PDF — fit_to_page shrinks content to fit the page
    const printSheetName = routedPrintSheet || firstSheetTitle
    const matchedSheet = liveSheets.find(s => s.title === printSheetName) || liveSheets[0]
    const pdfBuffer = await exportSheetAsPdf(copyId, {
      sheetGid: matchedSheet?.sheetId ?? 0,
      range: tpl.print_range || undefined,
      landscape: (tpl.orientation || 'Portrait').toLowerCase() === 'landscape',
      paperSize: tpl.paper_size || 'A4',
      scale: tpl.fit_to_page !== false ? 4 : 2,
    })

    // Delete the copy
    await drive.files.delete({ fileId: copyId })
    copyId = null

    const fileName = buildFileName(document_type, cusdecRow, 'pdf')
    return { fileName, base64: pdfBuffer.toString('base64') }
  } catch (e) {
    // Clean up copy if something failed mid-way
    if (copyId) {
      try { const drive = getDriveClient(); await drive.files.delete({ fileId: copyId }) } catch {}
    }
    throw e
  }
}