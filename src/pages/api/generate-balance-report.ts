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
// shows — CDN/CAP/Pytho/CO/SAFTA counts, approved Other Work, confirmed
// payments received) as a PDF, saves it to Drive, records it in
// balance_reports, and inserts a confirmed salary_payments row for the
// current owed balance so it carries forward — the report IS what zeroes
// the running balance, same idea as physically handing over a payslip.
async function buildReport(userId: string): Promise<{ ok: true; driveUrl: string; rangeLabel: string; amount: number } | { ok: false; error: string }> {
  const { data: prof } = await sb.from('profiles').select('username, full_name').eq('id', userId).maybeSingle()
  if (!prof) return { ok: false, error: 'User not found' }
  const userName = prof.full_name || prof.username || ''

  const { data: rates } = await sb.from('work_rates').select('*').eq('id', 'global').single()
  const { data: workRows } = await sb.from('work_counts').select('*').eq('user_id', userId)
  const { data: otherWork } = await sb.from('other_work').select('*').eq('user_id', userId)
  const { data: payments } = await sb.from('salary_payments').select('*').or(`to_user_id.eq.${userId}`)
  const { data: approvals } = await sb.from('doc_approvals').select('*').eq('uploaded_by', userId)

  const cdn = (workRows || []).reduce((s, r) => s + (r.cdn_inc || 0), 0)
  const cap = (workRows || []).reduce((s, r) => s + (r.cap_inc || 0), 0)
  const pytho = (workRows || []).reduce((s, r) => s + (r.pytho_inc || 0), 0)
  const co = (workRows || []).reduce((s, r) => s + (r.co_inc || 0), 0)
  const safta = (workRows || []).reduce((s, r) => s + (r.safta_inc || 0), 0)
  const cdnRate = Number(rates?.cdn_rate) || 0, capRate = Number(rates?.cap_rate) || 0
  const pythoRate = Number(rates?.pytho_rate) || 0, coRate = Number(rates?.co_rate) || 0, saftaRate = Number(rates?.safta_rate) || 0
  const countEarned = cdn * cdnRate + cap * capRate + pytho * pythoRate + co * coRate + safta * saftaRate

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

  await sb.from('balance_reports').insert({ user_id: userId, user_name: userName, drive_url: driveUrl, range_label: rangeLabel, amount: owedBalance })

  // The report itself is what zeroes the balance going forward — a
  // confirmed payment record dated today, described by the report.
  if (owedBalance > 0) {
    await sb.from('salary_payments').insert({
      from_user_id: userId, from_user_name: 'System', to_user_id: userId, to_display_name: userName,
      amount: owedBalance, status: 'confirmed', responded_at: new Date().toISOString(),
      note: `Report ${rangeLabel}`,
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
