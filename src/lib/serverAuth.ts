import type { NextApiRequest } from 'next'
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Several destructive/sensitive API routes (create-user, delete-row, ...)
// had no server-side auth check at all — anyone who found the URL could hit
// them directly regardless of what the frontend hides. This verifies the
// caller's Supabase access token (sent as a Bearer header) and confirms
// they're an is_admin account before the handler does anything.
// Any signed-in account — used by routes normal (non-admin) users legitimately
// call too, like resolving an upload duplicate. Just proves there's a real
// session behind the request, not an unauthenticated script hitting the URL.
export async function requireAuth(req: NextApiRequest): Promise<{ ok: true; userId: string } | { ok: false; status: number; error: string }> {
  const authHeader = req.headers.authorization || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  if (!token) return { ok: false, status: 401, error: 'Not authenticated' }

  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token)
  if (error || !user) return { ok: false, status: 401, error: 'Invalid or expired session' }

  return { ok: true, userId: user.id }
}

export async function requireAdmin(req: NextApiRequest): Promise<{ ok: true; userId: string } | { ok: false; status: number; error: string }> {
  const authed = await requireAuth(req)
  if (!authed.ok) return authed

  const { data: prof } = await supabaseAdmin.from('profiles').select('is_admin').eq('id', authed.userId).single()
  if (!prof?.is_admin) return { ok: false, status: 403, error: 'Admin access required' }

  return authed
}
