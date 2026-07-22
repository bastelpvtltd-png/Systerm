import { useEffect, useRef, useState } from 'react'
import ShipperLayout from '@/components/shipper/ShipperLayout'
import { authHeader } from '@/lib/supabase'
import { Loader, Plus, CheckCircle, Clock, ExternalLink, FileText } from 'lucide-react'

interface CusdecRow { id: string; code: string; number: string; exporter: string; reference?: string; invoice_number?: string; cap?: string; created_at: string }
interface ShipmentEntryRow {
  id: string; reference: string; invoice_number: string; packing_number?: string; consignee?: string
  real_cap?: string; cap?: string; invoice_drive_url?: string; packing_drive_url?: string; license_drive_url?: string
  created_at: string
}

// Same file-upload shape the real admin Shipment Entry form uses (see
// shipment-entry.tsx's FileUploadField) — reused here so shippers upload
// through the exact same /api/upload-to-drive path, not a stripped-down copy.
function FileUploadField({ label, onUpload, currentUrl, uploading }: {
  label: string; onUpload: (base64: string, fileName: string) => void; currentUrl: string | null; uploading: boolean
}) {
  const ref = useRef<HTMLInputElement>(null)
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-0.5">{label}</label>
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => ref.current?.click()}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-dashed border-gray-300 text-xs text-gray-500 hover:border-green-400 hover:text-green-600 transition-colors">
          <FileText size={13}/>{uploading ? 'Uploading...' : currentUrl ? 'Replace' : 'Choose file'}
        </button>
        {currentUrl && <a href={currentUrl} target="_blank" rel="noreferrer" className="text-xs text-blue-600 underline truncate max-w-[140px]">View</a>}
        <input ref={ref} type="file" accept=".pdf,.PDF,.png,.jpg,.jpeg,.docx" className="hidden"
          onChange={async e => {
            const file = e.target.files?.[0]
            if (!file) return
            const base64 = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader()
              reader.onload = () => resolve((reader.result as string).split(',')[1])
              reader.onerror = reject
              reader.readAsDataURL(file)
            })
            onUpload(base64, file.name)
            e.target.value = ''
          }}/>
      </div>
    </div>
  )
}

