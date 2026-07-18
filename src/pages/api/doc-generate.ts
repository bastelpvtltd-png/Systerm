import type { NextApiRequest, NextApiResponse } from 'next'
import { requireAuth } from '@/lib/serverAuth'
import { generateDocumentPdf } from '@/lib/docGenerate'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  const authed = await requireAuth(req)
  if (!authed.ok) return res.status(authed.status).json({ error: authed.error })

  try {
    const { document_type, cusdec_id, manual_values, cdn_ids, fill_sheet_gid, print_sheet_gid } = req.body as {
      document_type: string
      cusdec_id?: string
      manual_values?: Record<string, string>
      cdn_ids?: string[]
      fill_sheet_gid?: string
      print_sheet_gid?: string
    }
    const result = await generateDocumentPdf({ document_type, cusdec_id, manual_values, cdn_ids, fill_sheet_gid, print_sheet_gid })
    res.json(result)
  } catch (e: any) {
    console.error('[doc-generate]', e)
    res.status(500).json({ error: e.message })
  }
}
