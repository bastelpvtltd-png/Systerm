import { useEffect, useRef, useState } from 'react'
import AdminLayout, { usePermission } from '@/components/admin/AdminLayout'
import { supabase, authHeader } from '@/lib/supabase'
import { Plus, Trash2, Ship, AlertTriangle, Copy, FileText, X, Edit2, Save } from 'lucide-react'

interface TempShipment {
  id: string
  reference: string | null
  shipper: string
  invoice_number: string
  packing_number: string | null
  consignee: string | null
  invoice_drive_url: string | null
  packing_drive_url: string | null
  license_drive_url: string | null
  cap: string | null
  new_invoice: string | null
  new_packing: string | null
  created_by: string | null
  created_at: string
}

interface DriveFile { label: string; url: string | null }

const emptyForm = {
  shipper: '', invoice_number: '', packing_number: '', consignee: '',
  cap: '', new_invoice: '', new_packing: '',
}

function FileUploadField({ label, onUpload, currentUrl, uploading }: {
  label: string
  onUpload: (base64: string, fileName: string) => void
  currentUrl: string | null
  uploading: boolean
}) {
  const ref = useRef<HTMLInputElement>(null)
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => ref.current?.click()}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-dashed border-gray-300 text-xs text-gray-500 hover:border-green-400 hover:text-green-600 transition-colors">
          <FileText size={13}/>{uploading ? 'Uploading...' : currentUrl ? 'Replace' : 'Choose file'}
        </button>
        {currentUrl && (
          <a href={currentUrl} target="_blank" rel="noreferrer" className="text-xs text-blue-600 underline truncate max-w-[140px]">View</a>
        )}
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

