import { createClient } from '@supabase/supabase-js'
import { PDFDocument } from 'pdf-lib'
import { generateDocumentPdf } from './docGenerate'
import { uploadBufferToDrive } from '@/pages/api/upload-to-drive'
import { downloadDriveFile } from './driveDownload'

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

// ── සිංහලෙන් ──────────────────────────────────────────────────────────────
// Boat Note සහ Party's Copy automatic හදන තැන (Automation tab එකෙන්
// හෝ දිනපතා cron එකෙන්). Manual විදියට හදනවා වගේම, හදලා ඉවර වුණාම
// Activity Log එකට යනවා — ඕන කෙනෙකුට pick කරලා mail කරන්න පුළුවන්,
// ගණනත් හරියටම manual එකක් වගේම වැටෙනවා.
// ──────────────────────────────────────────────────────────────────────────
export interface AutoCreateSummary {
  created: number
  skipped: { cusdecNumber: string; reason: string }[]
  errors: { cusdecNumber: string; error: string }[]
}

interface CusdecRow {
  id: string; code: string; number: string; cap: string | null
  export_release_passed: boolean | null
  boat_note_url: string | null; party_copy_url: string | null; pdf_url: string | null
}
interface CdnRow { id: string; code: string; cusdec_number: string; boat_note_passed: boolean | null }

// A successful auto-create used to only set cusdec.boat_note_url/
// party_copy_url and a legacy uploaded_documents/generated_boat_notes row —
// invisible to the Activity Log, Boat Note Pending's pick flow, and the
// doc_approvals payroll gate entirely, unlike a manually-uploaded Boat Note
// Passed document. Inserting into document_uploads + dashboard_notifications
// + pick_history_log here makes an auto-created one behave exactly like a
// manual one from this point on — pickable, mailable, and (once mailed and
// approved) counted the same way.
async function notifyAsManualUpload(cusdecId: string, docType: 'boat_note' | 'party_copy', fileName: string, driveLink: string) {
  const { data: doc } = await sb.from('document_uploads').insert({
    file_name: fileName, drive_url: driveLink, doc_type: docType,
    is_saved_to_db: false, status: 'notified',
    uploaded_by: null, uploaded_by_name: 'Automation',
    reason: 'Boat Note Passed', cusdec_id: cusdecId,
  }).select().single()
  if (!doc) return
  await sb.from('dashboard_notifications').insert({ document_id: doc.id, uploaded_by: null, uploaded_by_name: 'Automation' })
  await sb.from('pick_history_log').insert({
    document_id: doc.id, user_id: null, user_name: 'Automation', action: 'notify',
    pdf_notify_user: 'Automation', notify_update_time: new Date().toISOString(),
  })
}

// "Boat Note Pending, not yet Blue/Green" — the same set docs-create.tsx's
// own CUSDEC list shows (curIsBlue/curIsGreen), computed here server-side
// for the automation triggers: CAP already complete (nothing left to wait
// on), export release not yet passed (not Blue), and not every CDN has
// passed Boat Note check yet (not fully Green either).
async function pendingCusdecs(): Promise<{ cusdecs: CusdecRow[]; cdnsByCusdec: Map<string, CdnRow[]> }> {
  const [{ data: cusdecs }, { data: cdns }] = await Promise.all([
    sb.from('cusdec').select('id, code, number, cap, export_release_passed, boat_note_url, party_copy_url, pdf_url'),
    sb.from('cdn').select('id, code, cusdec_number, boat_note_passed'),
  ])
  const cdnsByCusdec = new Map<string, CdnRow[]>()
  for (const d of (cdns || []) as CdnRow[]) {
    const key = `${d.code}|||${d.cusdec_number}`
    if (!cdnsByCusdec.has(key)) cdnsByCusdec.set(key, [])
    cdnsByCusdec.get(key)!.push(d)
  }
  const pending = ((cusdecs || []) as CusdecRow[]).filter(c => {
    const own = cdnsByCusdec.get(`${c.code}|||${c.number}`) || []
    const cap = parseInt(c.cap || '', 10)
    const capComplete = !!cap && own.length >= cap
    if (!capComplete) return false
    if (c.export_release_passed) return false // Blue
    if (own.length && own.every(d => d.boat_note_passed)) return false // Green
    return true
  })
  return { cusdecs: pending, cdnsByCusdec }
}

