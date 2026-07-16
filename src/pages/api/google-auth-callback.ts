import type { NextApiRequest, NextApiResponse } from 'next'
import { google } from 'googleapis'

const REDIRECT = 'https://export-system.vercel.app/api/google-auth-callback'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const code = String(req.query.code || '')
  if (!code) return res.status(400).send('No code in callback')

  try {
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      REDIRECT
    )
    const { tokens } = await oauth2Client.getToken(code)
    const refresh = tokens.refresh_token

    res.setHeader('Content-Type', 'text/html')
    res.send(`
      <html><body style="font-family:monospace;padding:40px;background:#f0fdf4">
        <h2 style="color:#16a34a">✅ New Refresh Token</h2>
        <p>Copy this and send to Claude:</p>
        <textarea rows="4" style="width:100%;font-size:13px;padding:8px" onclick="this.select()">${refresh || '(no refresh_token — try again with prompt=consent)'}</textarea>
        <br/><br/>
        <p style="color:#6b7280;font-size:12px">Close this tab after copying.</p>
      </body></html>
    `)
  } catch (e: any) {
    res.status(500).send(`Error: ${e.message}`)
  }
}
