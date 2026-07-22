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

// Builds one user's balance report as a bank-statement-style PDF: an
// opening balance brought forward from their last report, every upload/
// billing transaction since then (full detail, nothing summarized away),
// this period's totals, and a closing balance — then archives exactly the
// work_counts/other_work rows it summarized (reported=true) so the next
// report starts this user's count at zero without losing history.
//
// The opening balance is simply the PREVIOUS report's closing `amount` —
// no synthetic payment row needed. This replaces an earlier design that
// tried to carry a leftover balance forward as a fake salary_payments row,
// which was fragile and, per the person actually using it, wasn't landing
// correctly. A real opening_balance column on the report itself is the
// direct, unambiguous way to state "here's what carried in."
async function buildReport(userId: string): Promise<{ ok: true; driveUrl: string; rangeLabel: string; amount: number } | { ok: false; error: string }> {
  const { data: prof } = await sb.from('profiles').select('username, full_name').eq('id', userId).maybeSingle()
  if (!prof) return { ok: false, error: 'User not found' }
  const userName = prof.full_name || prof.username || ''

  const { data: rates } = await sb.from('work_rates').select('*').eq('id', 'global').single()
  const { data: workRows } = await sb.from('work_counts').select('*').eq('user_id', userId).eq('reported', false)
  const { data: otherWork } = await sb.from('other_work').select('*').eq('user_id', userId).eq('reported', false)
  const { data: payments } = await sb.from('salary_payments').select('*').eq('to_user_id', userId).eq('reported', false)
  const { data: approvals } = await sb.from('doc_approvals').select('*').eq('uploaded_by', userId)
  const { data: lastReport } = await sb.from('balance_reports').select('amount').eq('user_id', userId).order('generated_at', { ascending: false }).limit(1).maybeSingle()
  const openingBalance = Number(lastReport?.amount) || 0

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
  const periodEarned = countEarned + otherEarned

  const confirmedPayments = (payments || []).filter(p => p.status === 'confirmed')
  const periodReceived = confirmedPayments.reduce((s, p) => s + Number(p.amount), 0)

  // Closing balance = what came in before + what came in this period, minus
  // what was earned this period. Positive = still owed to this person.
  const closingBalance = openingBalance + periodReceived - periodEarned

  const now = new Date()
  const rangeLabel = now.toISOString().slice(0, 10)

  const doc = new jsPDF()
  let y = 18
  const line = (text: string, size = 10, bold = false) => {
    if (y > 275) { doc.addPage(); y = 18 }
    doc.setFontSize(size)
    doc.setFont('helvetica', bold ? 'bold' : 'normal')
    doc.text(text, 14, y)
    y += size < 12 ? 6 : 8
  }
  line('Bastel Official System — Balance Statement', 16, true)
  line(`${userName}  ·  Statement date: ${rangeLabel}`, 10)
  y += 4
  line(`Brought forward from previous report: Rs.${openingBalance.toFixed(2)}`, 11, true)
  y += 2

  line('Upload Count History', 12, true)
  line(`CDN: ${cdn} x Rs.${cdnRate.toFixed(2)} = Rs.${(cdn * cdnRate).toFixed(2)}`)
  line(`CAP: ${cap} x Rs.${capRate.toFixed(2)} = Rs.${(cap * capRate).toFixed(2)}`)
  if (pytho) line(`Pytho: ${pytho} x Rs.${pythoRate.toFixed(2)} = Rs.${(pytho * pythoRate).toFixed(2)}`)
  if (co) line(`CO: ${co} x Rs.${coRate.toFixed(2)} = Rs.${(co * coRate).toFixed(2)}`)
  if (safta) line(`SAFTA: ${safta} x Rs.${saftaRate.toFixed(2)} = Rs.${(safta * saftaRate).toFixed(2)}`)
  if (boatNote) line(`Boat Cap: ${boatNote} x Rs.${boatNoteRate.toFixed(2)} = Rs.${(boatNote * boatNoteRate).toFixed(2)}`)
  y += 2

  // Statement-style transaction list — every upload/billing entry this
  // report covers, in full, not just a category total. Once this report is
  // generated these exact rows are archived (reported=true) and drop out of
  // the NEXT report entirely — this listing is their only permanent record.
  line('Transactions This Period', 12, true)
  const breakdownFields: [string, string][] = [['cdn_inc', 'CDN'], ['cap_inc', 'CAP'], ['pytho_inc', 'Pytho'], ['co_inc', 'CO'], ['safta_inc', 'SAFTA'], ['boat_note_inc', 'Boat Cap']]
  const txns = (workRows || [])
    .flatMap(r => breakdownFields.filter(([f]) => ((r as any)[f] || 0) > 0).map(([f, label]) => ({ date: r.created_at, label, v: (r as any)[f], detail: r.reason || r.action || '' })))
    .sort((a, b) => a.date.localeCompare(b.date))
  if (!txns.length) line('None', 9)
  for (const t of txns) line(`${new Date(t.date).toLocaleDateString('en-GB')} — ${t.label} +${t.v} — ${t.detail}`, 9)
  y += 2

  line('Bill / Other Work History', 12, true)
  if (!approvedOther.length) line('None')
  for (const ow of approvedOther) line(`${new Date(ow.created_at).toLocaleDateString('en-GB')} — ${ow.description} — Rs.${Number(ow.amount).toFixed(2)}`)
  y += 2

  line('Approval / Reject Data', 12, true)
  const approvedCount = (approvals || []).filter(a => a.status === 'approved').length
  const rejectedCount = (approvals || []).filter(a => a.status === 'rejected').length
  const pendingCount = (approvals || []).filter(a => a.status === 'pending').length
  line(`CUSDEC uploads — Approved: ${approvedCount}, Rejected: ${rejectedCount}, Pending: ${pendingCount}`)
  y += 2

  line('Payments Received This Period', 12, true)
  if (!confirmedPayments.length) line('None received yet')
  for (const p of confirmedPayments) line(`${new Date(p.created_at).toLocaleDateString('en-GB')} — Rs.${Number(p.amount).toFixed(2)}`)
  y += 4

  line('Summary', 12, true)
  line(`Brought forward: Rs.${openingBalance.toFixed(2)}`)
  line(`Earned this period: Rs.${periodEarned.toFixed(2)}`)
  line(`Received this period: Rs.${periodReceived.toFixed(2)}`)
  line(`Closing balance: Rs.${closingBalance.toFixed(2)}`, 12, true)

  const pdfBuffer = Buffer.from(doc.output('arraybuffer'))

  const mainFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID || ''
  if (!mainFolderId) return { ok: false, error: 'GOOGLE_DRIVE_FOLDER_ID not configured' }
  const drive = getDriveClient()
  const reportsFolderId = await getOrCreateSubfolder(drive, mainFolderId, 'Balance Reports')
  const fileName = `${userName.replace(/[/\\:*?"<>|]/g, '_')}_Statement_${rangeLabel}.pdf`
  const uploaded = await drive.files.create({
    requestBody: { name: fileName, parents: [reportsFolderId] },
    media: { mimeType: 'application/pdf', body: Readable.from(pdfBuffer) },
    fields: 'id, webViewLink',
  })
  await drive.permissions.create({ fileId: uploaded.data.id!, requestBody: { role: 'reader', type: 'anyone' } })
  const driveUrl = uploaded.data.webViewLink!

  await sb.from('balance_reports').insert({
    user_id: userId, user_name: userName, drive_url: driveUrl, range_label: rangeLabel,
    amount: closingBalance, status: 'received',
    opening_balance: openingBalance, period_earned: periodEarned, period_received: periodReceived,
  })

  // Archive exactly the rows this report summarized — the next report's
  // opening_balance (read from this report's `amount` above) is what
  // carries the closing figure forward; unreported rows created after this
  // point keep accumulating normally for the next period.
  const workIds = (workRows || []).map(r => r.id)
  const otherIds = (otherWork || []).map(r => r.id)
  const paymentIds = confirmedPayments.map(p => p.id)
  if (workIds.length) await sb.from('work_counts').update({ reported: true }).in('id', workIds)
  if (otherIds.length) await sb.from('other_work').update({ reported: true }).in('id', otherIds)
  if (paymentIds.length) await sb.from('salary_payments').update({ reported: true }).in('id', paymentIds)

  return { ok: true, driveUrl, rangeLabel, amount: closingBalance }
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
