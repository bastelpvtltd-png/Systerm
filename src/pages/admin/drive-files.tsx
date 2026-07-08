import { useEffect, useState } from 'react'
import AdminLayout from '@/components/admin/AdminLayout'
import { authHeader } from '@/lib/supabase'
import { Search, Loader, AlertTriangle, ExternalLink, Package, FileText, ScanLine, Anchor } from 'lucide-react'

// Shipment-wise overview: search by shipper / CUSDEC code / CUSDEC number /
// container number — each box is a real database value (still hand-typeable,
// via a <datalist>), and picking one narrows the others: choose a shipper
// and the code/number/container suggestions shrink to just that shipper's
// CUSDECs, choose a code and it narrows further, etc. Results show the full
// linked set — CUSDEC, its CDN rows (count should equal the CUSDEC's CAP),
// and each CDN's matching Barcode row (by container_no).
interface Cusdec { id: string; code: string; number: string; date: string; exporter: string; cap: string; pdf_url?: string; [k: string]: any }
interface Cdn { id: string; container_no: string; shipper: string; goods_description: string; gross_mass: string; pdf_url?: string; [k: string]: any }
interface Barcode { id: string; container_no: string; seal_no: string; truck_no: string; date: string; pdf_url?: string; [k: string]: any }
interface BoatNote { id: string; pdf_url?: string; details: Record<string, any> }
interface OverviewEntry { cusdec: Cusdec; cdns: { cdn: Cdn; barcode: Barcode | null }[]; boatNotes: BoatNote[] }
interface Options { shippers: string[]; codes: string[]; numbers: string[]; containers: string[]; references: string[]; invoiceNumbers: string[] }

