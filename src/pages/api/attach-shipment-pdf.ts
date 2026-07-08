import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Auto-attach step: once a generated Invoice/Packing List PDF has been
// uploaded to Drive, link it onto the matching temporary_shipments row (by
// invoice number) so the shipment carries its own paperwork even before a
// CUSDEC exists for it. No matching row is not an error — the PDF still
// downloaded and was logged in uploaded_documents either way.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  try {
    const { invoice_number, doc_type, url } = req.body
    if (!invoice_number || !url || !['invoice', 'packing_list'].includes(doc_type)) {
      return res.status(400).json({ error: 'invoice_number, doc_type (invoice|packing_list) and url are required' })
    }
    const column = doc_type === 'invoice' ? 'invoice_pdf_url' : 'packing_list_pdf_url'
    const { data, error } = await supabaseAdmin
      .from('temporary_shipments')
      .update({ [column]: url })
      .eq('invoice_number', invoice_number)
      .select()
    if (error) return res.status(400).json({ error: error.message })
    res.json({ attached: (data || []).length > 0 })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
}
