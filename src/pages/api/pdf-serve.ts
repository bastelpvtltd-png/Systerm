import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// CORS proxy for temp-pdfs Storage files — Sejda fetches this URL
// GET /api/pdf-serve?file=FILENAME (the filename stored in temp-pdfs bucket)
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end()

  const { file } = req.query
  if (!file || typeof file !== 'string' || !file.endsWith('.pdf')) return res.status(400).end()

  const { data, error } = await supabase.storage.from('temp-pdfs').download(file)
  if (error || !data) return res.status(404).end()

  const buffer = Buffer.from(await data.arrayBuffer())
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', 'inline; filename="document.pdf"')
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Cache-Control', 'public, max-age=3600')
  res.send(buffer)
}
