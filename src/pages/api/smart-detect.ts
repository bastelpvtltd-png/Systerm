import type { NextApiRequest, NextApiResponse } from 'next'
import {
  detectType, extractByType, extractTextFromPdf, isScanned,
  type DocType,
} from '@/lib/extractors'

export const config = { api: { bodyParser: { sizeLimit: '20mb' } } }

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  try {
    const { base64, forceType } = req.body
    if (!base64) return res.status(400).json({ error: 'No file data' })

    const buffer  = Buffer.from(base64, 'base64')
    const rawText = await extractTextFromPdf(buffer)

    if (isScanned(rawText)) {
      return res.json({
        docType: 'unknown', fields: [], rawText, scanned: true,
        warning: 'Scanned image PDF — text extraction not possible.',
      })
    }

    const docType: DocType = forceType ?? detectType(rawText)
    const fields           = extractByType(docType, rawText)

    const filled = fields.filter(f => f.value).length
    console.log(`[smart-detect] type=${docType} forced=${!!forceType} filled=${filled}/${fields.length}`)

    res.json({ docType, fields, rawText: rawText.slice(0, 3000), scanned: false })
  } catch (err: any) {
    console.error('[smart-detect]', err)
    res.status(500).json({ error: err.message })
  }
}
