import type { NextApiRequest, NextApiResponse } from 'next'
import { extractBox } from '@/lib/boxExtract'

export const config = { api: { bodyParser: { sizeLimit: '20mb' } } }

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  try {
    const { base64, box } = req.body
    if (!base64 || !box) return res.status(400).json({ error: 'base64 and box required' })

    const buffer = Buffer.from(base64, 'base64')
    const text = await extractBox(buffer, box)
    res.json({ text })
  } catch (err: any) {
    console.error('[extract-box] error:', err)
    res.status(500).json({ error: err.message })
  }
}
