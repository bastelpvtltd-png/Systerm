import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { requireAdmin } from '@/lib/serverAuth'
import { getDriveClient, getOrCreateSubfolder } from '@/lib/driveFolders'
import { jsPDF } from 'jspdf'
import { Readable } from 'stream'

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Builds one user's balance report (same figures the Balance panel already
// shows — CDN/CAP/Pytho/CO/SAFTA/Boat Note counts, approved Other Work,
// confirmed payments received) as a PDF, saves it to Drive, and records it
// in balance_reports with status 'received'. Only ever sums work_counts/
// other_work/salary_payments rows not already claimed by an earlier report
// (reported=false) — once summarized here, those exact rows get marked
// reported=true so the next report starts this user's count AND received
// total from zero without losing history (unreported rows since keep
// accumulating normally). Received has to reset the same way earned does —
// otherwise a lifetime-total "received" against a reset-every-period
// "earned" makes the running balance meaningless after the first report.
async function buildReport(userId: string): Promise<{ ok: true; driveUrl: string; rangeLabel: string; amount: number } | { ok: false; error: string }> {
  const { data: prof } = await sb.from('profiles').select('username, full_name').eq('id', userId).maybeSingle()
  if (!prof) return { ok: false, error: 'User not found' }
  const userName = prof.full_name || prof.username || ''

  const { data: rates } = await sb.from('work_rates').select('*').eq('id', 'global').single()
  const { data: workRows } = await sb.from('work_counts').select('*').eq('user_id', userId).eq('reported', false)
  const { data: otherWork } = await sb.from('other_work').select('*').eq('user_id', userId).eq('reported', false)
  const { data: payments } = await sb.from('salary_payments').select('*').eq('to_user_id', userId).eq('reported', false)
  const { data: approvals } = await sb.from('doc_approvals').select('*').eq('uploaded_by', userId)

  const cdn = (workRows || []).reduce((s, r) => s + (r.cdn_inc || 0), 0)
  const cap = (workRows || []).reduce((s, r) => s + (r.cap_inc || 0), 0)
  const pytho = (workRows || []).reduce((s, r) => s + (r.pytho_inc || 0), 0)
  const co = (workRows || []).reduce((s, r) => s + (r.co_inc || 0), 0)
  const safta = (workRows || []).reduce((s, r) => s + (r.safta_inc || 0), 0)
  const boatNote = (workRows || []).reduce((s, r) => s + (r.boat_note_inc || 0), 0)
  const cdnRate = Number(rates?.cdn_rate) || 0, capRate = Number(rates?.cap_rate) || 0
  const pythoRate = Number(rates?.pytho_rate) || 0, coRate = Number(rates?.co_rate) || 0, saftaRate = Number(rates?.safta_rate) || 0
  const boatNoteRate = Number(rates?.boat_note_rate) || 0
  const countEarned = cdn * cdnRate + cap * capRate + pytho * pythoRate + co * coRate + safta * saftaRate + boatNote * boatNoteRate

  const approvedOther = (otherWork || []).filter(x => x.status === 'approved')
  const otherEarned = approvedOther.reduce((s, x) => s + Number(x.amount), 0)
  const totalEarned = countEarned + otherEarned

  const confirmedPayments = (payments || []).filter(p => p.status === 'confirmed')
  const totalReceived = confirmedPayments.reduce((s, p) => s + Number(p.amount), 0)
  const owedBalance = totalEarned - totalReceived

  const now = new Date()
  const rangeLabel = now.toISOString().slice(0, 10)

  const doc = new jsPDF()
  let y = 18
  const line = (text: string, size = 10, bold = false) => {
    doc.setFontSize(size)
    doc.setFont('helvetica', bold ? 'bold' : 'normal')
    doc.text(text, 14, y)
    y += size < 12 ? 6 : 8
  }
  line('Bastel Official System — Balance Report', 16, true)
  line(`${userName}  ·  Report date: ${rangeLabel}`, 10)
  y += 4
  line('Upload Count History', 12, true)
  line(`CDN: ${cdn} x Rs.${cdnRate.toFixed(2)} = Rs.${(cdn * cdnRate).toFixed(2)}`)
  line(`CAP: ${cap} x Rs.${capRate.toFixed(2)} = Rs.${(cap * capRate).toFixed(2)}`)
  if (pytho) line(`Pytho: ${pytho} x Rs.${pythoRate.toFixed(2)} = Rs.${(pytho * pythoRate).toFixed(2)}`)
  if (co) line(`CO: ${co} x Rs.${coRate.toFixed(2)} = Rs.${(co * coRate).toFixed(2)}`)
  if (safta) line(`SAFTA: ${safta} x Rs.${saftaRate.toFixed(2)} = Rs.${(safta * saftaRate).toFixed(2)}`)
  if (boatNote) line(`Boat Note: ${boatNote} x Rs.${boatNoteRate.toFixed(2)} = Rs.${(boatNote * boatNoteRate).toFixed(2)}`)
  y += 2

  // Breakdown — exactly which entries made up each total above (e.g. which
  // CUSDECs/documents summed to a CAP total of 5000), one line per non-zero
  // field per row, so the total isn't just a bare number with nothing behind it.
  line('Count Breakdown', 12, true)
  const breakdownFields: [string, string][] = [['cdn_inc', 'CDN'], ['cap_inc', 'CAP'], ['pytho_inc', 'Pytho'], ['co_inc', 'CO'], ['safta_inc', 'SAFTA'], ['boat_note_inc', 'Boat Note']]
  let anyBreakdown = false
  for (const r of (workRows || [])) {
    for (const [field, label] of breakdownFields) {
      const v = (r as any)[field] || 0
      if (v > 0) {
        anyBreakdown = true
        if (y > 270) { doc.addPage(); y = 18 }
        line(`${new Date(r.created_at).toLocaleDateString('en-GB')} — ${label} +${v} — ${r.reason || r.action || ''}`, 9)
      }
    }
  }
  if (!anyBreakdown) line('None', 9)
  y += 2
  line('Bill / Other Work History', 12, true)
  if (!approvedOther.length) line('None')
  for (const ow of approvedOther) line(`${ow.description} — Rs.${Number(ow.amount).toFixed(2)}`)
  y += 2
  line('Approval / Reject Data', 12, true)
  const approvedCount = (approvals || []).filter(a => a.status === 'approved').length
  const rejectedCount = (approvals || []).filter(a => a.status === 'rejected').length
  const pendingCount = (approvals || []).filter(a => a.status === 'pending').length
  line(`CUSDEC uploads — Approved: ${approvedCount}, Rejected: ${rejectedCount}, Pending: ${pendingCount}`)
  y += 2
  line('Payment Updates', 12, true)
  if (!confirmedPayments.length) line('None received yet')
  for (const p of confirmedPayments) line(`${new Date(p.created_at).toLocaleDateString('en-GB')} — Rs.${Number(p.amount).toFixed(2)}`)
  y += 4
  line('Summary', 12, true)
  line(`Total Earned: Rs.${totalEarned.toFixed(2)}`)
  line(`Total Received: Rs.${totalReceived.toFixed(2)}`)
  line(`Balance carried forward from this report: Rs.${owedBalance.toFixed(2)}`, 11, true)

  const pdfBuffer = Buffer.from(doc.output('arraybuffer'))

  const mainFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID || ''
  if (!mainFolderId) return { ok: false, error: 'GOOGLE_DRIVE_FOLDER_ID not configured' }
  const drive = getDriveClient()
  const reportsFolderId = await getOrCreateSubfolder(drive, mainFolderId, 'Balance Reports')
  const fileName = `${userName.replace(/[/\\:*?"<>|]/g, '_')}_Report_${rangeLabel}.pdf`
  const uploaded = await drive.files.create({
    requestBody: { name: fileName, parents: [reportsFolderId] },
    media: { mimeType: 'application/pdf', body: Readable.from(pdfBuffer) },
    fields: 'id, webViewLink',
  })
  await drive.permissions.create({ fileId: uploaded.data.id!, requestBody: { role: 'reader', type: 'anyone' } })
  const driveUrl = uploaded.data.webViewLink!

  await sb.from('balance_reports').insert({ user_id: userId, user_name: userName, drive_url: driveUrl, range_label: rangeLabel, amount: owedBalance, status: 'received' })

  // Archive exactly the rows this report summarized — this (not a synthetic
  // payment record) is what makes the next report start this user's count
  // from zero; unreported rows created after this point keep accumulating
  // normally, and nothing already-reported is ever double-counted or lost.
  const workIds = (workRows || []).map(r => r.id)
  const otherIds = (otherWork || []).map(r => r.id)
  const paymentIds = confirmedPayments.map(p => p.id)
  if (workIds.length) await sb.from('work_counts').update({ reported: true }).in('id', workIds)
  if (otherIds.length) await sb.from('other_work').update({ reported: true }).in('id', otherIds)
  if (paymentIds.length) await sb.from('salary_payments').update({ reported: true }).in('id', paymentIds)

  // If more was received than earned this period, the excess isn't "used
  // up" by this report — it's still real money sitting with this person,
  // so it carries forward as a fresh (unreported) payment for the next
  // period, exactly as if it had just been received today. e.g. earned
  // 1000, received 2000 this period -> report shows balance 1000; next
  // period starts earned 0, received 1000 (not 0), balance still 1000,
  // until new work is done. If earned exceeded received (still owed),
  // nothing carries forward automatically on the received side — the
  // owed amount is this report's own `amount` figure for manual follow-up.
  const leftover = totalReceived - totalEarned
  if (leftover > 0) {
    await sb.from('salary_payments').insert({
      from_user_id: userId, from_user_name: 'System', to_user_id: userId, to_display_name: userName,
      amount: leftover, status: 'confirmed', responded_at: new Date().toISOString(),
      note: `Carried forward from report ${rangeLabel}`,
    })
  }

  return { ok: true, driveUrl, rangeLabel, amount: owedBalance }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const authed = await requireAdmin(req)
  if (!authed.ok) return res.status(authed.status).json({ error: authed.error })
  if (req.method !== 'POST') return res.status(405).end()
  try {
    const { user_id } = req.body as { user_id: string }
    if (!user_id) return res.status(400).json({ error: 'user_id required' })
    const result = await buildReport(user_id)
    if (!result.ok) return res.status(400).json({ error: result.error })
    res.json(result)
  } catch (err: any) {
    console.error('[generate-balance-report] error:', err)
    res.status(500).json({ error: err.message })
  }
}

export { buildReport }
