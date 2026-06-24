import { useEffect, useState } from 'react'
import AdminLayout from '@/components/admin/AdminLayout'
import { supabase } from '@/lib/supabase'
import { Users, Plus, Edit2, X, Save } from 'lucide-react'

interface Profile {
  id: string
  username: string
  full_name: string
  role: string
  created_at: string
}

export default function UsersPage() {
  const [users, setUsers] = useState<Profile[]>([])
  const [modal, setModal] = useState(false)
  const [editId, setEditId] = useState<string|null>(null)
  const [form, setForm] = useState({ username:'', full_name:'', role:'worker', password:'' })

  useEffect(() => { fetchUsers() }, [])

  async function fetchUsers() {
    const { data } = await supabase.from('profiles').select('*').order('created_at')
    setUsers(data ?? [])
  }

  async function handleSave() {
    if (editId) {
      await supabase.from('profiles').update({ username: form.username, full_name: form.full_name, role: form.role }).eq('id', editId)
    } else {
      // Create auth user then profile
      const email = `${form.username}@exportsys.local`
      const { data: authData } = await supabase.auth.admin?.createUser?.({ email, password: form.password, email_confirm: true }) ?? {}
      if (authData?.user) {
        await supabase.from('profiles').insert({ id: authData.user.id, username: form.username, full_name: form.full_name, role: form.role })
      }
    }
    setModal(false)
    fetchUsers()
  }

  return (
    <AdminLayout>
      <div className="p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2"><Users size={22} className="text-brand-green"/>Users</h1>
            <p className="text-gray-500 text-sm">Manage worker accounts</p>
          </div>
          <button onClick={() => { setForm({ username:'', full_name:'', role:'worker', password:'' }); setEditId(null); setModal(true) }} className="btn-primary flex items-center gap-2">
            <Plus size={16}/>Add User
          </button>
        </div>

        <div className="card overflow-hidden p-0">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                {['Username','Full Name','Role','Actions'].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-600 uppercase">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {users.map(u => (
                <tr key={u.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium">{u.username}</td>
                  <td className="px-4 py-3">{u.full_name}</td>
                  <td className="px-4 py-3">
                    <span className={u.role === 'admin' ? 'badge-released' : 'badge-done'}>{u.role}</span>
                  </td>
                  <td className="px-4 py-3">
                    <button onClick={() => { setForm({ username: u.username, full_name: u.full_name, role: u.role, password:'' }); setEditId(u.id); setModal(true) }}
                      className="p-1.5 rounded hover:bg-blue-50 text-blue-600"><Edit2 size={14}/></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {modal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md">
            <div className="flex items-center justify-between p-6 border-b">
              <h2 className="font-bold text-lg">{editId ? 'Edit User' : 'Add User'}</h2>
              <button onClick={() => setModal(false)}><X size={20}/></button>
            </div>
            <div className="p-6 space-y-4">
              {[['Username','username','text'],['Full Name','full_name','text'],['Password (new only)','password','password']].map(([label,key,type]) => (
                <div key={key}>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
                  <input type={type} value={(form as any)[key]} onChange={e => setForm({...form, [key]: e.target.value})}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"/>
                </div>
              ))}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Role</label>
                <select value={form.role} onChange={e => setForm({...form, role: e.target.value})}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400">
                  <option value="worker">Worker</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
            </div>
            <div className="flex gap-3 p-6 border-t">
              <button onClick={() => setModal(false)} className="btn-secondary flex-1">Cancel</button>
              <button onClick={handleSave} className="btn-primary flex-1 flex items-center justify-center gap-2">
                <Save size={16}/>Save
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  )
}
