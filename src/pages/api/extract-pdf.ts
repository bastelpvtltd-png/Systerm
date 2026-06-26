import type { NextApiRequest, NextApiResponse } from 'next'
import pdfParse from 'pdf-parse'
import { extractCdn, extractCusdec } from '@/lib/extractPdf'

export const config = { api: { bodyParser: { sizeLimit: '20mb' } } }

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  try {
    const { base64, docType } = req.body
    if (!base64) return res.status(400).json({ error: 'No file data' })

    const buffer = Buffer.from(base64, 'base64')
    const parsed = await pdfParse(buffer)
    const text = parsed.text

    let fields = []
    if (docType === 'cusdec') fields = extractCusdec(text)
    else if (docType === 'cdn') fields = extractCdn(text)

    res.json({ fields, rawText: text })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
}
