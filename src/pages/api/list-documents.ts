import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end()
  try {
    const { doc_type } = req.query
    let query = supabaseAdmin
      .from('uploaded_documents')
      .select('id, doc_type, file_name, drive_url, extracted_data, created_at')
      .order('created_at', { ascending: false })
      .limit(50)

    if (doc_type) query = query.eq('doc_type', doc_type as string)

    const { data, error } = await query
    if (error) return res.status(400).json({ error: error.message })
    res.json({ records: data || [] })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
}
