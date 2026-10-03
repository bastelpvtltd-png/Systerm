import type { NextApiRequest } from 'next'
import crypto from 'crypto'

// The browser worker (worker/ folder) has no Supabase login — it authenticates
// with a shared secret instead (WORKER_SECRET env var, same value on Vercel and
// on the machine running the worker). Compared in constant time.
export function requireWorker(req: NextApiRequest): { ok: true } | { ok: false; status: number; error: string } {
  const expected = process.env.WORKER_SECRET
  if (!expected) return { ok: false, status: 500, error: 'WORKER_SECRET is not configured' }
  const header = req.headers.authorization || ''
  const given = header.startsWith('Bearer ') ? header.slice(7) : ''
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, status: 401, error: 'Unauthorized' }
  return { ok: true }
}
