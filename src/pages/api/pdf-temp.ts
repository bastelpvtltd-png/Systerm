import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '@/lib/serverAuth'

export const config = { api: { bodyParser: { sizeLimit: '30mb' } } }

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  const authed = await requireAuth(req)
  if (!authed.ok) return res.status(authed.status).json({ error: authed.error })

  const { base64 } = req.body
  if (!base64 || typeof base64 !== 'string') return res.status(400).json({ error: 'base64 required' })

  const buffer = Buffer.from(base64, 'base64')
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.pdf`

  const { error } = await supabase.storage
    .from('temp-pdfs')
    .upload(filename, buffer, { contentType: 'application/pdf', upsert: false })

  if (error) return res.status(500).json({ error: error.message })

  res.json({ filename })
}
