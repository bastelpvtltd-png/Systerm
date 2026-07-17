import type { NextApiRequest, NextApiResponse } from 'next'

const PROJECT_ID = 'prj_VtKZfbxd5VISOAlYMmmbQsZfbNXW'
const BASE_URL = 'https://export-system.vercel.app'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { code, error } = req.query

  if (error) return res.setHeader('Content-Type', 'text/html').status(400).send(errorPage(String(error)))
  if (!code) return res.setHeader('Content-Type', 'text/html').status(400).send(errorPage('No authorization code received from Google'))

  const clientId = process.env.GOOGLE_CLIENT_ID!
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET!
  const vercelToken = process.env.VERCEL_DEPLOY_TOKEN!
  const redirectUri = `${BASE_URL}/api/auth/google-callback`

  // Exchange code → tokens
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: String(code),
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  })
  const tokenData = await tokenRes.json()

  if (!tokenRes.ok || !tokenData.refresh_token) {
    return res.setHeader('Content-Type', 'text/html').status(400).send(
      errorPage(`Token exchange failed: ${JSON.stringify(tokenData, null, 2)}`)
    )
  }

  // Find existing GOOGLE_REFRESH_TOKEN env var id
  const listRes = await fetch(`https://api.vercel.com/v9/projects/${PROJECT_ID}/env`, {
    headers: { Authorization: `Bearer ${vercelToken}` },
  })
  const listData = await listRes.json()
  const existing = listData.envs?.find((e: { key: string; id: string }) => e.key === 'GOOGLE_REFRESH_TOKEN')

  if (existing?.id) {
    await fetch(`https://api.vercel.com/v9/projects/${PROJECT_ID}/env/${existing.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${vercelToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: tokenData.refresh_token }),
    })
  } else {
    await fetch(`https://api.vercel.com/v9/projects/${PROJECT_ID}/env`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${vercelToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key: 'GOOGLE_REFRESH_TOKEN',
        value: tokenData.refresh_token,
        type: 'encrypted',
        target: ['production', 'preview', 'development'],
      }),
    })
  }

  // Trigger redeploy using latest deployment git source
  try {
    const depsRes = await fetch(`https://api.vercel.com/v6/deployments?projectId=${PROJECT_ID}&limit=1`, {
      headers: { Authorization: `Bearer ${vercelToken}` },
    })
    const depsData = await depsRes.json()
    const dep = depsData.deployments?.[0]
    if (dep) {
      await fetch('https://api.vercel.com/v13/deployments', {
        method: 'POST',
        headers: { Authorization: `Bearer ${vercelToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'export-system',
          project: PROJECT_ID,
          gitSource: {
            type: 'github',
            ref: dep.meta?.githubCommitRef || 'main',
            sha: dep.meta?.githubCommitSha,
            repoId: dep.meta?.githubRepoId,
          },
        }),
      })
    }
  } catch {}

  res.setHeader('Content-Type', 'text/html').send(successPage())
}

function errorPage(msg: string) {
  return `<!DOCTYPE html><html><head><title>Auth Error</title>
<style>body{font-family:sans-serif;padding:40px;text-align:center}pre{text-align:left;background:#f4f4f4;padding:16px;border-radius:8px;overflow:auto}</style>
</head><body>
<h2 style="color:#dc2626">❌ Google Auth Error</h2>
<pre>${msg}</pre>
<a href="/admin/google-reauth" style="color:#2563eb">← Try Again</a>
</body></html>`
}

function successPage() {
  return `<!DOCTYPE html><html><head><title>Re-auth Success</title>
<style>body{font-family:sans-serif;padding:40px;text-align:center;color:#111}</style>
</head><body>
<h2 style="color:#16a34a">✅ Google OAuth Re-authorized!</h2>
<p>New refresh token Vercel eke save una. New deploy start una — 2-3 minutes kulak ready wenawa.</p>
<p style="color:#6b7280;font-size:14px">Deploy ready wuna gaman Google Sheets auto-load wenawa.</p>
<br>
<a href="/admin/templates" style="color:#2563eb;text-decoration:none">← Templates page eka go karanna</a>
</body></html>`
}
