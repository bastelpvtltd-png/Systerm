import { createClient } from '@supabase/supabase-js'
import { google } from 'googleapis'
import { spreadsheetIdFromUrl, batchWriteValues, exportSheetAsPdf, getSheetsList } from '@/lib/googleSheets'
import { buildAsycudaXml, resolveXmlValues, defaultXmlMappings } from '@/lib/asycudaXml'

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

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
        if (m.data_source === 'manual') value = (manual_values || {})[m.field_label] ?? ''
        else if (m.data_source === 'cusdec') {
          value = cusdecRow ? (cusdecRow[m.column_name] ?? '') : ((manual_values || {})[m.field_label] ?? '')
        } else if (m.data_source === 'cdn') {
          if (m.is_repeating && cdnRows.length) value = cdnRows.map(r => r[m.column_name] ?? '').join('\n')
          else value = cdnRows[0] ? (cdnRows[0][m.column_name] ?? '') : ((manual_values || {})[m.field_label] ?? '')
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
    const tinVat = cusdecRow?.tin_vat as string | undefined
    const matchedFillRoute = fill_sheet_gid
      ? { sheet_gid: fill_sheet_gid }
      : (tinVat ? sheetRoutes?.find(r => r.route_type === 'fill' && r.tin_vat_list?.includes(tinVat)) : undefined)
    const matchedPrintRoute = print_sheet_gid
      ? { sheet_gid: print_sheet_gid }
      : (tinVat ? sheetRoutes?.find(r => r.route_type === 'print' && r.tin_vat_list?.includes(tinVat)) : undefined)

    // Resolve the live sheet list from the ORIGINAL spreadsheet before
    // copying — a cheap read that lets us fail fast (with the current list
    // of tabs to offer the caller) instead of burning a Drive copy on a
    // generate that can't be routed. Sheet IDs (gid) survive a full-file
    // Drive copy unchanged, so this list stays valid for the copy too.
    const liveSheets = await getSheetsList(spreadsheetId)
    const firstSheetTitle = liveSheets[0]?.title || 'Sheet1'

    const routedFillSheet = matchedFillRoute
      ? liveSheets.find(s => String(s.sheetId) === String(matchedFillRoute.sheet_gid))?.title
      : undefined
    const routedPrintSheet = matchedPrintRoute
      ? liveSheets.find(s => String(s.sheetId) === String(matchedPrintRoute.sheet_gid))?.title
      : undefined

    // Sheet Routing is the ONLY source of truth for which tab to fill/print
    // once any route exists for this template — there's no more falling
    // back to the old per-mapping/per-template sheet-name fields (those
    // stopped being editable once Sheet Routing shipped, so they just sit
    // frozen at whatever was typed in long ago and silently point at a
    // renamed/deleted tab). If routing is in use on a side but this
    // shipper isn't covered by any route (or their route's tab no longer
    // exists), fail explicitly and hand back the live tab list so the
    // caller can ask the user to pick one — instead of guessing.
    const fillRoutingInUse = sheetRoutes?.some(r => r.route_type === 'fill')
    const printRoutingInUse = sheetRoutes?.some(r => r.route_type === 'print')
    if (!fill_sheet_gid && fillRoutingInUse && !routedFillSheet) {
      const err: any = new Error(tinVat
        ? `No Fill Sheet route matches this shipper's TIN VAT (${tinVat}). Add a route for them in Templates, or pick a Fill Sheet manually.`
        : `No Fill Sheet route could be matched (no TIN VAT on this record). Pick a Fill Sheet manually.`)
      err.code = 'SHEET_SELECTION_REQUIRED'
      err.sheets = liveSheets
      throw err
    }
    if (!print_sheet_gid && printRoutingInUse && !routedPrintSheet) {
      const err: any = new Error(tinVat
        ? `No Print Sheet route matches this shipper's TIN VAT (${tinVat}). Add a route for them in Templates, or pick a Print Sheet manually.`
        : `No Print Sheet route could be matched (no TIN VAT on this record). Pick a Print Sheet manually.`)
      err.code = 'SHEET_SELECTION_REQUIRED'
      err.sheets = liveSheets
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
    const mappings: Array<{ field_label: string; data_source: string; column_name: string; is_repeating: boolean; target_cell_or_range: string }> = tpl.template_mappings || []
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
          const sourceRows = m.data_source === 'manual' ? [] : m.data_source === 'cdn' ? cdnRows : cusdecRow ? [cusdecRow] : []
          if (sourceRows.length) {
            sourceRows.slice(0, endRow - startRow + 1).forEach((row, i) => {
              updates.push({ range: `${sheetPrefix}${col}${startRow + i}`, value: row[m.column_name] ?? '' })
            })
          } else if ((manual_values || {})[m.field_label]) {
            // No CUSDEC/CDN row to source from (pure manual entry) — fall back
            // to the newline-joined rows typed into the Manual Entry tab.
            const manualRows = manual_values![m.field_label].split('\n').filter(Boolean)
            manualRows.slice(0, endRow - startRow + 1).forEach((val, i) => {
              updates.push({ range: `${sheetPrefix}${col}${startRow + i}`, value: val })
            })
          }
        }
        continue
      }

      let value: string | number | null = ''
      if (m.data_source === 'manual') value = (manual_values || {})[m.field_label] ?? ''
      else if (m.data_source === 'cusdec') value = cusdecRow ? (cusdecRow[m.column_name] ?? '') : ((manual_values || {})[m.field_label] ?? '')
      else if (m.data_source === 'cdn') value = cdnRows[0] ? (cdnRows[0][m.column_name] ?? '') : ((manual_values || {})[m.field_label] ?? '')
      updates.push({ range: `${sheetPrefix}${m.target_cell_or_range.toUpperCase()}`, value })
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

    const fileName = `${document_type}_${new Date().toISOString().slice(0, 10)}.pdf`
    return { fileName, base64: pdfBuffer.toString('base64') }
  } catch (e) {
    // Clean up copy if something failed mid-way
    if (copyId) {
      try { const drive = getDriveClient(); await drive.files.delete({ fileId: copyId }) } catch {}
    }
    throw e
  }
}
