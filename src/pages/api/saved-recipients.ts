import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Remembers every email address a document was ever sent to, so the "email
// this PDF" prompts (Upload Docs, its Preview list, Shipment Overview) offer
// them back as suggestions instead of needing to be retyped every time.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method === 'GET') {
      const { data, error } = await supabaseAdmin.from('saved_recipients').select('email').order('email')
      if (error) throw error
      return res.json({ emails: (data || []).map(r => r.email) })
    }
    if (req.method === 'POST') {
      const email = String(req.body.email || '').trim()
      if (!email) return res.status(400).json({ error: 'email required' })
      const { error } = await supabaseAdmin.from('saved_recipients').upsert({ email }, { onConflict: 'email' })
      if (error) throw error
      return res.json({ ok: true })
    }
    res.status(405).end()
  } catch (err: any) {
    console.error('[saved-recipients] error:', err)
    res.status(500).json({ error: err.message })
  }
}
