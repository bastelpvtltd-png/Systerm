// Lets the SERVER keep the Barcode Enter queue moving on its own — no browser tab needed.
//
// One serverless run (runSlice) can only work for ~5 minutes. When containers are still queued
// afterwards, the finishing run starts the next one by calling /api/automation-run itself
// (authorised with WORKER_SECRET), and /api/automation-jobs does the same right after "Run".
// The call only has to be DISPATCHED, not awaited: we hang up after a moment and the new run
// carries on by itself. The runner's DB lock makes overlapping calls harmless.
export async function kickRunner(origin: string): Promise<boolean> {
  const secret = process.env.WORKER_SECRET
  if (!secret || !origin) return false
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), 2500)
  try {
    await fetch(`${origin}/api/automation-run`, {
      method: 'POST', headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      body: '{}', signal: ctl.signal,
    })
  } catch { /* aborted on purpose once the request has been sent */ }
  finally { clearTimeout(timer) }
  return true
}

export function originOf(req: { headers: Record<string, any> }): string {
  const host = String(req.headers.host || '')
  const proto = String(req.headers['x-forwarded-proto'] || (/^(localhost|127\.0\.0\.1)/.test(host) ? 'http' : 'https')).split(',')[0]
  return host ? `${proto}://${host}` : ''
}
