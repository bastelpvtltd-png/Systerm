import { useCallback, useEffect, useRef, useState } from 'react'
import AdminLayout, { usePermission } from '@/components/admin/AdminLayout'
import { supabase, authHeader } from '@/lib/supabase'
import { Plus, Trash2, Ship, AlertTriangle, Copy, FileText, X, Edit2, Save, Link } from 'lucide-react'

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
  divide_invoice_drive_url: string | null
  divide_packing_drive_url: string | null
  real_cap: string | null
  cap: string | null               // divide_cap stored in the 'cap' column
  new_invoice: string | null
  new_packing: string | null
  created_by: string | null
  created_at: string
}

const emptyForm = {
  shipper: '', invoice_number: '', packing_number: '', consignee: '',
  real_cap: '', cap: '',           // cap = divide_cap
  new_invoice: '', new_packing: '',
}

// ── File upload field ────────────────────────────────────────────────────────
function FileUploadField({ label, sublabel, onUpload, currentUrl, uploading }: {
  label: string
  sublabel?: string
  onUpload: (base64: string, fileName: string) => void
  currentUrl: string | null
  uploading: boolean
}) {
  const ref = useRef<HTMLInputElement>(null)
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-0.5">{label}</label>
      {sublabel && <p className="text-[10px] text-gray-400 mb-1">{sublabel}</p>}
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
  const [isAdmin, setIsAdmin] = useState(false)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [profileMap, setProfileMap] = useState<Record<string, string>>({})
  const [editRow, setEditRow] = useState<TempShipment | null>(null)
  const [editForm, setEditForm] = useState(emptyForm)
  const [editSaving, setEditSaving] = useState(false)

  // Drive file state — real docs are shared per invoice_number, divide docs are per-row
  const [realInvoiceFile, setRealInvoiceFile] = useState<{ url: string | null; uploading: boolean }>({ url: null, uploading: false })
  const [realPackingFile, setRealPackingFile] = useState<{ url: string | null; uploading: boolean }>({ url: null, uploading: false })
  const [licenseFile, setLicenseFile] = useState<{ url: string | null; uploading: boolean }>({ url: null, uploading: false })
  const [divInvoiceFile, setDivInvoiceFile] = useState<{ url: string | null; uploading: boolean }>({ url: null, uploading: false })
  const [divPackingFile, setDivPackingFile] = useState<{ url: string | null; uploading: boolean }>({ url: null, uploading: false })

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

  // When invoice_number is entered, auto-fill real docs + real_cap from any existing row
  const handleInvoiceNumberBlur = useCallback((invoiceNum: string) => {
    if (!invoiceNum.trim()) return
    const sibling = rows.find(r => r.invoice_number === invoiceNum.trim())
    if (!sibling) return
    if (sibling.invoice_drive_url) setRealInvoiceFile(s => s.url ? s : { url: sibling.invoice_drive_url, uploading: false })
    if (sibling.packing_drive_url) setRealPackingFile(s => s.url ? s : { url: sibling.packing_drive_url, uploading: false })
    if (sibling.license_drive_url) setLicenseFile(s => s.url ? s : { url: sibling.license_drive_url, uploading: false })
    if (sibling.real_cap) setForm(f => f.real_cap ? f : { ...f, real_cap: sibling.real_cap! })
  }, [rows])

  async function uploadFile(
    base64: string, fileName: string,
    slot: 'real_invoice' | 'real_packing' | 'license' | 'div_invoice' | 'div_packing'
  ) {
    const setSlot = {
      real_invoice: setRealInvoiceFile,
      real_packing: setRealPackingFile,
      license: setLicenseFile,
      div_invoice: setDivInvoiceFile,
      div_packing: setDivPackingFile,
    }[slot]
    setSlot(s => ({ ...s, uploading: true }))
    try {
      const docType = slot === 'real_invoice' ? 'shipment-invoice'
        : slot === 'real_packing' ? 'shipment-packing'
        : slot === 'license' ? 'shipment-license'
        : slot === 'div_invoice' ? 'shipment-divide-invoice'
        : 'shipment-divide-packing'
      const res = await fetch('/api/upload-to-drive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ base64, fileName, docType }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Upload failed')
      const url: string = d.driveLink

      setSlot({ url, uploading: false })

      // For real docs (not divide): sync URL to all existing rows with the same invoice_number immediately
      const invoiceNum = form.invoice_number.trim()
      if (invoiceNum && ['real_invoice', 'real_packing', 'license'].includes(slot)) {
        const field = slot === 'real_invoice' ? 'invoice_drive_url'
          : slot === 'real_packing' ? 'packing_drive_url'
          : 'license_drive_url'
        await fetch('/api/temp-shipments', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
          body: JSON.stringify({ _syncRealDoc: true, invoice_number: invoiceNum, [field]: url }),
        }).catch(() => {})
        await loadRows()
      }
    } catch (e: any) {
      setError(e.message)
      setSlot(s => ({ ...s, uploading: false }))
    }
  }

  async function handleSave() {
    setError('')
    if (!form.shipper.trim() || !form.invoice_number.trim()) {
      setError('Shipper and Shipment Invoice Number are required.')
      return
    }
    setLoading(true)
    try {
      const res = await fetch('/api/temp-shipments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({
          ...form,
          invoice_drive_url: realInvoiceFile.url || null,
          packing_drive_url: realPackingFile.url || null,
          license_drive_url: licenseFile.url || null,
          divide_invoice_drive_url: divInvoiceFile.url || null,
          divide_packing_drive_url: divPackingFile.url || null,
        }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Save failed')
      setForm(emptyForm)
      setRealInvoiceFile({ url: null, uploading: false })
      setRealPackingFile({ url: null, uploading: false })
      setLicenseFile({ url: null, uploading: false })
      setDivInvoiceFile({ url: null, uploading: false })
      setDivPackingFile({ url: null, uploading: false })
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
      real_cap: r.real_cap || '',
      cap: '',                   // divide_cap is per-row, don't copy
      new_invoice: '',
      new_packing: '',
    })
    // Auto-fill shared real docs
    setRealInvoiceFile({ url: r.invoice_drive_url, uploading: false })
    setRealPackingFile({ url: r.packing_drive_url, uploading: false })
    setLicenseFile({ url: r.license_drive_url, uploading: false })
    setDivInvoiceFile({ url: null, uploading: false })
    setDivPackingFile({ url: null, uploading: false })
    window.scrollTo({ top: 0, behavior: 'smooth' })
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

  function openEdit(r: TempShipment) {
    setEditRow(r)
    setEditForm({
      shipper: r.shipper, invoice_number: r.invoice_number, packing_number: r.packing_number || '',
      consignee: r.consignee || '', real_cap: r.real_cap || '', cap: r.cap || '',
      new_invoice: r.new_invoice || '', new_packing: r.new_packing || '',
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

  const anyUploading = realInvoiceFile.uploading || realPackingFile.uploading || licenseFile.uploading || divInvoiceFile.uploading || divPackingFile.uploading

  // Group rows by invoice_number to show real_cap / divide_cap totals
  const divCapSumByInvoice = rows.reduce<Record<string, number>>((acc, r) => {
    if (r.invoice_number) acc[r.invoice_number] = (acc[r.invoice_number] || 0) + (parseInt(r.cap || '0', 10))
    return acc
  }, {})

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

      {canUse && (
        <div className="card mb-6 space-y-4">
          {/* Row 1: core fields */}
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
              <input value={form.invoice_number}
                onChange={e => setForm({ ...form, invoice_number: e.target.value })}
                onBlur={e => handleInvoiceNumberBlur(e.target.value)}
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

          {/* Row 2: CAP fields + New Invoice/Packing */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Real CAP</label>
              <p className="text-[10px] text-gray-400 mb-1">Total containers for this invoice</p>
              <input value={form.real_cap} onChange={e => setForm({ ...form, real_cap: e.target.value })}
                placeholder="e.g. 5"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"/>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Divide CAP</label>
              <p className="text-[10px] text-gray-400 mb-1">This entry's split (sum must ≤ Real CAP)</p>
              <input value={form.cap} onChange={e => setForm({ ...form, cap: e.target.value })}
                placeholder="e.g. 2"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"/>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">New Invoice No.</label>
              <input value={form.new_invoice} onChange={e => setForm({ ...form, new_invoice: e.target.value })}
                placeholder="For split/divide flow"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"/>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">New Packing No.</label>
              <input value={form.new_packing} onChange={e => setForm({ ...form, new_packing: e.target.value })}
                placeholder="For split/divide flow"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"/>
            </div>
          </div>

          {/* Row 3: Real docs (shared per invoice_number) */}
          <div>
            <p className="text-xs font-semibold text-gray-700 mb-2 flex items-center gap-1.5">
              <Link size={12} className="text-blue-500"/>Real Documents
              <span className="font-normal text-gray-400">(shared across all entries with the same Invoice Number)</span>
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pl-4 border-l-2 border-blue-100">
              <FileUploadField label="Real Invoice PDF" currentUrl={realInvoiceFile.url} uploading={realInvoiceFile.uploading}
                onUpload={(b64, name) => uploadFile(b64, name, 'real_invoice')}/>
              <FileUploadField label="Real Packing List PDF" currentUrl={realPackingFile.url} uploading={realPackingFile.uploading}
                onUpload={(b64, name) => uploadFile(b64, name, 'real_packing')}/>
              <FileUploadField label="License / Other" currentUrl={licenseFile.url} uploading={licenseFile.uploading}
                onUpload={(b64, name) => uploadFile(b64, name, 'license')}/>
            </div>
          </div>

          {/* Row 4: Divide docs (per-row) */}
          <div>
            <p className="text-xs font-semibold text-gray-700 mb-2 flex items-center gap-1.5">
              <FileText size={12} className="text-purple-500"/>Divide Documents
              <span className="font-normal text-gray-400">(specific to this split entry)</span>
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pl-4 border-l-2 border-purple-100">
              <FileUploadField label="Divide Invoice PDF" currentUrl={divInvoiceFile.url} uploading={divInvoiceFile.uploading}
                onUpload={(b64, name) => uploadFile(b64, name, 'div_invoice')}/>
              <FileUploadField label="Divide Packing List PDF" currentUrl={divPackingFile.url} uploading={divPackingFile.uploading}
                onUpload={(b64, name) => uploadFile(b64, name, 'div_packing')}/>
            </div>
          </div>

          <button onClick={handleSave} disabled={loading || anyUploading} className="btn-primary flex items-center gap-2">
            <Plus size={16}/>{loading ? 'Saving...' : 'Save Shipment'}
          </button>
        </div>
      )}

      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                {['Shipper', 'Invoice', 'Packing', 'New Inv', 'New Pkg', 'Real CAP', 'Div CAP', 'Docs', 'Created By', 'Date', 'Actions'].map(h => (
                  <th key={h} className="text-left px-3 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rows.map(r => {
                const realCap = parseInt(r.real_cap || '0', 10)
                const divSum = divCapSumByInvoice[r.invoice_number] || 0
                const capOver = realCap > 0 && divSum > realCap
                const docs = [
                  { label: 'Real Inv', url: r.invoice_drive_url },
                  { label: 'Real Pkg', url: r.packing_drive_url },
                  { label: 'License', url: r.license_drive_url },
                  { label: 'Div Inv', url: r.divide_invoice_drive_url },
                  { label: 'Div Pkg', url: r.divide_packing_drive_url },
                ].filter(d => d.url)
                return (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="px-3 py-3 text-sm">{r.shipper}</td>
                    <td className="px-3 py-3 font-mono text-xs">{r.invoice_number}</td>
                    <td className="px-3 py-3 text-xs">{r.packing_number || '—'}</td>
                    <td className="px-3 py-3 font-mono text-xs text-blue-700">{r.new_invoice || '—'}</td>
                    <td className="px-3 py-3 font-mono text-xs text-blue-700">{r.new_packing || '—'}</td>
                    <td className="px-3 py-3 text-xs font-medium text-indigo-700">{r.real_cap || '—'}</td>
                    <td className={`px-3 py-3 text-xs font-medium ${capOver ? 'text-red-600' : 'text-purple-700'}`}>
                      {r.cap || '—'}
                      {capOver && <span className="ml-1 text-[10px] text-red-500">⚠ over!</span>}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-col gap-0.5">
                        {docs.length === 0 ? <span className="text-gray-300 text-xs">—</span> : docs.map(d => (
                          <a key={d.label} href={d.url!} target="_blank" rel="noreferrer"
                            className="text-xs text-blue-600 underline hover:text-blue-800">{d.label}</a>
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-xs text-gray-600">{r.created_by ? (profileMap[r.created_by] || '—') : '—'}</td>
                    <td className="px-3 py-3 text-gray-400 text-xs whitespace-nowrap">{new Date(r.created_at).toLocaleDateString()}</td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-1">
                        {canUse && (
                          <button onClick={() => handleAddSame(r)} title="Add Same (split this invoice)"
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
                ['Real CAP (total for invoice)', 'real_cap'],
                ['Divide CAP (this entry)', 'cap'],
                ['New Invoice No.', 'new_invoice'], ['New Packing No.', 'new_packing'],
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
