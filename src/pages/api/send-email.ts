import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '@/lib/serverAuth'
const nodemailer = require('nodemailer')

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Most attachments are Drive-hosted files fetched by url; a few callers
// (e.g. Done Boat Note's merge, which is deliberately never saved anywhere)
// only have the bytes in memory, so they send base64 directly instead.
interface Attachment { filename: string; url?: string; base64?: string }

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  try {
    const { to, cc, bcc, subject, body, boatNotes, cusdecNo, attachments, useDocsAccount } = req.body as {
      to: string; cc?: string; bcc?: string; subject: string; body?: string; boatNotes?: any[]; cusdecNo?: string
      attachments?: Attachment[]; useDocsAccount?: boolean
    }
    if (!to || !subject) return res.status(400).json({ error: 'Missing to or subject' })

    // Document emails (Upload Docs / Shipment Overview) send from a separate
    // docs.bastel@gmail.com mailbox instead of the boat-note account, so
    // recipients see mail specifically about their documents from that address.
    const user = useDocsAccount ? process.env.DOCS_GMAIL_USER : process.env.GMAIL_USER
    const pass = useDocsAccount ? process.env.DOCS_GMAIL_APP_PASS : process.env.GMAIL_APP_PASS
    if (!user || !pass) return res.status(500).json({ error: `${useDocsAccount ? 'DOCS_GMAIL_USER/DOCS_GMAIL_APP_PASS' : 'GMAIL_USER/GMAIL_APP_PASS'} not configured` })

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user, pass },
    })

    let mailAttachments: { filename: string; content: Buffer }[] | undefined
    if (attachments?.length) {
      mailAttachments = await Promise.all(attachments.map(async a => {
        if (a.base64) return { filename: a.filename, content: Buffer.from(a.base64, 'base64') }
        const r = await fetch(a.url!)
        const buf = Buffer.from(await r.arrayBuffer())
        return { filename: a.filename, content: buf }
      }))
    }

    const html = `
      <h3>${subject}</h3>
      <p>${(body || '').replace(/\n/g, '<br>')}</p>
      ${boatNotes?.length ? `
        <hr>
        <h4>Boat Note Summary:</h4>
        <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-size:13px">
          <tr style="background:#1B3A5C;color:white">
            <th>#</th><th>Container</th><th>CDN No.</th><th>Driver</th><th>Gross (Kg)</th>
          </tr>
          ${boatNotes.map((bn: any, i: number) => `
            <tr>
              <td>${i+1}</td>
              <td>${bn.container_no}</td>
              <td>${bn.cdn_no}</td>
              <td>${bn.driver_name}</td>
              <td>${bn.gross_mass}</td>
            </tr>`).join('')}
        </table>
      ` : ''}
      <hr>
      <p style="color:#999;font-size:12px">Sent from Export Management System · CUSDEC ${cusdecNo || ''}</p>
    `

    await transporter.sendMail({
      from: `"Bastel Official System" <${user}>`,
      to, cc: cc || undefined, bcc: bcc || undefined, subject, html,
      attachments: mailAttachments,
    })

    // Mail History (Preview tab) reads this — best-effort, a logging failure
    // shouldn't fail a mail that already sent successfully.
    try {
      const authed = await requireAuth(req)
      let sentByName = ''
      if (authed.ok) {
        const { data: prof } = await supabaseAdmin.from('profiles').select('username, full_name').eq('id', authed.userId).maybeSingle()
        sentByName = prof?.full_name || prof?.username || ''
      }
      await supabaseAdmin.from('email_log').insert({
        sent_by: authed.ok ? authed.userId : null, sent_by_name: sentByName,
        to_addresses: to, cc_addresses: cc || null, bcc_addresses: bcc || null,
        subject, attachment_names: (attachments || []).map(a => a.filename).join(', ') || null,
      })
    } catch (e: any) {
      console.error('[send-email] history log failed:', e.message)
    }

    res.json({ ok: true })
  } catch (err: any) {
    console.error('send-email error:', err.message)
    res.status(500).json({ error: err.message })
  }
}
