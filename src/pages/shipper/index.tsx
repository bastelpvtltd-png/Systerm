import { useEffect, useState } from 'react'
import ShipperLayout from '@/components/shipper/ShipperLayout'
import { authHeader } from '@/lib/supabase'
import { Loader, Plus, CheckCircle, Clock, ExternalLink } from 'lucide-react'

interface CusdecRow { id: string; code: string; number: string; exporter: string; reference?: string; invoice_number?: string; pdf_url?: string; cap?: string; created_at: string }

function ShipperContent() {
  const [completed, setCompleted] = useState<CusdecRow[]>([])
  const [inProgress, setInProgress] = useState<CusdecRow[]>([])
  const [loading, setLoading] = useState(true)
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [packingNumber, setPackingNumber] = useState('')
  const [creating, setCreating] = useState(false)
  const [status, setStatus] = useState('')

  async function load(silent = false) {
    if (!silent) setLoading(true)
    try {
      const res = await fetch('/api/shipper-data', { headers: await authHeader() })
      const d = await res.json()
      if (res.ok) { setCompleted(d.completed || []); setInProgress(d.inProgress || []) }
    } finally {
      if (!silent) setLoading(false)
    }
  }
  useEffect(() => {
    load()
    const t = setInterval(() => load(true), 30000)
    return () => clearInterval(t)
  }, [])

  async function createEntry() {
    if (!invoiceNumber.trim()) { setStatus('Invoice number required'); return }
    setCreating(true); setStatus('')
    try {
      const res = await fetch('/api/shipper-data', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ invoice_number: invoiceNumber.trim(), packing_number: packingNumber.trim() || undefined }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      setStatus(`Shipment Entry created — Reference: ${d.shipment.reference}`)
      setInvoiceNumber(''); setPackingNumber('')
    } catch (e: any) { setStatus(`Error: ${e.message}`) }
    finally { setCreating(false) }
  }

  return (
    <div className="space-y-5">
      <div className="card">
        <h2 className="font-semibold text-gray-900 flex items-center gap-2 mb-3"><Plus size={17}/>Create Shipment Entry</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <input value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)} placeholder="Invoice number"
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm"/>
          <input value={packingNumber} onChange={e => setPackingNumber(e.target.value)} placeholder="Packing number (optional)"
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm"/>
          <button onClick={createEntry} disabled={creating} className="px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50" style={{ background: '#22A87A' }}>
            {creating ? <Loader size={14} className="animate-spin inline"/> : 'Create'}
          </button>
        </div>
        {status && <p className="text-xs text-gray-600 mt-2">{status}</p>}
      </div>

      {loading ? (
        <div className="flex justify-center py-10"><Loader size={20} className="animate-spin text-gray-400"/></div>
      ) : (
        <>
          <div className="card">
            <h2 className="font-semibold text-gray-900 flex items-center gap-2 mb-3"><CheckCircle size={17} className="text-green-600"/>Completed & Paid Shipments</h2>
            {completed.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-6">None yet</p>
            ) : (
              <div className="space-y-2">
                {completed.map(c => (
                  <div key={c.id} className="flex items-center justify-between border border-gray-100 rounded-lg p-3 text-sm">
                    <div>
                      <p className="font-medium text-gray-800">CUSDEC {c.code} {c.number}</p>
                      <p className="text-gray-400 text-xs">{c.reference ? `Ref: ${c.reference} · ` : ''}{c.invoice_number ? `Inv: ${c.invoice_number}` : ''}</p>
                    </div>
                    {c.pdf_url && <a href={c.pdf_url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline text-xs flex items-center gap-1"><ExternalLink size={12}/>View</a>}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card">
            <h2 className="font-semibold text-gray-900 flex items-center gap-2 mb-3"><Clock size={17} className="text-amber-500"/>In Progress</h2>
            {inProgress.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-6">None</p>
            ) : (
              <div className="space-y-2">
                {inProgress.map(c => (
                  <div key={c.id} className="flex items-center justify-between border border-gray-100 rounded-lg p-3 text-sm">
                    <div>
                      <p className="font-medium text-gray-800">CUSDEC {c.code} {c.number}</p>
                      <p className="text-gray-400 text-xs">{c.reference ? `Ref: ${c.reference} · ` : ''}{c.invoice_number ? `Inv: ${c.invoice_number}` : ''}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

export default function ShipperPortalPage() {
  return (
    <ShipperLayout>
      <ShipperContent/>
    </ShipperLayout>
  )
}
