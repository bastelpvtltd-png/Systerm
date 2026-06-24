import { useEffect, useState } from 'react'
import AdminLayout from '@/components/admin/AdminLayout'
import { supabase } from '@/lib/supabase'
import { Plus, Search, Edit2, Trash2, Eye, X, Save } from 'lucide-react'

interface Shipment {
  id: string
  shipment_no: string
  shipper_name: string
  shipper_address: string
  wharf: string
  driver_name: string
  driver_nic: string
  driver_phone: string
  vehicle_no: string
  status: string
  created_at: string
}

const emptyForm = {
  shipment_no:'', shipper_name:'', shipper_address:'',
  wharf:'', driver_name:'', driver_nic:'',
  driver_phone:'', vehicle_no:'', status:'pending'
}

export default function ShipmentsPage() {
  const [shipments, setShipments] = useState<Shipment[]>([])
  const [search, setSearch] = useState('')
  const [modal, setModal] = useState<'add'|'edit'|'view'|null>(null)
  const [form, setForm] = useState(emptyForm)
  const [editId, setEditId] = useState<string|null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => { fetchShipments() }, [])

  async function fetchShipments() {
    const { data } = await supabase.from('shipments').select('*').order('created_at', { ascending: false })
    setShipments(data ?? [])
  }

  async function handleSave() {
    setLoading(true)
    if (editId) {
      await supabase.from('shipments').update(form).eq('id', editId)
    } else {
      await supabase.from('shipments').insert(form)
    }
    setLoading(false)
    setModal(null)
    setForm(emptyForm)
    setEditId(null)
    fetchShipments()
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this shipment?')) return
    await supabase.from('shipments').delete().eq('id', id)
    fetchShipments()
  }

  function openEdit(s: Shipment) {
    setForm({ shipment_no: s.shipment_no, shipper_name: s.shipper_name,
      shipper_address: s.shipper_address, wharf: s.wharf,
      driver_name: s.driver_name, driver_nic: s.driver_nic,
      driver_phone: s.driver_phone, vehicle_no: s.vehicle_no, status: s.status })
    setEditId(s.id)
    setModal('edit')
  }

  const filtered = shipments.filter(s =>
    s.shipment_no?.toLowerCase().includes(search.toLowerCase()) ||
    s.shipper_name?.toLowerCase().includes(search.toLowerCase())
  )

  const statusColor: Record<string, string> = {
    pending:'badge-pending', processing:'badge-released',
    released:'badge-released', completed:'badge-done'
  }

  return (
    <AdminLayout>
      <div className="p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Shipments</h1>
            <p className="text-gray-500 text-sm">{shipments.length} total shipments</p>
          </div>
          <button onClick={() => { setForm(emptyForm); setEditId(null); setModal('add') }} className="btn-primary flex items-center gap-2">
            <Plus size={16}/> New Shipment
          </button>
        </div>

        {/* Search */}
        <div className="relative mb-4">
          <Search size={16} className="absolute left-3 top-3 text-gray-400"/>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search shipment no or shipper..."
            className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-400"/>
        </div>

        {/* Table */}
        <div className="card overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  {['Shipment No','Shipper','Wharf','Driver','Vehicle','Status','Actions'].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map(s => (
                  <tr key={s.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono font-medium text-brand-blue">{s.shipment_no}</td>
                    <td className="px-4 py-3">{s.shipper_name}</td>
                    <td className="px-4 py-3">{s.wharf}</td>
                    <td className="px-4 py-3">{s.driver_name}</td>
                    <td className="px-4 py-3 font-mono">{s.vehicle_no}</td>
                    <td className="px-4 py-3"><span className={statusColor[s.status] ?? 'badge-pending'}>{s.status}</span></td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <button onClick={() => openEdit(s)} className="p-1.5 rounded hover:bg-blue-50 text-blue-600"><Edit2 size={14}/></button>
                        <button onClick={() => handleDelete(s.id)} className="p-1.5 rounded hover:bg-red-50 text-red-500"><Trash2 size={14}/></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length === 0 && (
              <div className="text-center py-12 text-gray-400">No shipments found</div>
            )}
          </div>
        </div>
      </div>

      {/* Add/Edit Modal */}
      {(modal === 'add' || modal === 'edit') && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-6 border-b">
              <h2 className="font-bold text-lg">{modal === 'add' ? 'New Shipment' : 'Edit Shipment'}</h2>
              <button onClick={() => setModal(null)}><X size={20}/></button>
            </div>
            <div className="p-6 grid grid-cols-2 gap-4">
              {[
                ['Shipment No','shipment_no'],['Shipper Name','shipper_name'],
                ['Shipper Address','shipper_address'],['Wharf','wharf'],
                ['Driver Name','driver_name'],['Driver NIC','driver_nic'],
                ['Driver Phone','driver_phone'],['Vehicle No','vehicle_no'],
              ].map(([label, key]) => (
                <div key={key}>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
                  <input value={(form as any)[key]} onChange={e => setForm({...form, [key]: e.target.value})}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"/>
                </div>
              ))}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Status</label>
                <select value={form.status} onChange={e => setForm({...form, status: e.target.value})}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400">
                  <option value="pending">Pending</option>
                  <option value="processing">Processing</option>
                  <option value="released">Released</option>
                  <option value="completed">Completed</option>
                </select>
              </div>
            </div>
            <div className="flex gap-3 p-6 border-t">
              <button onClick={() => setModal(null)} className="btn-secondary flex-1">Cancel</button>
              <button onClick={handleSave} disabled={loading} className="btn-primary flex-1 flex items-center justify-center gap-2">
                <Save size={16}/>{loading ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  )
}
