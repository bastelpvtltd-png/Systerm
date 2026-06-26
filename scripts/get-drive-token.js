/**
 * Run this ONCE to get a Google OAuth refresh token for Drive uploads.
 * Steps:
 *   1. Go to https://console.cloud.google.com/apis/credentials
 *   2. Create OAuth 2.0 Client ID (Desktop app type)
 *   3. Copy Client ID + Client Secret below
 *   4. node scripts/get-drive-token.js
 *   5. Open the URL shown, approve, paste the code
 *   6. Copy the refresh_token and add to Vercel env vars
 */

const { google } = require('googleapis')
const readline = require('readline')

const CLIENT_ID     = 'PASTE_YOUR_CLIENT_ID_HERE'
const CLIENT_SECRET = 'PASTE_YOUR_CLIENT_SECRET_HERE'
const REDIRECT_URI  = 'urn:ietf:wg:oauth:2.0:oob'

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI)

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  scope: ['https://www.googleapis.com/auth/drive.file'],
  prompt: 'consent',
})

console.log('\n=== Google Drive OAuth Setup ===')
console.log('\n1. Open this URL in your browser:\n')
console.log(authUrl)
console.log('\n2. Approve access, then paste the code below:\n')

const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
rl.question('Paste code here: ', async (code) => {
  rl.close()
  try {
    const { tokens } = await oauth2Client.getToken(code.trim())
    console.log('\n=== SUCCESS ===')
    console.log('Add these to Vercel env vars:\n')
    console.log('GOOGLE_CLIENT_ID    =', CLIENT_ID)
    console.log('GOOGLE_CLIENT_SECRET=', CLIENT_SECRET)
    console.log('GOOGLE_REFRESH_TOKEN=', tokens.refresh_token)
    console.log('\nvercel env add GOOGLE_CLIENT_ID')
    console.log('vercel env add GOOGLE_CLIENT_SECRET')
    console.log('vercel env add GOOGLE_REFRESH_TOKEN')
  } catch (err) {
    console.error('Error:', err.message)
  }
})
