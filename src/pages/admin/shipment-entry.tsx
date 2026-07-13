import { useEffect, useState } from 'react'
import AdminLayout, { usePermission } from '@/components/admin/AdminLayout'
import { authHeader } from '@/lib/supabase'
import { Plus, Trash2, Ship, AlertTriangle } from 'lucide-react'

// New order intake: a lightweight form that opens a "Shipment" the moment an
// order arrives, before any CUSDEC/CDN paperwork exists for it. Rows live in
// temporary_shipments (NOT the main cusdec/cdn tables) until a CUSDEC upload
// auto-matches by Invoice Number and merges/deletes the row (see Cusdec
// Automation). This is deliberately a separate page/table from the older
// "Shipments" tab (trucking/wharf tracking, /admin/shipments) — different
// purpose, different data shape.
interface TempShipment {
  id: string
  reference: string | null
  shipper: string
  invoice_number: string
  packing_number: string | null
  consignee: string | null
  created_at: string
}

const emptyForm = { shipper: '', invoice_number: '', packing_number: '', consignee: '' }

function ShipmentEntryContent() {
  const { has } = usePermission()
  const canUse = has('section:shipment-entry.form')
  const [rows, setRows] = useState<TempShipment[]>([])
  const [form, setForm] = useState(emptyForm)
  const [options, setOptions] = useState<{ shippers: string[]; consignees: string[] }>({ shippers: [], consignees: [] })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function loadRows() {
    try {
      const res = await fetch('/api/temp-shipments', { headers: await authHeader() })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Failed to load shipments')
      setRows(d.shipments || [])
    } catch (e: any) {
      setError(e.message)
    }
  }

  useEffect(() => {
    loadRows()
    fetch('/api/temp-shipment-options').then(r => r.json()).then(d => setOptions({ shippers: d.shippers || [], consignees: d.consignees || [] })).catch(() => {})
    // Live — a shipment someone else just entered (or one that got merged
    // into a CUSDEC and disappeared) shows up here without a refresh; the
    // entry form below is separate state, untouched by this.
    const t = setInterval(loadRows, 15000)
    return () => clearInterval(t)
  }, [])

  async function handleSave() {
    setError('')
    if (!form.shipper.trim() || !form.invoice_number.trim()) {
      setError('Shipper and Shipment Invoice Number are required.')
      return
    }
    setLoading(true)
    try {
      const res = await fetch('/api/temp-shipments', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify(form),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Save failed')
      setForm(emptyForm)
      await loadRows()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Remove this shipment entry?')) return
    try {
      const res = await fetch(`/api/temp-shipments?id=${id}`, { method: 'DELETE', headers: await authHeader() })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Delete failed')
      setRows(prev => prev.filter(r => r.id !== id))
    } catch (e: any) {
      setError(e.message)
    }
  }

  if (!canUse) {
    return <div className="p-6 text-gray-400 text-sm">You don't have access to this page.</div>
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Shipment Entry</h1>
          <p className="text-gray-500 text-sm">Open a shipment as soon as an order arrives — merges into CUSDEC automatically once uploaded. Reference is auto-generated from the Shipper + year.</p>
        </div>
      </div>

      {error && (
        <div className="mb-4 flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
          <AlertTriangle size={16}/>{error}
        </div>
      )}

      <div className="card mb-6">
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Shipper *</label>
            <input value={form.shipper} onChange={e => setForm({ ...form, shipper: e.target.value })}
              list="shipper-options" placeholder="Pick or type new..."
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"/>
            <datalist id="shipper-options">{options.shippers.map(s => <option key={s} value={s}/>)}</datalist>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Shipment Invoice Number *</label>
            <input value={form.invoice_number} onChange={e => setForm({ ...form, invoice_number: e.target.value })}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"/>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Packing Number</label>
            <input value={form.packing_number} onChange={e => setForm({ ...form, packing_number: e.target.value })}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"/>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Consignee</label>
            <input value={form.consignee} onChange={e => setForm({ ...form, consignee: e.target.value })}
              list="consignee-options" placeholder="Pick or type new..."
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"/>
            <datalist id="consignee-options">{options.consignees.map(c => <option key={c} value={c}/>)}</datalist>
          </div>
        </div>
        <button onClick={handleSave} disabled={loading} className="btn-primary mt-4 flex items-center gap-2">
          <Plus size={16}/>{loading ? 'Saving...' : 'Save Shipment'}
        </button>
      </div>

      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                {['Reference', 'Shipper', 'Invoice Number', 'Packing Number', 'Consignee', 'Created', 'Actions'].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rows.map(r => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">{r.reference || '—'}</td>
                  <td className="px-4 py-3">{r.shipper}</td>
                  <td className="px-4 py-3 font-mono">{r.invoice_number}</td>
                  <td className="px-4 py-3">{r.packing_number || '—'}</td>
                  <td className="px-4 py-3">{r.consignee || '—'}</td>
                  <td className="px-4 py-3 text-gray-400">{new Date(r.created_at).toLocaleDateString()}</td>
                  <td className="px-4 py-3">
                    <button onClick={() => handleDelete(r.id)} className="p-1.5 rounded hover:bg-red-50 text-red-500"><Trash2 size={14}/></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && (
            <div className="text-center py-12 text-gray-400 flex flex-col items-center gap-2">
              <Ship size={24} className="text-gray-300"/>
              No pending shipment entries — they disappear automatically once matched with a CUSDEC upload.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function ShipmentEntryPage() {
  return <ShipmentEntryContent/>
}
ShipmentEntryPage.getLayout = (page: React.ReactElement) => <AdminLayout>{page}</AdminLayout>