export default function DriveFilesPage() {
  const [shipper, setShipper] = useState('')
  const [code, setCode] = useState('')
  const [number, setNumber] = useState('')
  const [containerNo, setContainerNo] = useState('')
  const [reference, setReference] = useState('')
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [options, setOptions] = useState<Options>({ shippers: [], codes: [], numbers: [], containers: [], references: [], invoiceNumbers: [] })
  const [results, setResults] = useState<OverviewEntry[]>([])
  const [orphanBoatNotes, setOrphanBoatNotes] = useState<BoatNote[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const [error, setError] = useState('')

  // Re-fetch suggestion lists whenever shipper/code/number changes, so
  // picking one narrows the others to what actually exists together.
  useEffect(() => {
    const params = new URLSearchParams()
    if (shipper) params.set('shipper', shipper)
    if (code) params.set('code', code)
    if (number) params.set('number', number)
    if (reference) params.set('reference', reference)
    if (invoiceNumber) params.set('invoice_number', invoiceNumber)
    fetch(`/api/shipment-overview-options?${params.toString()}`)
      .then(r => r.json())
      .then(d => setOptions({
        shippers: d.shippers || [], codes: d.codes || [], numbers: d.numbers || [],
        containers: d.containers || [], references: d.references || [], invoiceNumbers: d.invoiceNumbers || [],
      }))
      .catch(() => {})
  }, [shipper, code, number, reference, invoiceNumber])

  async function search() {
    setLoading(true)
    setError('')
    setSearched(true)
    try {
      const params = new URLSearchParams()
      if (shipper) params.set('shipper', shipper)
      if (code) params.set('code', code)
      if (number) params.set('number', number)
      if (containerNo) params.set('container_no', containerNo)
      if (reference) params.set('reference', reference)
      if (invoiceNumber) params.set('invoice_number', invoiceNumber)
      const res = await fetch(`/api/shipment-overview?${params.toString()}`, { headers: await authHeader() })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Search failed')
      setResults(d.overview || [])
      setOrphanBoatNotes(d.orphanBoatNotes || [])
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const cdnCountMatchesCap = (entry: OverviewEntry) => {
    const cap = parseInt(entry.cusdec.cap || '', 10)
    return !cap || Number.isNaN(cap) || entry.cdns.length === cap
  }

  return (
      <div className="p-6">
        <div className="mb-5">
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><Search size={22} className="text-brand-green"/>Shipment Overview</h1>
          <p className="text-gray-500 text-sm mt-0.5">Search by shipper, CUSDEC code/number, container number, reference, or invoice number — see every linked CUSDEC, CDN, Barcode, and Boat Note, each with its PDF</p>
        </div>

        <div className="card mb-5">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Reference</label>
              <input value={reference} onChange={e => setReference(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && search()}
                list="reference-options" placeholder="Pick or type..."
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"/>
              <datalist id="reference-options">{options.references.map(r => <option key={r} value={r}/>)}</datalist>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Invoice Number</label>
              <input value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && search()}
                list="invoice-number-options" placeholder="Pick or type..."
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"/>
              <datalist id="invoice-number-options">{options.invoiceNumbers.map(n => <option key={n} value={n}/>)}</datalist>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Shipper</label>
              <input value={shipper} onChange={e => setShipper(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && search()}
                list="shipper-options" placeholder="Pick or type..."
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"/>
              <datalist id="shipper-options">{options.shippers.map(s => <option key={s} value={s}/>)}</datalist>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">CUSDEC Code</label>
              <input value={code} onChange={e => setCode(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && search()}
                list="code-options" placeholder="Pick or type..."
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"/>
              <datalist id="code-options">{options.codes.map(c => <option key={c} value={c}/>)}</datalist>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">CUSDEC Number</label>
              <input value={number} onChange={e => setNumber(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && search()}
                list="number-options" placeholder="Pick or type..."
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"/>
              <datalist id="number-options">{options.numbers.map(n => <option key={n} value={n}/>)}</datalist>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Container Number</label>
              <input value={containerNo} onChange={e => setContainerNo(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && search()}
                list="container-options" placeholder="Pick or type..."
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"/>
              <datalist id="container-options">{options.containers.map(c => <option key={c} value={c}/>)}</datalist>
            </div>
          </div>
          <button onClick={search} disabled={loading || !(shipper || code || number || containerNo || reference || invoiceNumber)}
            className="mt-3 flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-40" style={{ background: '#22A87A' }}>
            {loading ? <Loader size={14} className="animate-spin"/> : <Search size={14}/>} Search
          </button>
        </div>

        {error && (
          <div className="mb-4 flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
            <AlertTriangle size={14}/> {error}
          </div>
        )}

        {searched && !loading && results.length === 0 && orphanBoatNotes.length === 0 && !error && (
          <div className="card text-center py-16 text-gray-400 text-sm">No matching documents found</div>
        )}

        <div className="space-y-4">
          {results.map(entry => (
            <div key={entry.cusdec.id} className="card">
              <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <FileText size={16} className="text-[#1B3A5C]"/>
                  <span className="font-semibold text-gray-900">CUSDEC {entry.cusdec.code} {entry.cusdec.number}</span>
                  <span className="text-xs text-gray-400">{entry.cusdec.exporter}</span>
                  {entry.cusdec.reference && <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">Ref: {entry.cusdec.reference}</span>}
                  {entry.cusdec.invoice_number && <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">Inv: {entry.cusdec.invoice_number}</span>}
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-medium px-2 py-1 rounded-md ${cdnCountMatchesCap(entry) ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                    CAP {entry.cusdec.cap || '—'} · {entry.cdns.length} CDN row{entry.cdns.length === 1 ? '' : 's'}
                  </span>
                  {entry.cusdec.pdf_url && (
                    <a href={entry.cusdec.pdf_url} target="_blank" rel="noreferrer" className="text-blue-500 hover:text-blue-700"><ExternalLink size={13}/></a>
                  )}
                </div>
              </div>

              {entry.cdns.length === 0 ? (
                <p className="text-xs text-gray-400 py-4 text-center">No CDN rows for this CUSDEC yet</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50">
                      <tr>
                        {['Container', 'CDN Shipper', 'Goods', 'Gross Mass', 'Barcode Seal', 'Barcode Truck', 'Barcode Date', ''].map(h => (
                          <th key={h} className="text-left px-2 py-2 text-gray-500 font-medium">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {entry.cdns.map(({ cdn, barcode }) => (
                        <tr key={cdn.id} className="border-t border-gray-50">
                          <td className="px-2 py-2 font-mono font-medium text-gray-800 flex items-center gap-1">
                            <Package size={12} className="text-gray-400"/>{cdn.container_no || '—'}
                          </td>
                          <td className="px-2 py-2 text-gray-600">{cdn.shipper || '—'}</td>
                          <td className="px-2 py-2 text-gray-600 max-w-[160px] truncate">{cdn.goods_description || '—'}</td>
                          <td className="px-2 py-2 text-gray-600">{cdn.gross_mass || '—'}</td>
                          {barcode ? (
                            <>
                              <td className="px-2 py-2 text-gray-600">{barcode.seal_no || '—'}</td>
                              <td className="px-2 py-2 text-gray-600">{barcode.truck_no || '—'}</td>
                              <td className="px-2 py-2 text-gray-400 flex items-center gap-1">
                                {barcode.date || '—'}
                                {barcode.pdf_url && (
                                  <a href={barcode.pdf_url} target="_blank" rel="noreferrer" className="text-blue-500 hover:text-blue-700"><ExternalLink size={11}/></a>
                                )}
                              </td>
                            </>
                          ) : (
                            <td colSpan={3} className="px-2 py-2 text-amber-600 flex items-center gap-1">
                              <ScanLine size={12}/> No matching barcode row
                            </td>
                          )}
                          <td className="px-2 py-2">
                            {cdn.pdf_url && (
                              <a href={cdn.pdf_url} target="_blank" rel="noreferrer" className="text-blue-500 hover:text-blue-700"><ExternalLink size={12}/></a>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {entry.boatNotes.length > 0 && (
                <div className="mt-3 pt-3 border-t border-gray-100">
                  <p className="text-xs font-medium text-gray-500 mb-2 flex items-center gap-1"><Anchor size={12}/> Boat Notes</p>
                  <div className="flex flex-wrap gap-2">
                    {entry.boatNotes.map(bn => (
                      <div key={bn.id} className="flex items-center gap-1.5 text-xs bg-gray-50 border border-gray-100 rounded-full px-3 py-1.5">
                        <span className="text-gray-700">{bn.details?.entry_no || bn.details?.bl_no || bn.id.slice(0, 8)}</span>
                        <span className="text-gray-400">· {bn.details?.container_no || '—'}</span>
                        {bn.pdf_url && (
                          <a href={bn.pdf_url} target="_blank" rel="noreferrer" className="text-blue-500 hover:text-blue-700"><ExternalLink size={11}/></a>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}

          {orphanBoatNotes.length > 0 && (
            <div className="card">
              <p className="text-xs font-medium text-gray-500 mb-2 flex items-center gap-1"><Anchor size={12}/> Boat Notes (no linked CDN yet)</p>
              <div className="flex flex-wrap gap-2">
                {orphanBoatNotes.map(bn => (
                  <div key={bn.id} className="flex items-center gap-1.5 text-xs bg-gray-50 border border-gray-100 rounded-full px-3 py-1.5">
                    <span className="text-gray-700">{bn.details?.shipper || '—'}</span>
                    <span className="text-gray-400">· {bn.details?.entry_no || bn.details?.bl_no || bn.id.slice(0, 8)}</span>
                    <span className="text-gray-400">· {bn.details?.container_no || '—'}</span>
                    {bn.pdf_url && (
                      <a href={bn.pdf_url} target="_blank" rel="noreferrer" className="text-blue-500 hover:text-blue-700"><ExternalLink size={11}/></a>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
  )
}
DriveFilesPage.getLayout = (page: React.ReactElement) => <AdminLayout>{page}</AdminLayout>
