import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Save, User } from 'lucide-react'

export default function ProfilePage() {
  const [form, setForm] = useState({ full_name:'', username:'', password:'', confirm_password:'' })
  const [msg, setMsg] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return
      const { data } = await supabase.from('profiles').select('*').eq('id', user.id).single()
      if (data) setForm(f => ({ ...f, full_name: data.full_name ?? '', username: data.username ?? '' }))
    })
  }, [])

  async function handleSave() {
    setLoading(true)
    if (form.password && form.password !== form.confirm_password) {
      setMsg('Passwords do not match'); setLoading(false); return
    }
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    await supabase.from('profiles').update({ full_name: form.full_name, username: form.username }).eq('id', user.id)
    if (form.password) {
      await supabase.auth.updateUser({ password: form.password })
    }
    setMsg('Profile updated successfully')
    setLoading(false)
  }

  return (
    <div className="max-w-lg mx-auto p-8">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{background:'#22A87A'}}>
          <User size={24} color="white"/>
        </div>
        <div>
          <h1 className="text-xl font-bold">My Profile</h1>
          <p className="text-gray-500 text-sm">Update your details</p>
        </div>
      </div>

      <div className="card space-y-4">
        {[['Full Name','full_name','text'],['Username','username','text'],['New Password','password','password'],['Confirm Password','confirm_password','password']].map(([label,key,type]) => (
          <div key={key}>
            <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
            <input type={type} value={(form as any)[key]} onChange={e => setForm({...form, [key]: e.target.value})}
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"/>
          </div>
        ))}

        {msg && <p className="text-green-600 text-sm bg-green-50 px-3 py-2 rounded-lg">{msg}</p>}

        <button onClick={handleSave} disabled={loading} className="btn-primary w-full flex items-center justify-center gap-2">
          <Save size={16}/>{loading ? 'Saving...' : 'Save Changes'}
        </button>
      </div>
    </div>
  )
}
