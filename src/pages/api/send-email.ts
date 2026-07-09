import type { NextApiRequest, NextApiResponse } from 'next'
const nodemailer = require('nodemailer')

interface Attachment { filename: string; url: string }

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  try {
    const { to, subject, body, boatNotes, cusdecNo, attachments, useDocsAccount } = req.body as {
      to: string; subject: string; body?: string; boatNotes?: any[]; cusdecNo?: string
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
        const r = await fetch(a.url)
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
      to, subject, html,
      attachments: mailAttachments,
    })

    res.json({ ok: true })
  } catch (err: any) {
    console.error('send-email error:', err.message)
    res.status(500).json({ error: err.message })
  }
}
