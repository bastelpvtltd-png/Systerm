import { useEffect, useState } from 'react'
import AdminLayout, { TAB_ITEMS } from '@/components/admin/AdminLayout'
import { supabase } from '@/lib/supabase'
import { Users, Plus, Edit2, X, Save } from 'lucide-react'

interface Profile {
  id: string
  username: string
  full_name: string
  position: string
  is_admin: boolean
  allowed_tabs: string[]
  created_at: string
}

const emptyForm = { username: '', full_name: '', position: '', password: '', is_admin: false, allowed_tabs: [] as string[] }

export default function UsersPage() {
  const [users, setUsers] = useState<Profile[]>([])
  const [modal, setModal] = useState(false)
  const [editId, setEditId] = useState<string|null>(null)
  const [form, setForm] = useState(emptyForm)

  useEffect(() => { fetchUsers() }, [])

  async function fetchUsers() {
    const { data } = await supabase.from('profiles').select('*').order('created_at')
    setUsers((data as any) ?? [])
  }

  function toggleTab(href: string) {
    setForm(f => ({
      ...f,
      allowed_tabs: f.allowed_tabs.includes(href) ? f.allowed_tabs.filter(h => h !== href) : [...f.allowed_tabs, href],
    }))
  }

  async function handleSave() {
    const patch = {
      username: form.username, full_name: form.full_name, position: form.position,
      is_admin: form.is_admin, allowed_tabs: form.allowed_tabs,
    }
    if (editId) {
      await supabase.from('profiles').update(patch).eq('id', editId)
    } else {
      // Create auth user then profile
      const email = `${form.username}@exportsys.local`
      const { data: authData } = await supabase.auth.admin?.createUser?.({ email, password: form.password, email_confirm: true }) ?? {}
      if (authData?.user) {
        await supabase.from('profiles').insert({ id: authData.user.id, ...patch })
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
            <p className="text-gray-500 text-sm">Manage accounts and which tabs each person can access</p>
          </div>
          <button onClick={() => { setForm(emptyForm); setEditId(null); setModal(true) }} className="btn-primary flex items-center gap-2">
            <Plus size={16}/>Add User
          </button>
        </div>

        <div className="card overflow-hidden p-0">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                {['Username','Full Name','Position','Access','Actions'].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-600 uppercase">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {users.map(u => (
                <tr key={u.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium">{u.username}</td>
                  <td className="px-4 py-3">{u.full_name}</td>
                  <td className="px-4 py-3 text-gray-500">{u.position || '—'}</td>
                  <td className="px-4 py-3">
                    {u.is_admin
                      ? <span className="badge-released">Full access (all tabs)</span>
                      : <span className="text-xs text-gray-500">{u.allowed_tabs?.length || 0} tab{u.allowed_tabs?.length === 1 ? '' : 's'}</span>}
                  </td>
                  <td className="px-4 py-3">
                    <button onClick={() => {
                      setForm({
                        username: u.username, full_name: u.full_name, position: u.position || '',
                        password: '', is_admin: !!u.is_admin, allowed_tabs: u.allowed_tabs || [],
                      })
                      setEditId(u.id); setModal(true)
                    }}
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
          <div className="bg-white rounded-2xl w-full max-w-md max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between p-6 border-b flex-shrink-0">
              <h2 className="font-bold text-lg">{editId ? 'Edit User' : 'Add User'}</h2>
              <button onClick={() => setModal(false)}><X size={20}/></button>
            </div>
            <div className="p-6 space-y-4 overflow-y-auto">
              {[['Username','username','text'],['Full Name','full_name','text'],['Position (job title)','position','text'],['Password (new only)','password','password']].map(([label,key,type]) => (
                <div key={key}>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
                  <input type={type} value={(form as any)[key]} onChange={e => setForm({...form, [key]: e.target.value})}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"/>
                </div>
              ))}

              <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
                <input type="checkbox" checked={form.is_admin} onChange={e => setForm({...form, is_admin: e.target.checked})}/>
                Full access (sees every tab)
              </label>

              {!form.is_admin && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">Tabs this user can access</label>
                  <div className="space-y-1 max-h-52 overflow-y-auto border border-gray-100 rounded-lg p-2">
                    {TAB_ITEMS.map(t => (
                      <label key={t.href} className="flex items-center gap-2 text-sm py-1 px-1 rounded hover:bg-gray-50">
                        <input type="checkbox" checked={form.allowed_tabs.includes(t.href)} onChange={() => toggleTab(t.href)}/>
                        {t.label}
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="flex gap-3 p-6 border-t flex-shrink-0">
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
