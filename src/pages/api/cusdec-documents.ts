import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '@/lib/serverAuth'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Powers Automation > Merge PDF's CUSDEC picker — every Drive-hosted PDF
// already saved anywhere under a given CUSDEC: its own uploaded PDF, Boat
// Note, Party's Copy, each of its CDNs' own uploaded PDF, and each of
// those CDNs' matching Barcode PDF. Purely a read/list — nothing here
// touches Drive or any table.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end()
  const authed = await requireAuth(req)
  if (!authed.ok) return res.status(authed.status).json({ error: authed.error })
  try {
    const ids = String(req.query.cusdec_ids || '').split(',').filter(Boolean)
    if (!ids.length) return res.status(400).json({ error: 'cusdec_ids required' })

    const { data: cusdecs } = await supabaseAdmin.from('cusdec')
      .select('id, code, number, exporter, pdf_url, boat_note_url, party_copy_url').in('id', ids)
    if (!cusdecs?.length) return res.json({ groups: [] })

    const { data: cdns } = await supabaseAdmin.from('cdn')
      .select('id, code, cusdec_number, container_no, pdf_url')
      .in('code', Array.from(new Set(cusdecs.map(c => c.code))))
    const containerNos = Array.from(new Set((cdns || []).map(d => d.container_no).filter(Boolean)))
    const { data: barcodes } = containerNos.length
      ? await supabaseAdmin.from('barcode').select('container_no, pdf_url').in('container_no', containerNos)
      : { data: [] as { container_no: string; pdf_url: string | null }[] }
    const barcodeByContainer = new Map((barcodes || []).map(b => [b.container_no, b.pdf_url]))

    const groups = cusdecs.map(c => {
      const documents: { key: string; label: string; url: string }[] = []
      if (c.pdf_url) documents.push({ key: `cusdec-${c.id}`, label: `CUSDEC E ${c.number}`, url: c.pdf_url })
      if (c.boat_note_url) documents.push({ key: `boatnote-${c.id}`, label: `Boat Note — E ${c.number}`, url: c.boat_note_url })
      if (c.party_copy_url) documents.push({ key: `party-${c.id}`, label: `Party's Copy — E ${c.number}`, url: c.party_copy_url })

      const ownCdns = (cdns || []).filter(d => d.code === c.code && d.cusdec_number === c.number)
      for (const d of ownCdns) {
        if (d.pdf_url) documents.push({ key: `cdn-${d.id}`, label: `CDN ${d.container_no || d.id}`, url: d.pdf_url })
        const barcodeUrl = d.container_no ? barcodeByContainer.get(d.container_no) : null
        if (barcodeUrl) documents.push({ key: `barcode-${d.id}`, label: `Barcode ${d.container_no}`, url: barcodeUrl })
      }

      return { cusdecId: c.id, number: c.number, exporter: c.exporter, documents }
    })

    res.json({ groups })
  } catch (err: any) {
    console.error('[cusdec-documents] error:', err)
    res.status(500).json({ error: err.message })
  }
}