function ShipperContent() {
  const [shipmentComplete, setShipmentComplete] = useState<CusdecRow[]>([])
  const [paymentComplete, setPaymentComplete] = useState<CusdecRow[]>([])
  const [inProgress, setInProgress] = useState<CusdecRow[]>([])
  const [myEntries, setMyEntries] = useState<ShipmentEntryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [packingNumber, setPackingNumber] = useState('')
  const [consignee, setConsignee] = useState('')
  const [realCap, setRealCap] = useState('')
  const [divideCap, setDivideCap] = useState('')
  const [invoiceFile, setInvoiceFile] = useState<{ url: string | null; uploading: boolean }>({ url: null, uploading: false })
  const [packingFile, setPackingFile] = useState<{ url: string | null; uploading: boolean }>({ url: null, uploading: false })
  const [licenseFile, setLicenseFile] = useState<{ url: string | null; uploading: boolean }>({ url: null, uploading: false })
  const [creating, setCreating] = useState(false)
  const [status, setStatus] = useState('')

  async function uploadFile(base64: string, fileName: string, slot: 'invoice' | 'packing' | 'license') {
    const setSlot = slot === 'invoice' ? setInvoiceFile : slot === 'packing' ? setPackingFile : setLicenseFile
    setSlot(s => ({ ...s, uploading: true }))
    try {
      const docType = slot === 'invoice' ? 'shipment-invoice' : slot === 'packing' ? 'shipment-packing' : 'shipment-license'
      const res = await fetch('/api/upload-to-drive', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ base64, fileName, docType }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Upload failed')
      setSlot({ url: d.driveLink, uploading: false })
    } catch (e: any) {
      setStatus(`Error: ${e.message}`)
      setSlot(s => ({ ...s, uploading: false }))
    }
  }

  async function load(silent = false) {
    if (!silent) setLoading(true)
    try {
      const res = await fetch('/api/shipper-data', { headers: await authHeader() })
      const d = await res.json()
      if (res.ok) {
        setShipmentComplete(d.shipmentComplete || []); setPaymentComplete(d.paymentComplete || [])
        setInProgress(d.inProgress || []); setMyEntries(d.myEntries || [])
      }
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
        body: JSON.stringify({
          invoice_number: invoiceNumber.trim(), packing_number: packingNumber.trim() || undefined,
          consignee: consignee.trim() || undefined, real_cap: realCap.trim() || undefined,
          cap: divideCap.trim() || undefined,
          invoice_drive_url: invoiceFile.url || undefined, packing_drive_url: packingFile.url || undefined,
          license_drive_url: licenseFile.url || undefined,
        }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      setStatus(`Shipment Entry created — Reference: ${d.shipment.reference}`)
      setInvoiceNumber(''); setPackingNumber(''); setConsignee(''); setRealCap(''); setDivideCap('')
      setInvoiceFile({ url: null, uploading: false }); setPackingFile({ url: null, uploading: false }); setLicenseFile({ url: null, uploading: false })
      load(true)
    } catch (e: any) { setStatus(`Error: ${e.message}`) }
    finally { setCreating(false) }
  }

  return (
    <div className="space-y-5">
      <div className="card">
        <h2 className="font-semibold text-gray-900 flex items-center gap-2 mb-3"><Plus size={17}/>Create Shipment Entry</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
          <input value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)} placeholder="Invoice number"
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm"/>
          <input value={packingNumber} onChange={e => setPackingNumber(e.target.value)} placeholder="Packing number (optional)"
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm"/>
          <input value={consignee} onChange={e => setConsignee(e.target.value)} placeholder="Consignee (optional)"
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm"/>
          <input value={realCap} onChange={e => setRealCap(e.target.value)} placeholder="Real CAP / container count (optional)"
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm"/>
          <input value={divideCap} onChange={e => setDivideCap(e.target.value)} placeholder="Divide CAP for this entry (optional)"
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm"/>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
          <FileUploadField label="Invoice" onUpload={(b, f) => uploadFile(b, f, 'invoice')} currentUrl={invoiceFile.url} uploading={invoiceFile.uploading}/>
          <FileUploadField label="Packing List" onUpload={(b, f) => uploadFile(b, f, 'packing')} currentUrl={packingFile.url} uploading={packingFile.uploading}/>
          <FileUploadField label="License" onUpload={(b, f) => uploadFile(b, f, 'license')} currentUrl={licenseFile.url} uploading={licenseFile.uploading}/>
        </div>
        <button onClick={createEntry} disabled={creating || invoiceFile.uploading || packingFile.uploading || licenseFile.uploading}
          className="px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50" style={{ background: '#22A87A' }}>
          {creating ? <Loader size={14} className="animate-spin inline"/> : 'Create'}
        </button>
        {status && <p className="text-xs text-gray-600 mt-2">{status}</p>}
      </div>

      {!loading && (
        <div className="card">
          <h2 className="font-semibold text-gray-900 flex items-center gap-2 mb-3">My Shipment Entries</h2>
          {myEntries.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">You haven't submitted any yet</p>
          ) : (
            <div className="space-y-2">
              {myEntries.map(e => (
                <div key={e.id} className="border border-gray-100 rounded-lg p-3 text-sm">
                  <p className="font-medium text-gray-800">Ref: {e.reference} · Inv: {e.invoice_number}</p>
                  <p className="text-gray-400 text-xs">
                    {e.consignee ? `Consignee: ${e.consignee} · ` : ''}{e.real_cap ? `CAP: ${e.real_cap} · ` : ''}
                    {new Date(e.created_at).toLocaleDateString('en-GB')}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-10"><Loader size={20} className="animate-spin text-gray-400"/></div>
      ) : (
        <>
          <div className="card">
            <h2 className="font-semibold text-gray-900 flex items-center gap-2 mb-3"><CheckCircle size={17} className="text-green-600"/>Complete Shipment</h2>
            {shipmentComplete.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-6">None yet</p>
            ) : (
              <div className="space-y-2">
                {shipmentComplete.map(c => (
                  <div key={c.id} className="border border-gray-100 rounded-lg p-3 text-sm">
                    <p className="font-medium text-gray-800">CUSDEC {c.code} {c.number}</p>
                    <p className="text-gray-400 text-xs">{c.reference ? `Ref: ${c.reference} · ` : ''}{c.invoice_number ? `Inv: ${c.invoice_number}` : ''}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card">
            <h2 className="font-semibold text-gray-900 flex items-center gap-2 mb-3"><CheckCircle size={17} className="text-blue-600"/>Paid Shipment</h2>
            {paymentComplete.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-6">None yet</p>
            ) : (
              <div className="space-y-2">
                {paymentComplete.map(c => (
                  <div key={c.id} className="border border-gray-100 rounded-lg p-3 text-sm">
                    <p className="font-medium text-gray-800">CUSDEC {c.code} {c.number}</p>
                    <p className="text-gray-400 text-xs">{c.reference ? `Ref: ${c.reference} · ` : ''}{c.invoice_number ? `Inv: ${c.invoice_number}` : ''}</p>
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
