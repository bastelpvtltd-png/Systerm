import type { NextApiRequest, NextApiResponse } from 'next'
import { google } from 'googleapis'

const REDIRECT = 'https://export-system.vercel.app/api/google-auth-callback'

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    REDIRECT
  )
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/drive', 'https://www.googleapis.com/auth/spreadsheets'],
    prompt: 'consent',
  })
  res.redirect(url)
}