// Auto-generates the Boat Note PDF (same template/routing path as the
// manual Docs Create > Boat Note flow) for every pending CUSDEC that
// doesn't have one saved yet — skips (doesn't error the whole batch)
// whenever Sheet Routing can't resolve a Fill/Print sheet for that
// shipper, since guessing wrong there is worse than just not creating it.
export async function autoCreateBoatNotes(): Promise<AutoCreateSummary> {
  const summary: AutoCreateSummary = { created: 0, skipped: [], errors: [] }
  const { cusdecs, cdnsByCusdec } = await pendingCusdecs()
  const targets = cusdecs.filter(c => !c.boat_note_url)

  for (const c of targets) {
    const ownCdns = cdnsByCusdec.get(`${c.code}|||${c.number}`) || []
    if (!ownCdns.length) { summary.skipped.push({ cusdecNumber: c.number, reason: 'No CDN records' }); continue }
    try {
      const result = await generateDocumentPdf({ document_type: 'boat_note', cusdec_id: c.id, cdn_ids: ownCdns.map(d => d.id) })
      const fileName = `B${(c.number || '').replace(/[^0-9]/g, '') || c.number}.pdf`
      const { driveLink } = await uploadBufferToDrive(result.base64, fileName, 'application/pdf', 'boat_note')
      const nowIso = new Date().toISOString()
      await sb.from('cusdec').update({
        boat_note_drive_url: driveLink, boat_note_saved_at: nowIso,
        boat_note_url: driveLink, boat_note_created_at: nowIso,
      }).eq('id', c.id)
      // boat_note_url above is the source of truth (that's what the B badge
      // and "already created" checks key off) — these are just supplemental
      // history entries, not worth failing the whole CUSDEC over.
      try {
        await sb.from('uploaded_documents').insert({
          doc_type: 'boat_note', file_name: fileName, file_url: '', drive_url: driveLink, updated_at: nowIso,
        })
        await sb.from('generated_boat_notes').insert({
          cusdec_id: c.id, cusdec_number: c.number, file_name: fileName, drive_url: driveLink,
          created_by_name: 'Automation (Boat Note Create)',
        })
        await notifyAsManualUpload(c.id, 'boat_note', fileName, driveLink)
      } catch { /* supplemental history — non-fatal */ }
      summary.created++
    } catch (e: any) {
      if (e.code === 'SHEET_SELECTION_REQUIRED') {
        summary.skipped.push({ cusdecNumber: c.number, reason: e.message })
      } else {
        summary.errors.push({ cusdecNumber: c.number, error: e.message })
      }
    }
  }
  return summary
}

// Auto-generates the Party's Copy PDF the same way the manual "Generate
// Pro" button does (original CUSDEC PDF pages + filled template pages
// merged into one) for every pending CUSDEC that doesn't have one saved
// yet. Skips shippers Sheet Routing can't resolve, and skips (rather than
// errors) any CUSDEC with no source PDF on file to merge with.
export async function autoCreatePartyCopies(): Promise<AutoCreateSummary> {
  const summary: AutoCreateSummary = { created: 0, skipped: [], errors: [] }

  const { data: templates } = await sb.from('doc_templates').select('document_type')
  const partyDocType = (templates || []).map(t => t.document_type as string).find(isPartiesCopySlug)
  if (!partyDocType) {
    summary.errors.push({ cusdecNumber: '—', error: "No Party's Copy template configured yet" })
    return summary
  }

  const { cusdecs } = await pendingCusdecs()
  const targets = cusdecs.filter(c => !c.party_copy_url)

  for (const c of targets) {
    if (!c.pdf_url) { summary.skipped.push({ cusdecNumber: c.number, reason: 'No CUSDEC PDF on file to merge with — upload one on Upload Docs first' }); continue }
    try {
      const [cusdecBytes, tplResult] = await Promise.all([
        downloadDriveFile(c.pdf_url),
        generateDocumentPdf({ document_type: partyDocType, cusdec_id: c.id }),
      ])
      const merged = await PDFDocument.create()
      const cusdecPdf = await PDFDocument.load(cusdecBytes)
      const cusdecPages = await merged.copyPages(cusdecPdf, cusdecPdf.getPageIndices())
      cusdecPages.forEach(p => merged.addPage(p))
      const tplPdf = await PDFDocument.load(Buffer.from(tplResult.base64, 'base64'))
      const tplPages = await merged.copyPages(tplPdf, tplPdf.getPageIndices())
      tplPages.forEach(p => merged.addPage(p))
      const out = await merged.save()
      const digits = (c.number || '').replace(/\D/g, '') || c.number
      const fileName = `P${digits}.pdf`
      const { driveLink } = await uploadBufferToDrive(Buffer.from(out).toString('base64'), fileName, 'application/pdf', 'party_copy')

      await sb.from('cusdec').update({ party_copy_url: driveLink }).eq('id', c.id)
      try {
        await sb.from('uploaded_documents').insert({
          doc_type: 'party_copy', file_name: fileName, file_url: '', drive_url: driveLink, updated_at: new Date().toISOString(),
        })
        await notifyAsManualUpload(c.id, 'party_copy', fileName, driveLink)
      } catch { /* supplemental history — non-fatal */ }
      summary.created++
    } catch (e: any) {
      if (e.code === 'SHEET_SELECTION_REQUIRED') {
        summary.skipped.push({ cusdecNumber: c.number, reason: e.message })
      } else {
        summary.errors.push({ cusdecNumber: c.number, error: e.message })
      }
    }
  }
  return summary
}

function isPartiesCopySlug(slug: string): boolean {
  const norm = slug.toLowerCase().replace(/[^a-z0-9]/g, '')
  return norm.includes('party') && norm.includes('copy')
}
