import type { NextApiRequest, NextApiResponse } from 'next'
const nodemailer = require('nodemailer')

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  try {
    const { to, subject, body, boatNotes, cusdecNo } = req.body
    if (!to || !subject) return res.status(400).json({ error: 'Missing to or subject' })

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASS },
    })

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
      from: `"Export System" <${process.env.GMAIL_USER}>`,
      to, subject, html,
    })

    res.json({ ok: true })
  } catch (err: any) {
    console.error('send-email error:', err.message)
    res.status(500).json({ error: err.message })
  }
}
