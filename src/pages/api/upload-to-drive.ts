import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'

export const config = { api: { bodyParser: { sizeLimit: '20mb' } } }

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  try {
    const { base64, fileName, mimeType = 'application/pdf' } = req.body
    if (!base64 || !fileName) return res.status(400).json({ error: 'Missing base64 or fileName' })

    const buffer = Buffer.from(base64, 'base64')
    const path = `uploads/${Date.now()}_${fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`

    const { error: uploadError } = await supabaseAdmin.storage
      .from('export-docs')
      .upload(path, buffer, { contentType: mimeType, upsert: false })

    if (uploadError) throw new Error(uploadError.message)

    const { data: urlData } = supabaseAdmin.storage
      .from('export-docs')
      .getPublicUrl(path)

    const publicUrl = urlData?.publicUrl || ''
    res.json({ driveId: path, driveLink: publicUrl })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
}