function ShipmentEntryContent() {
  const { has } = usePermission()
  const canUse = has('section:shipment-entry.form')
  const [rows, setRows] = useState<TempShipment[]>([])
  const [form, setForm] = useState(emptyForm)
  const [options, setOptions] = useState<{ shippers: string[]; consignees: string[] }>({ shippers: [], consignees: [] })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [duplicateRow, setDuplicateRow] = useState<TempShipment | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [profileMap, setProfileMap] = useState<Record<string, string>>({})
  const [editRow, setEditRow] = useState<TempShipment | null>(null)
  const [editForm, setEditForm] = useState(emptyForm)
  const [editSaving, setEditSaving] = useState(false)

  // Drive file state for the current form
  const [invoiceFile, setInvoiceFile] = useState<{ url: string | null; uploading: boolean }>({ url: null, uploading: false })
  const [packingFile, setPackingFile] = useState<{ url: string | null; uploading: boolean }>({ url: null, uploading: false })
  const [licenseFile, setLicenseFile] = useState<{ url: string | null; uploading: boolean }>({ url: null, uploading: false })

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
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return
      setCurrentUserId(user.id)
      supabase.from('profiles').select('id, full_name, username, is_admin').then(({ data }) => {
        if (!data) return
        const me = data.find(p => p.id === user.id)
        setIsAdmin(!!me?.is_admin)
        const map: Record<string, string> = {}
        data.forEach(p => { map[p.id] = p.full_name || p.username || 'Unknown' })
        setProfileMap(map)
      })
    })
    const t = setInterval(loadRows, 15000)
    return () => clearInterval(t)
  }, [])

  async function uploadFile(base64: string, fileName: string, slot: 'invoice' | 'packing' | 'license') {
    const setSlot = slot === 'invoice' ? setInvoiceFile : slot === 'packing' ? setPackingFile : setLicenseFile
    setSlot(s => ({ ...s, uploading: true }))
    try {
      const res = await fetch('/api/upload-to-drive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ base64, fileName, docType: `shipment-${slot}` }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Upload failed')
      setSlot({ url: d.driveLink, uploading: false })
    } catch (e: any) {
      setError(e.message)
      setSlot(s => ({ ...s, uploading: false }))
    }
  }

  async function handleSave() {
    setError('')
    setDuplicateRow(null)
    if (!form.shipper.trim() || !form.invoice_number.trim()) {
      setError('Shipper and Shipment Invoice Number are required.')
      return
    }
    // Duplicate check on new_invoice / new_packing
    if (form.new_invoice.trim() || form.new_packing.trim()) {
      const dup = rows.find(r =>
        (form.new_invoice.trim() && r.new_invoice?.trim() === form.new_invoice.trim()) ||
        (form.new_packing.trim() && r.new_packing?.trim() === form.new_packing.trim())
      )
      if (dup) {
        setDuplicateRow(dup)
        setError('This New Invoice or New Packing number already exists — see highlighted entry below.')
        return
      }
    }
    setLoading(true)
    try {
      const res = await fetch('/api/temp-shipments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({
          ...form,
          invoice_drive_url: invoiceFile.url || null,
          packing_drive_url: packingFile.url || null,
          license_drive_url: licenseFile.url || null,
        }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Save failed')
      setForm(emptyForm)
      setInvoiceFile({ url: null, uploading: false })
      setPackingFile({ url: null, uploading: false })
      setLicenseFile({ url: null, uploading: false })
      await loadRows()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  function handleAddSame(r: TempShipment) {
    setForm({
      shipper: r.shipper,
      invoice_number: r.invoice_number,
      packing_number: r.packing_number || '',
      consignee: r.consignee || '',
      cap: r.cap || '',
      new_invoice: '',
      new_packing: '',
    })
    setInvoiceFile({ url: null, uploading: false })
    setPackingFile({ url: null, uploading: false })
    setLicenseFile({ url: null, uploading: false })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function handleDelete(id: string) {
    if (!confirm('Remove this shipment entry? (Drive documents will also be deleted)')) return
    try {
      const res = await fetch(`/api/temp-shipments?id=${id}`, { method: 'DELETE', headers: await authHeader() })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Delete failed')
      setRows(prev => prev.filter(r => r.id !== id))
      if (duplicateRow?.id === id) setDuplicateRow(null)
    } catch (e: any) {
      setError(e.message)
    }
  }

  function openEdit(r: TempShipment) {
    setEditRow(r)
    setEditForm({
      shipper: r.shipper, invoice_number: r.invoice_number, packing_number: r.packing_number || '',
      consignee: r.consignee || '', cap: r.cap || '', new_invoice: r.new_invoice || '', new_packing: r.new_packing || '',
    })
  }

  async function saveEdit() {
    if (!editRow) return
    setEditSaving(true)
    try {
      const res = await fetch('/api/temp-shipments', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ id: editRow.id, ...editForm }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Save failed')
      setRows(prev => prev.map(r => r.id === editRow.id ? { ...r, ...editForm } : r))
      setEditRow(null)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setEditSaving(false)
    }
  }

  const anyUploading = invoiceFile.uploading || packingFile.uploading || licenseFile.uploading

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Shipment Entry</h1>
          <p className="text-gray-500 text-sm">Open a shipment as soon as an order arrives — merges into CUSDEC automatically once uploaded.</p>
        </div>
      </div>

      {error && (
        <div className="mb-4 flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
          <AlertTriangle size={16}/>{error}
          <button onClick={() => setError('')} className="ml-auto"><X size={14}/></button>
        </div>
      )}

      {canUse && <div className="card mb-6">
        {/* Row 1: core shipment fields */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 mb-3">
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

        {/* Row 2: new_invoice, new_packing, cap */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">New Invoice No.</label>
            <input value={form.new_invoice} onChange={e => setForm({ ...form, new_invoice: e.target.value })}
              placeholder="For Add Same flow"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"/>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">New Packing No.</label>
            <input value={form.new_packing} onChange={e => setForm({ ...form, new_packing: e.target.value })}
              placeholder="For Add Same flow"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"/>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">CAP</label>
            <input value={form.cap} onChange={e => setForm({ ...form, cap: e.target.value })}
              placeholder="Container / capacity note"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"/>
          </div>
        </div>

        {/* Row 3: file uploads */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
          <FileUploadField label="Invoice PDF" currentUrl={invoiceFile.url} uploading={invoiceFile.uploading}
            onUpload={(b64, name) => uploadFile(b64, name, 'invoice')}/>
          <FileUploadField label="Packing List PDF" currentUrl={packingFile.url} uploading={packingFile.uploading}
            onUpload={(b64, name) => uploadFile(b64, name, 'packing')}/>
          <FileUploadField label="License / Other" currentUrl={licenseFile.url} uploading={licenseFile.uploading}
            onUpload={(b64, name) => uploadFile(b64, name, 'license')}/>
        </div>

        <button onClick={handleSave} disabled={loading || anyUploading} className="btn-primary flex items-center gap-2">
          <Plus size={16}/>{loading ? 'Saving...' : 'Save Shipment'}
        </button>
      </div>}

      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                {['Shipper', 'Invoice', 'Packing', 'New Invoice', 'New Packing', 'CAP', 'Docs', 'Created By', 'Date', 'Actions'].map(h => (
                  <th key={h} className="text-left px-3 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rows.map(r => {
                const isDup = duplicateRow?.id === r.id
                const docs: DriveFile[] = [
                  { label: 'Invoice', url: r.invoice_drive_url },
                  { label: 'Packing', url: r.packing_drive_url },
                  { label: 'License', url: r.license_drive_url },
                ].filter(d => d.url)
                return (
                  <tr key={r.id} className={isDup ? 'bg-amber-50 ring-2 ring-inset ring-amber-300' : 'hover:bg-gray-50'}>
                    <td className="px-3 py-3 text-sm">{r.shipper}</td>
                    <td className="px-3 py-3 font-mono text-xs">{r.invoice_number}</td>
                    <td className="px-3 py-3 text-xs">{r.packing_number || '—'}</td>
                    <td className="px-3 py-3 font-mono text-xs text-blue-700">{r.new_invoice || '—'}</td>
                    <td className="px-3 py-3 font-mono text-xs text-blue-700">{r.new_packing || '—'}</td>
                    <td className="px-3 py-3 text-xs text-purple-700">{r.cap || '—'}</td>
                    <td className="px-3 py-3">
                      <div className="flex flex-col gap-0.5">
                        {docs.length === 0 ? <span className="text-gray-300 text-xs">—</span> : docs.map(d => (
                          <a key={d.label} href={d.url!} target="_blank" rel="noreferrer"
                            className="text-xs text-blue-600 underline hover:text-blue-800">{d.label}</a>
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-xs text-gray-600">{r.created_by ? (profileMap[r.created_by] || '—') : '—'}</td>
                    <td className="px-3 py-3 text-gray-400 text-xs">{new Date(r.created_at).toLocaleDateString()}</td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-1">
                        {canUse && (
                          <button onClick={() => handleAddSame(r)} title="Add Same (copy this row)"
                            className="p-1.5 rounded hover:bg-blue-50 text-blue-500"><Copy size={13}/></button>
                        )}
                        {(isAdmin || r.created_by === currentUserId) && (
                          <button onClick={() => openEdit(r)} title="Edit"
                            className="p-1.5 rounded hover:bg-green-50 text-green-600"><Edit2 size={13}/></button>
                        )}
                        {(isAdmin || r.created_by === currentUserId) && (
                          <button onClick={() => handleDelete(r.id)} className="p-1.5 rounded hover:bg-red-50 text-red-500"><Trash2 size={13}/></button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
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

      {/* Edit modal */}
      {editRow && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between p-5 border-b flex-shrink-0">
              <h2 className="font-bold text-gray-900">Edit Shipment Entry</h2>
              <button onClick={() => setEditRow(null)}><X size={18}/></button>
            </div>
            <div className="p-5 space-y-3 overflow-y-auto">
              {[
                ['Shipper', 'shipper'], ['Invoice Number', 'invoice_number'],
                ['Packing Number', 'packing_number'], ['Consignee', 'consignee'],
                ['New Invoice No.', 'new_invoice'], ['New Packing No.', 'new_packing'], ['CAP', 'cap'],
              ].map(([label, key]) => (
                <div key={key}>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
                  <input value={(editForm as any)[key]} onChange={e => setEditForm(f => ({ ...f, [key]: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"/>
                </div>
              ))}
            </div>
            <div className="flex gap-3 p-5 border-t flex-shrink-0">
              <button onClick={() => setEditRow(null)} className="btn-secondary flex-1">Cancel</button>
              <button onClick={saveEdit} disabled={editSaving} className="btn-primary flex-1 flex items-center justify-center gap-2">
                <Save size={14}/>{editSaving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function ShipmentEntryPage() {
  return <ShipmentEntryContent/>
}
ShipmentEntryPage.getLayout = (page: React.ReactElement) => <AdminLayout>{page}</AdminLayout>
