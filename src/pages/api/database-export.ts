import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { requireAdmin } from '@/lib/serverAuth'
import { getDriveClient, getOrCreateSubfolder, driveFileIdFromUrl, deleteDriveFileByUrl } from '@/lib/driveFolders'
import { cascadeDeleteCusdec } from '@/lib/docTables'
import ExcelJS from 'exceljs'
import JSZip from 'jszip'
import { Readable } from 'stream'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function fetchDriveFileBuffer(drive: any, url: string): Promise<Buffer | null> {
  const fileId = driveFileIdFromUrl(url)
  if (!fileId) return null
  try {
    const res = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'arraybuffer' })
    return Buffer.from(res.data as ArrayBuffer)
  } catch (e: any) {
    console.error('[database-export] Drive file fetch failed:', e.message)
    return null
  }
}

function addSheet(wb: ExcelJS.Workbook, name: string, rows: any[]) {
  const ws = wb.addWorksheet(name)
  if (!rows.length) return
  const cols: string[] = Array.from(rows.reduce((set: Set<string>, r) => { Object.keys(r).forEach(k => set.add(k)); return set }, new Set<string>()))
  ws.columns = cols.map(c => ({ header: c, key: c, width: 18 }))
  // ExcelJS's addRow can choke on a cell value that isn't a plain
  // string/number/date/boolean (a jsonb column value, for instance) —
  // stringify anything else so one odd column can't crash the whole export.
  for (const r of rows) {
    const flat: Record<string, any> = {}
    for (const c of cols) {
      const v = r[c]
      flat[c] = (v === null || v === undefined || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')
        ? v
        : JSON.stringify(v)
    }
    ws.addRow(flat)
  }
}

// This is genuinely heavy (fetches every matched shipment's PDFs from Drive
// into one zip) — deliberately admin-only, and everything happens server-
// side into a Drive archive folder rather than streaming a huge response
// back through Vercel, so the client only ever gets a link.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const authed = await requireAdmin(req)
  if (!authed.ok) return res.status(authed.status).json({ error: authed.error })
  if (req.method !== 'POST') return res.status(405).end()

  try {
    // Cleanup step is a SEPARATE explicit call from generating the zip —
    // never bundled into download/mail, since it permanently deletes these
    // CUSDECs and everything cascaded from them (cdn/barcode/boat_notes +
    // their Drive PDFs). The zip already made is what makes this safe to
    // offer at all.
    if (req.body.action === 'delete') {
      const { ids } = req.body as { ids: string[] }
      if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ids required' })
      let deleted = 0
      for (const id of ids) {
        const { data: row } = await supabaseAdmin.from('cusdec').select('*').eq('id', id).maybeSingle()
        if (!row) continue
        await cascadeDeleteCusdec(row)
        // The upload/pick/mail/download audit trail is already saved into
        // the zip's History sheet — safe to purge here the same way the
        // documents themselves are.
        const { data: uploads } = await supabaseAdmin.from('document_uploads').select('id').eq('cusdec_id', id)
        if (uploads?.length) {
          const uploadIds = uploads.map(u => u.id)
          await supabaseAdmin.from('pick_history_log').delete().in('document_id', uploadIds)
          await supabaseAdmin.from('document_uploads').delete().in('id', uploadIds)
        }
        if (row.pdf_url) await deleteDriveFileByUrl(row.pdf_url).catch(() => {})
        await supabaseAdmin.from('cusdec').delete().eq('id', id)
        deleted++
      }
      return res.json({ ok: true, deleted })
    }

    const { startDate, endDate, dateField, shipper, reference, code, status } = req.body as {
      startDate: string; endDate: string; dateField?: 'created_at' | 'payment_complete_at'
      shipper?: string; reference?: string; code?: string
      status?: 'all' | 'cdn_pending' | 'boat_note_pending' | 'release_pending' | 'not_complete_shipment' | 'not_payment_complete' | 'also_done'
    }
    if (!startDate || !endDate) return res.status(400).json({ error: 'startDate and endDate required' })
    const field = dateField === 'payment_complete_at' ? 'payment_complete_at' : 'created_at'

    let q = supabaseAdmin.from('cusdec').select('*').gte(field, startDate).lte(field, `${endDate}T23:59:59`)
    if (reference) q = q.eq('reference', reference)
    if (code) q = q.eq('number', code)
    const { data: cusdecRows, error } = await q.limit(500)
    if (error) return res.status(400).json({ error: error.message })

    let matched = cusdecRows || []
    if (shipper) {
      const s = shipper.trim().toLowerCase()
      matched = matched.filter(c => (c.exporter || '').split('\n')[0].trim().toLowerCase().includes(s))
    }

    // Same statuses Dashboard's cards mean (see dashboard-summary.ts) —
    // cdn_pending/boat_note_pending/release_pending need every matched
    // CUSDEC's own CDN rows to evaluate CAP-complete/all-boat-note-passed,
    // same as the dashboard does.
    if (status && status !== 'all') {
      if (status === 'not_complete_shipment') {
        matched = matched.filter(c => c.export_release_passed && !c.shipment_complete)
      } else if (status === 'not_payment_complete') {
        matched = matched.filter(c => c.shipment_complete && !c.payment_complete)
      } else if (status === 'also_done') {
        matched = matched.filter(c => c.payment_complete)
      } else {
        const { data: cdnRows } = await supabaseAdmin.from('cdn').select('code, cusdec_number, boat_note_passed')
        matched = matched.filter(c => {
          const own = (cdnRows || []).filter(d => d.code === c.code && d.cusdec_number === c.number)
          const cap = parseInt(c.cap || '', 10)
          const capKnown = !!cap && !Number.isNaN(cap)
          const capComplete = !capKnown || own.length >= cap
          const allBoatNotePassed = capComplete && own.length > 0 && own.every(d => d.boat_note_passed)
          if (status === 'cdn_pending') return capKnown && own.length < cap
          if (status === 'boat_note_pending') return capComplete && !allBoatNotePassed
          if (status === 'release_pending') return allBoatNotePassed && !c.export_release_passed
          return true
        })
      }
    }

    if (!matched.length) return res.json({ ok: true, count: 0 })

    const allCdn: any[] = []
    const allBarcode: any[] = []
    const allHistory: any[] = []
    const docsByCusdec: Record<string, { label: string; url: string }[]> = {}

    for (const c of matched) {
      // One bad row (a stale/deleted Drive file, an unexpected null) must not
      // sink the whole export — skip that row's document gathering and keep
      // going, the data sheets still include it either way.
      try {
        const key = c.number || c.id
        const docs: { label: string; url: string }[] = []
        if (c.pdf_url) docs.push({ label: 'CUSDEC', url: c.pdf_url })

        const { data: cdns } = await supabaseAdmin.from('cdn').select('*').eq('code', c.code).eq('cusdec_number', c.number)
        for (const cdn of (cdns || [])) {
          allCdn.push(cdn)
          if (cdn.pdf_url) docs.push({ label: `CDN_${cdn.container_no || cdn.id}`, url: cdn.pdf_url })
          if (cdn.container_no) {
            const { data: barcodeRows } = await supabaseAdmin.from('barcode').select('*').eq('container_no', cdn.container_no)
            for (const b of (barcodeRows || [])) {
              allBarcode.push(b)
              if (b.pdf_url) docs.push({ label: `Barcode_${cdn.container_no}`, url: b.pdf_url })
            }
          }
        }

        const { data: docLinks } = await supabaseAdmin.from('cusdec_document_links').select('*').eq('cusdec_id', c.id)
        for (const dl of (docLinks || [])) if (dl.drive_url) docs.push({ label: dl.document_type || 'Document', url: dl.drive_url })

        // Full upload + pick/mail/download audit trail for every document
        // ever linked to this CUSDEC — a separate "History" sheet, not just
        // the documents themselves.
        const { data: uploads } = await supabaseAdmin.from('document_uploads').select('id, file_name, reason, uploaded_by_name, created_at').eq('cusdec_id', c.id)
        if (uploads?.length) {
          const { data: history } = await supabaseAdmin.from('pick_history_log').select('*').in('document_id', uploads.map(u => u.id))
          for (const h of (history || [])) allHistory.push({ cusdec_number: c.number, ...h })
        }

        docsByCusdec[c.number || c.id] = docs
      } catch (e: any) {
        console.error('[database-export] failed gathering docs for cusdec', c.id, e.message)
      }
    }

    const wb = new ExcelJS.Workbook()
    addSheet(wb, 'CUSDEC', matched)
    addSheet(wb, 'CDN', allCdn)
    addSheet(wb, 'Barcode', allBarcode)
    addSheet(wb, 'History', allHistory)
    const excelBuffer = await wb.xlsx.writeBuffer()

    const zip = new JSZip()
    zip.file('Data/export-data.xlsx', excelBuffer as any)
    const drive = getDriveClient()
    for (const c of matched) {
      const key = c.number || c.id
      const safeKey = String(key || 'unknown').replace(/[/\\:*?"<>|]/g, '_')
      const folder = zip.folder(`Documents/${safeKey}`)!
      for (const doc of (docsByCusdec[key] || [])) {
        const buf = await fetchDriveFileBuffer(drive, doc.url)
        if (buf) folder.file(`${doc.label}.pdf`, buf)
      }
    }
    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } })

    const mainFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID || ''
    if (!mainFolderId) return res.status(500).json({ error: 'GOOGLE_DRIVE_FOLDER_ID not configured' })
    const archiveFolderId = await getOrCreateSubfolder(drive, mainFolderId, 'Export Archives')
    const rangeLabel = `${startDate}_to_${endDate}`
    const fileName = `Export_${rangeLabel}.zip`
    const uploaded = await drive.files.create({
      requestBody: { name: fileName, parents: [archiveFolderId] },
      media: { mimeType: 'application/zip', body: Readable.from(zipBuffer) },
      fields: 'id, webViewLink',
    })
    await drive.permissions.create({ fileId: uploaded.data.id!, requestBody: { role: 'reader', type: 'anyone' } })

    res.json({
      ok: true, count: matched.length, zipUrl: uploaded.data.webViewLink, fileName, rangeLabel,
      matchedIds: matched.map(c => c.id),
    })
  } catch (err: any) {
    console.error('[database-export] error:', err.stack || err)
    res.status(500).json({ error: err.message || String(err) })
  }
}
