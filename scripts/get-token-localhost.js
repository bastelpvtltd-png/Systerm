const { google } = require('googleapis')
const http = require('http')
const fs = require('fs')
const path = require('path')

function loadEnv() {
  const text = fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8')
  const env = {}
  for (const line of text.split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m) env[m[1]] = m[2].trim()
  }
  return env
}

const env = loadEnv()
const CLIENT_ID = env.GOOGLE_CLIENT_ID
const CLIENT_SECRET = env.GOOGLE_CLIENT_SECRET
const REDIRECT = 'http://localhost:3001/callback'

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Missing GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET in .env.local')
  process.exit(1)
}

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT)

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  scope: ['https://www.googleapis.com/auth/drive', 'https://www.googleapis.com/auth/spreadsheets'],
  prompt: 'consent'
})

console.log('\n=== Open this URL in your browser ===\n')
console.log(authUrl)
console.log('\nWaiting for callback on http://localhost:3001/callback ...\n')

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost:3001')
  const code = url.searchParams.get('code')
  if (!code) { res.end('No code'); return }

  res.end('<h2>Success! You can close this tab. Check the terminal.</h2>')
  server.close()

  try {
    const { tokens } = await oauth2Client.getToken(code)
    console.log('\n=== NEW REFRESH TOKEN ===\n')
    console.log(tokens.refresh_token)
    console.log('\nCopy this and tell Claude.\n')
  } catch (e) {
    console.error('Token exchange failed:', e.message)
  }
})

server.listen(3001, () => {
  console.log('Local server ready on port 3001')
})
