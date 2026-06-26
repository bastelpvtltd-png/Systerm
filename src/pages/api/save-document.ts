import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  try {
    const { doc_type, file_name, file_url, drive_url, extracted_data } = req.body

    const { data, error } = await supabaseAdmin
      .from('uploaded_documents')
      .insert({ doc_type, file_name, file_url: file_url || '', drive_url: drive_url || '', extracted_data: extracted_data || null })
      .select()
      .single()

    if (error) return res.status(400).json({ error: error.message })
    res.json({ id: data.id })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
}
